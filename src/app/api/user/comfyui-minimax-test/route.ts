import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { convertComfyWorkflowToApi } from '@/lib/generators/video/comfyui'

type ApiNode = { class_type: string; inputs: Record<string, unknown> }
type ApiWorkflow = Record<string, ApiNode>
const LIMITS = { images: 9, videos: 3, audios: 3 }
const RESOLUTION_MEGAPIXELS: Record<string, number> = {
  '480P': 0.4,
  '540P': 0.5,
  '576P': 0.6,
  '600P': 0.65,
  '720P': 0.9,
  '768P': 1.0,
  '900P': 1.4,
  '1080P': 2.0,
}

export function resolveMinimaxMegapixels(resolution: string): number {
  const megapixels = RESOLUTION_MEGAPIXELS[resolution.toUpperCase()]
  if (megapixels === undefined) throw new Error(`COMFYUI_RESOLUTION_INVALID: ${resolution}`)
  return megapixels
}

function baseUrl(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') throw new Error('COMFYUI_BASE_URL_REQUIRED')
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('COMFYUI_BASE_URL_INVALID')
  return url.toString().replace(/\/$/, '')
}

function workflowPath(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('COMFYUI_WORKFLOW_REQUIRED')
  const path = value.trim().replace(/\\/g, '/').replace(/^workflows\//, '')
  if (path.includes('..') || !path.toLowerCase().endsWith('.json')) throw new Error('COMFYUI_WORKFLOW_PATH_INVALID')
  return path
}

function getFiles(form: FormData, key: string, max: number) {
  const result = form.getAll(key).filter((value): value is File => value instanceof File && value.size > 0)
  if (result.length > max) throw new Error(`${key.toUpperCase()}_LIMIT_EXCEEDED: max ${max}`)
  return result
}

async function upload(url: string, file: File) {
  const body = new FormData()
  body.append('image', file, `waoowaoo-${randomUUID()}-${file.name}`)
  body.append('overwrite', 'true')
  const response = await fetch(`${url}/upload/image`, { method: 'POST', body, signal: AbortSignal.timeout(120_000) })
  const text = await response.text()
  if (!response.ok) throw new Error(`COMFYUI_UPLOAD_FAILED: ${file.name}: HTTP ${response.status} ${text}`)
  const item = JSON.parse(text) as { name: string; subfolder?: string }
  return item.subfolder ? `${item.subfolder}/${item.name}` : item.name
}

function validateTags(prompt: string, counts: { images: number; videos: number; audios: number }) {
  const definitions: Array<[RegExp, number, string]> = [
    [/<Picture\s+(\d+)>/gi, counts.images, 'Picture'],
    [/<Video\s+(\d+)>/gi, counts.videos, 'Video'],
    [/<Audio\s+(\d+)>/gi, counts.audios + counts.videos, 'Audio'],
  ]
  for (const [pattern, count, label] of definitions) {
    for (const match of prompt.matchAll(pattern)) {
      if (Number(match[1]) < 1 || Number(match[1]) > count) throw new Error(`MINIMAX_REFERENCE_TAG_INVALID: <${label} ${match[1]}> 没有对应素材`)
    }
  }
}

function buildWorkflow(raw: Record<string, unknown>, input: { prompt: string; duration: number; aspect: string; resolution: string; quality: string; useVideoAudio: boolean; images: string[]; videos: string[]; audios: string[] }) {
  const workflow = convertComfyWorkflowToApi(raw) as ApiWorkflow
  const removable = new Set(Object.entries(workflow).filter(([, node]) => ['LoadImage', 'LoadVideo', 'LoadAudio', 'GetVideoComponents', 'MarkdownNote'].includes(node.class_type)).map(([id]) => id))
  removable.forEach(id => delete workflow[id])
  Object.values(workflow).forEach(node => Object.entries(node.inputs).forEach(([key, value]) => {
    if (Array.isArray(value) && removable.has(String(value[0]))) node.inputs[key] = null
  }))
  const core = Object.values(workflow).find(node => node.class_type === 'MiniMaxH3ReferenceToVideo')
  if (!core) throw new Error('COMFYUI_MINIMAX_REFERENCE_NODE_NOT_FOUND')
  core.inputs.prompt = input.prompt
  core.inputs.ref_image_size = input.quality === 'max' ? 'max' : 'match'
  core.inputs.length = Math.max(5, Math.min(3600, Math.round(input.duration * 24 + 4)))
  input.images.forEach((name, i) => { const id = `waoo_image_${i}`; workflow[id] = { class_type: 'LoadImage', inputs: { image: name } }; core.inputs[`ref_images.ref_image_${i}`] = [id, 0] })
  input.videos.forEach((name, i) => { const load = `waoo_video_${i}`; const parts = `waoo_video_parts_${i}`; workflow[load] = { class_type: 'LoadVideo', inputs: { file: name } }; workflow[parts] = { class_type: 'GetVideoComponents', inputs: { video: [load, 0] } }; core.inputs[`ref_videos.ref_video_${i}`] = [parts, 0]; if (input.useVideoAudio) core.inputs[`ref_video_audios.ref_video_audio_${i}`] = [parts, 1] })
  input.audios.forEach((name, i) => { const id = `waoo_audio_${i}`; workflow[id] = { class_type: 'LoadAudio', inputs: { audio: name } }; core.inputs[`ref_audios.ref_audio_${i}`] = [id, 0] })
  const aspects: Record<string, string> = { '16:9': '16:9 (Widescreen)', '9:16': '9:16 (Portrait Widescreen)', '1:1': '1:1 (Square)' }
  const megapixels = resolveMinimaxMegapixels(input.resolution)
  let resolutionNodeFound = false
  Object.values(workflow).forEach(node => {
    if (node.class_type === 'PrimitiveFloat' && 'value' in node.inputs) node.inputs.value = input.duration
    if ('aspect_ratio' in node.inputs) node.inputs.aspect_ratio = aspects[input.aspect] || input.aspect
    if (node.class_type === 'ResolutionSelector' && 'megapixels' in node.inputs) {
      node.inputs.megapixels = megapixels
      resolutionNodeFound = true
    }
    if ('noise_seed' in node.inputs) node.inputs.noise_seed = Math.floor(Math.random() * 2_147_483_647)
  })
  if (!resolutionNodeFound) throw new Error('COMFYUI_RESOLUTION_SELECTOR_NOT_FOUND: 工作流缺少 User inputs/ResolutionSelector 的百万像素参数')
  return workflow
}

export const POST = apiHandler(async (request: NextRequest) => {
  const auth = await requireUserAuth(); if (isErrorResponse(auth)) return auth
  const form = await request.formData(); const url = baseUrl(form.get('baseUrl')); const path = workflowPath(form.get('workflowPath'))
  const prompt = String(form.get('prompt') || '').trim(); if (!prompt) throw new Error('MINIMAX_PROMPT_REQUIRED')
  const imageFiles = getFiles(form, 'images', LIMITS.images); const videoFiles = getFiles(form, 'videos', LIMITS.videos); const audioFiles = getFiles(form, 'audios', LIMITS.audios); const useVideoAudio = form.get('useVideoAudio') === 'true'
  if (!imageFiles.length && !videoFiles.length && !audioFiles.length) throw new Error('MINIMAX_REFERENCE_REQUIRED')
  validateTags(prompt, { images: imageFiles.length, videos: videoFiles.length, audios: audioFiles.length + (useVideoAudio ? videoFiles.length : 0) })
  const workflowResponse = await fetch(`${url}/userdata/${encodeURIComponent(`workflows/${path}`)}`, { signal: AbortSignal.timeout(20_000) })
  if (!workflowResponse.ok) throw new Error(`COMFYUI_WORKFLOW_DOWNLOAD_FAILED: HTTP ${workflowResponse.status}`)
  const [images, videos, audios] = await Promise.all([Promise.all(imageFiles.map(file => upload(url, file))), Promise.all(videoFiles.map(file => upload(url, file))), Promise.all(audioFiles.map(file => upload(url, file)))])
  const workflow = buildWorkflow(await workflowResponse.json() as Record<string, unknown>, { prompt, duration: Number(form.get('duration') || 5), aspect: String(form.get('aspectRatio') || '16:9'), resolution: String(form.get('resolution') || '720P').toUpperCase(), quality: String(form.get('refImageSize') || 'match'), useVideoAudio, images, videos, audios })
  const submit = await fetch(`${url}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: `waoowaoo-test-${randomUUID()}` }) })
  const text = await submit.text(); if (!submit.ok) throw new Error(`COMFYUI_SUBMIT_FAILED: HTTP ${submit.status} ${text}`)
  const promptId = (JSON.parse(text) as { prompt_id?: string }).prompt_id; if (!promptId) throw new Error('COMFYUI_PROMPT_ID_MISSING')
  return NextResponse.json({ success: true, promptId, counts: { images: images.length, videos: videos.length, audios: audios.length } })
})

export const GET = apiHandler(async (request: NextRequest) => {
  const auth = await requireUserAuth(); if (isErrorResponse(auth)) return auth
  const params = new URL(request.url).searchParams; const url = params.get('baseUrl')?.replace(/\/$/, '') || ''; const promptId = params.get('promptId') || ''
  if (!url || !promptId) throw new Error('COMFYUI_STATUS_PARAMS_REQUIRED')
  const response = await fetch(`${url}/history/${encodeURIComponent(promptId)}`, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`COMFYUI_HISTORY_FAILED: HTTP ${response.status}`)
  const history = await response.json() as Record<string, { outputs?: Record<string, Record<string, unknown>>; status?: { status_str?: string; messages?: unknown } }>; const item = history[promptId]
  if (!item) return NextResponse.json({ success: true, status: 'running' })
  if (item.status?.status_str === 'error') return NextResponse.json({ success: false, status: 'failed', error: item.status.messages })
  for (const output of Object.values(item.outputs || {})) for (const key of ['videos', 'gifs', 'images']) { const first = Array.isArray(output[key]) ? output[key][0] as Record<string, unknown> | undefined : undefined; if (first?.filename) { const query = new URLSearchParams({ filename: String(first.filename), subfolder: String(first.subfolder || ''), type: String(first.type || 'output') }); return NextResponse.json({ success: true, status: 'completed', url: `${url}/view?${query}` }) } }
  return NextResponse.json({ success: true, status: 'running' })
})
