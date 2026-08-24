import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BaseVideoGenerator, type GenerateResult, type VideoGenerateParams } from '../base'
import { getProviderConfig } from '@/lib/api-config'
import { optimizeMiniMaxH3Prompt } from './minimax-h3-prompt'

type ApiNode = { class_type: string; inputs: Record<string, unknown> }
type ApiWorkflow = Record<string, ApiNode>
type LinkTuple = [unknown, unknown, unknown, unknown, unknown, unknown]

const LINK_TYPES = new Set([
  'IMAGE', 'VIDEO', 'MASK', 'MODEL', 'CLIP', 'CLIP_VISION', 'CONDITIONING',
  'LATENT', 'VAE', 'STYLE_MODEL', 'CONTROL_NET', 'CLIP_VISION_OUTPUT',
  'UPSCALE_MODEL', 'SIGMAS', 'AUDIO', 'AUDIO_VAE', 'CUSTOM', 'GLIGEN',
  'DETECTOR_MASK', 'BITMASK', 'SAMPLERS', 'SAMPLER_SCHEDULERS', 'DETAILER',
])

function trimBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function parseRemoteWorkflowPath(modelId: unknown): string | null {
  if (typeof modelId !== 'string' || !modelId.startsWith('workflow:')) return null
  const path = modelId.slice('workflow:'.length).trim().replace(/\\/g, '/')
  if (!path || path.includes('..') || !path.toLowerCase().endsWith('.json')) {
    throw new Error('COMFYUI_WORKFLOW_PATH_INVALID')
  }
  return path.startsWith('workflows/') ? path : `workflows/${path}`
}

async function loadWorkflow(params: {
  baseUrl: string
  modelId: unknown
}): Promise<Record<string, unknown>> {
  const remotePath = parseRemoteWorkflowPath(params.modelId)
  if (remotePath) {
    const encodedPath = encodeURIComponent(remotePath)
    const response = await fetch(`${params.baseUrl}/userdata/${encodedPath}`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      throw new Error(`COMFYUI_WORKFLOW_DOWNLOAD_FAILED: HTTP ${response.status}`)
    }
    return await response.json() as Record<string, unknown>
  }

  const workflowPath = process.env.COMFYUI_VIDEO_WORKFLOW_PATH?.trim()
  if (!workflowPath) throw new Error('COMFYUI_WORKFLOW_NOT_SELECTED')
  return JSON.parse(await readFile(workflowPath, 'utf8')) as Record<string, unknown>
}

function normalizeLinks(raw: Record<string, unknown>): LinkTuple[] {
  const rawLinks = Array.isArray(raw.links) ? raw.links : []
  return rawLinks.flatMap((link): LinkTuple[] => {
    if (Array.isArray(link) && link.length >= 6) return [link.slice(0, 6) as LinkTuple]
    if (!link || typeof link !== 'object') return []
    const item = link as Record<string, unknown>
    return [[item.id, item.origin_id, item.origin_slot, item.target_id, item.target_slot, item.type]]
  })
}

function uiToApiNodes(raw: Record<string, unknown>): ApiWorkflow {
  const nodes = raw.nodes
  if (!Array.isArray(nodes)) return raw as ApiWorkflow
  const links = new Map<number, unknown[]>()
  for (const link of normalizeLinks(raw)) {
    links.set(Number(link[0]), link)
  }
  const api: ApiWorkflow = {}
  for (const item of nodes) {
    if (!item || typeof item !== 'object') continue
    const node = item as Record<string, unknown>
    const id = String(node.id)
    const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : []
    const inputs: Record<string, unknown> = {}
    let widgetIndex = 0
    for (const rawInput of Array.isArray(node.inputs) ? node.inputs : []) {
      if (!rawInput || typeof rawInput !== 'object') continue
      const input = rawInput as Record<string, unknown>
      const name = String(input.name)
      const type = String(input.type || '')
      const linkId = input.link
      const isAutoGrow = /^values\.[a-z]+$/.test(name)
      if (linkId !== null && linkId !== undefined) {
        const link = links.get(Number(linkId))
        inputs[name] = link ? [String(link[1]), Number(link[2])] : null
      } else if (LINK_TYPES.has(type) || isAutoGrow) {
        inputs[name] = null
      } else {
        inputs[name] = widgets[widgetIndex] ?? null
      }
      if (!LINK_TYPES.has(type) && !isAutoGrow) widgetIndex += 1
    }
    api[id] = { class_type: String(node.type), inputs }
  }
  return api
}

