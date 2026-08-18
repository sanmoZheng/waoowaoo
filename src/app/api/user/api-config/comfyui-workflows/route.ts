import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('ComfyUI 地址不能为空')
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('ComfyUI 地址必须是有效的 HTTP/HTTPS 地址')
  }
  return url.toString().replace(/\/$/, '')
}

function readWorkflowPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item]
    if (!item || typeof item !== 'object') return []
    const path = (item as { path?: unknown }).path
    return typeof path === 'string' ? [path] : []
  }).map((path) => path.replace(/\\/g, '/'))
    .filter((path) => path.toLowerCase().endsWith('.json') && !path.includes('..'))
}

function inspectWorkflow(value: unknown): { compatible: boolean; reason: string | null } {
  if (!value || typeof value !== 'object') return { compatible: false, reason: '工作流 JSON 无效' }
  const raw = value as Record<string, unknown>
  if (Array.isArray(raw.nodes)) {
    const nodes = raw.nodes.filter((node): node is Record<string, unknown> => !!node && typeof node === 'object')
    const hasImage = nodes.some((node) => node.type === 'LoadImage')
    const hasPrompt = nodes.some((node) => Array.isArray(node.inputs) && node.inputs.some((input) => {
      return !!input && typeof input === 'object' && (input as { name?: unknown }).name === 'prompt'
    }))
    if (!hasImage) return { compatible: false, reason: '缺少 LoadImage 首帧输入节点' }
    if (!hasPrompt) return { compatible: false, reason: '缺少 prompt 提示词输入' }
    return { compatible: true, reason: null }
  }
  const nodes = Object.values(raw).filter((node): node is Record<string, unknown> => !!node && typeof node === 'object')
  const hasImage = nodes.some((node) => node.class_type === 'LoadImage')
  const hasPrompt = nodes.some((node) => {
    const inputs = node.inputs
    return !!inputs && typeof inputs === 'object' && 'prompt' in inputs
  })
  if (!hasImage) return { compatible: false, reason: '缺少 LoadImage 首帧输入节点' }
  if (!hasPrompt) return { compatible: false, reason: '缺少 prompt 提示词输入' }
  return { compatible: true, reason: null }
}

export const POST = apiHandler(async (request: NextRequest) => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth

  try {
    const body = await request.json() as { baseUrl?: unknown }
    const baseUrl = normalizeBaseUrl(body.baseUrl)
    const [statsResponse, workflowsResponse] = await Promise.all([
      fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(8_000) }),
      fetch(`${baseUrl}/userdata?dir=workflows&recurse=true&full_info=true`, { signal: AbortSignal.timeout(8_000) }),
    ])
    if (!statsResponse.ok) throw new Error(`连接失败：HTTP ${statsResponse.status}`)
    if (!workflowsResponse.ok) throw new Error(`无法读取工作流：HTTP ${workflowsResponse.status}`)

    const stats = await statsResponse.json() as { system?: { comfyui_version?: string } }
    const workflows = readWorkflowPaths(await workflowsResponse.json())
    const inspected = await Promise.all(workflows.map(async (path) => {
      try {
        const response = await fetch(`${baseUrl}/userdata/${encodeURIComponent(`workflows/${path}`)}`, {
          signal: AbortSignal.timeout(8_000),
        })
        if (!response.ok) return { compatible: false, reason: `读取失败：HTTP ${response.status}` }
        return inspectWorkflow(await response.json())
      } catch {
        return { compatible: false, reason: '读取或解析失败' }
      }
    }))
    return NextResponse.json({
      success: true,
      version: stats.system?.comfyui_version || null,
      workflows: workflows.map((path, index) => ({
        path,
        modelId: `workflow:${path}`,
        name: path.split('/').pop()?.replace(/\.json$/i, '') || path,
        ...inspected[index],
      })),
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : '读取 ComfyUI 工作流失败',
    }, { status: 400 })
  }
})