function readSubgraphDefinitions(raw: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const definitions = raw.definitions
  if (!definitions || typeof definitions !== 'object') return new Map()
  const subgraphs = (definitions as { subgraphs?: unknown }).subgraphs
  if (!Array.isArray(subgraphs)) return new Map()
  return new Map(subgraphs.flatMap((subgraph): Array<[string, Record<string, unknown>]> => {
    if (!subgraph || typeof subgraph !== 'object') return []
    const definition = subgraph as Record<string, unknown>
    return typeof definition.id === 'string' ? [[definition.id, definition]] : []
  }))
}

function cloneInput(value: unknown): unknown {
  return Array.isArray(value) ? [...value] : value
}

export function convertComfyWorkflowToApi(raw: Record<string, unknown>): ApiWorkflow {
  const api = uiToApiNodes(raw)
  if (!Array.isArray(raw.nodes)) return api
  const definitions = readSubgraphDefinitions(raw)
  if (definitions.size === 0) return api

  for (const rawNode of raw.nodes) {
    if (!rawNode || typeof rawNode !== 'object') continue
    const instance = rawNode as Record<string, unknown>
    const instanceId = String(instance.id)
    const definition = definitions.get(String(instance.type))
    if (!definition) continue
    const instanceApi = api[instanceId]
    if (!instanceApi) throw new Error(`COMFYUI_SUBGRAPH_INSTANCE_INVALID: ${instanceId}`)

    const innerApi = uiToApiNodes(definition)
    const definitionInputs = Array.isArray(definition.inputs) ? definition.inputs : []
    const prefix = `${instanceId}:`

    for (const [innerId, innerNode] of Object.entries(innerApi)) {
      if (innerId === '-10' || innerId === '-20') continue
      const remappedInputs: Record<string, unknown> = {}
      for (const [name, value] of Object.entries(innerNode.inputs)) {
        if (!Array.isArray(value) || value.length < 2) {
          remappedInputs[name] = value
          continue
        }
        const sourceId = String(value[0])
        const sourceSlot = Number(value[1])
        if (sourceId === '-10') {
          const inputDefinition = definitionInputs[sourceSlot]
          const inputName = inputDefinition && typeof inputDefinition === 'object'
            ? String((inputDefinition as { name?: unknown }).name || '')
            : ''
          remappedInputs[name] = cloneInput(instanceApi.inputs[inputName])
        } else {
          remappedInputs[name] = [`${prefix}${sourceId}`, sourceSlot]
        }
      }
      api[`${prefix}${innerId}`] = { class_type: innerNode.class_type, inputs: remappedInputs }
    }

    const outputSources = new Map<number, [string, number]>()
    for (const link of normalizeLinks(definition)) {
      if (String(link[3]) !== '-20') continue
      outputSources.set(Number(link[4]), [`${prefix}${String(link[1])}`, Number(link[2])])
    }
    for (const node of Object.values(api)) {
      for (const [name, value] of Object.entries(node.inputs)) {
        if (!Array.isArray(value) || String(value[0]) !== instanceId) continue
        const replacement = outputSources.get(Number(value[1]))
        if (!replacement) throw new Error(`COMFYUI_SUBGRAPH_OUTPUT_NOT_FOUND: ${instanceId}:${String(value[1])}`)
        node.inputs[name] = [...replacement]
      }
    }
    delete api[instanceId]
  }

  return api
}

function injectWorkflow(workflow: ApiWorkflow, imageName: string, prompt: string, options: Record<string, unknown>) {
  let imageInjected = false
  let promptInjected = false
  for (const node of Object.values(workflow)) {
    if (!imageInjected && node.class_type === 'LoadImage' && 'image' in node.inputs) {
      node.inputs.image = imageName
      imageInjected = true
    }
    if (!promptInjected && 'prompt' in node.inputs) {
      node.inputs.prompt = prompt
      promptInjected = true
    }
  }
  if (!imageInjected) throw new Error('COMFYUI_WORKFLOW_IMAGE_NODE_NOT_FOUND')
  if (!promptInjected) throw new Error('COMFYUI_WORKFLOW_PROMPT_NODE_NOT_FOUND')

  const duration = typeof options.duration === 'number' ? options.duration : 5
  const rawAspectRatio = typeof options.aspectRatio === 'string' ? options.aspectRatio : undefined
  const aspectRatioLabels: Record<string, string> = {
    '1:1': '1:1 (Square)',
    '2:3': '2:3 (Portrait Photo)',
    '3:2': '3:2 (Photo)',
    '3:4': '3:4 (Portrait Standard)',
    '4:3': '4:3 (Standard)',
    '9:16': '9:16 (Portrait Widescreen)',
    '16:9': '16:9 (Widescreen)',
    '21:9': '21:9 (Ultrawide)',
  }
  const aspectRatio = rawAspectRatio ? (aspectRatioLabels[rawAspectRatio] || rawAspectRatio) : undefined
  for (const node of Object.values(workflow)) {
    if (node.class_type === 'PrimitiveFloat' && 'value' in node.inputs) node.inputs.value = duration
    if (aspectRatio && 'aspect_ratio' in node.inputs) node.inputs.aspect_ratio = aspectRatio
    if (typeof options.fps === 'number' && node.class_type === 'CreateVideo' && 'fps' in node.inputs) {
      node.inputs.fps = options.fps
    }
    if ('noise_seed' in node.inputs) node.inputs.noise_seed = Math.floor(Math.random() * 2_147_483_647)
  }
}

async function loadImageBytes(imageUrl: string): Promise<{ bytes: Uint8Array; name: string; type: string }> {
  const dataUrl = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(imageUrl)
  if (dataUrl) {
    const type = dataUrl[1] || 'image/png'
    const bytes = dataUrl[2]
      ? new Uint8Array(Buffer.from(dataUrl[3], 'base64'))
      : new Uint8Array(Buffer.from(decodeURIComponent(dataUrl[3]), 'utf8'))
    const extension = type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
    return { bytes, name: `waoowaoo-input.${extension}`, type }
  }
  if (/^https?:\/\//i.test(imageUrl)) {
    const response = await fetch(imageUrl)
    if (!response.ok) throw new Error(`COMFYUI_INPUT_DOWNLOAD_FAILED: HTTP ${response.status}`)
    return { bytes: new Uint8Array(await response.arrayBuffer()), name: 'waoowaoo-input.png', type: response.headers.get('content-type') || 'image/png' }
  }
  const path = imageUrl.startsWith('file://') ? new URL(imageUrl) : imageUrl
  return { bytes: new Uint8Array(await readFile(path)), name: basename(typeof path === 'string' ? path : path.pathname), type: 'image/png' }
}

function findOutput(outputs: Record<string, Record<string, unknown>>): { filename: string; subfolder?: string; type?: string } | null {
  for (const output of Object.values(outputs)) {
    for (const key of ['videos', 'gifs', 'images']) {
      const items = output[key]
      if (Array.isArray(items) && items[0] && typeof items[0] === 'object') {
        const item = items[0] as Record<string, unknown>
        if (typeof item.filename === 'string') return { filename: item.filename, subfolder: String(item.subfolder || ''), type: String(item.type || 'output') }
      }
    }
  }
  return null
}

function pruneClassType(workflow: ApiWorkflow, classType: string): boolean {
  const target = Object.entries(workflow).find(([, node]) => node.class_type === classType)?.[0]
  if (!target) return false
  delete workflow[target]
  for (const node of Object.values(workflow)) {
    for (const [name, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && String(value[0]) === target) node.inputs[name] = null
    }
  }
  return true
}

export class ComfyUIVideoGenerator extends BaseVideoGenerator {
  protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
    const providerId = typeof params.options?.provider === 'string' ? params.options.provider : 'comfyui'
    const config = await getProviderConfig(params.userId, providerId)
    if (!config.baseUrl) throw new Error('COMFYUI_BASE_URL_REQUIRED')
    const baseUrl = trimBaseUrl(config.baseUrl)

    const input = await loadImageBytes(params.imageUrl)
    const form = new FormData()
    const imageBuffer = input.bytes.buffer.slice(
      input.bytes.byteOffset,
      input.bytes.byteOffset + input.bytes.byteLength,
    ) as ArrayBuffer
    form.append('image', new Blob([imageBuffer], { type: input.type }), input.name)
    form.append('overwrite', 'true')
    const upload = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: form })
    if (!upload.ok) throw new Error(`COMFYUI_UPLOAD_FAILED: HTTP ${upload.status} ${await upload.text()}`)
    const uploaded = await upload.json() as { name: string; subfolder?: string }
    const imageName = uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name

    const optimizedPrompt = params.options?.optimizePrompt === false
      ? (params.prompt || '')
      : await optimizeMiniMaxH3Prompt({
          userId: params.userId,
          analysisModel: typeof params.options?.analysisModel === 'string' ? params.options.analysisModel : undefined,
          projectId: typeof params.options?.projectId === 'string' ? params.options.projectId : undefined,
          prompt: params.prompt || '',
          dialogueContext: typeof params.options?.dialogueContext === 'string' ? params.options.dialogueContext : undefined,
          dialogueSpeaker: typeof params.options?.dialogueSpeaker === 'string' ? params.options.dialogueSpeaker : undefined,
          duration: typeof params.options?.duration === 'number' ? params.options.duration : undefined,
        })
    const raw = await loadWorkflow({
      baseUrl,
      modelId: params.options?.modelId,
    })
    const workflow = convertComfyWorkflowToApi(raw)
    while (pruneClassType(workflow, 'MarkdownNote')) {
      // Frontend-only note nodes are not executable API nodes.
    }
    injectWorkflow(workflow, imageName, optimizedPrompt, params.options || {})
    const submit = await fetch(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: `waoowaoo-${randomUUID()}` }),
    })
    const text = await submit.text()
    if (!submit.ok) throw new Error(`COMFYUI_SUBMIT_FAILED: HTTP ${submit.status} ${text}`)
    const promptId = (JSON.parse(text) as { prompt_id?: string }).prompt_id
    if (!promptId) throw new Error('COMFYUI_PROMPT_ID_MISSING')

    const timeoutAt = Date.now() + 30 * 60 * 1000
    while (Date.now() < timeoutAt) {
      await new Promise(resolve => setTimeout(resolve, 3000))
      const historyResponse = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`)
      if (!historyResponse.ok) continue
      const history = await historyResponse.json() as Record<string, { outputs?: Record<string, Record<string, unknown>>; status?: Record<string, unknown> }>
      const item = history[promptId]
      if (!item) continue
      if (item.status?.status_str === 'error') throw new Error(`COMFYUI_EXECUTION_FAILED: ${JSON.stringify(item.status)}`)
      const output = findOutput(item.outputs || {})
      if (!output) continue
      const query = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder || '', type: output.type || 'output' })
      return { success: true, videoUrl: `${baseUrl}/view?${query.toString()}`, requestId: promptId }
    }
    throw new Error('COMFYUI_TIMEOUT: generation exceeded 30 minutes')
  }
}
