import { resolveTaskResponse } from '@/lib/task/client'

interface ApiFetchLike {
  (input: string, init?: RequestInit): Promise<Response>
}

interface ExpandHomeStoryPayload {
  expandedText?: string
}

const AUTO_EXPAND_SHORT_TEXT_LENGTH = 200
const AUTO_EXPAND_OUTLINE_MAX_LENGTH = 500

/**
 * 首页主按钮需要同时接受“主题/梗概”和“完整正文”。短输入或缺少叙事句边界的
 * 简短大纲会先走故事扩写；较长正文保持原样，避免用户的剧本被二次改写。
 */
export function shouldAutoExpandHomeStory(input: string): boolean {
  const normalized = input.trim()
  if (!normalized) return false
  if (normalized.length < AUTO_EXPAND_SHORT_TEXT_LENGTH) return true

  const sentenceBoundaryCount = (normalized.match(/[。！？!?\n]/g) || []).length
  return normalized.length < AUTO_EXPAND_OUTLINE_MAX_LENGTH && sentenceBoundaryCount < 3
}

export interface ExpandHomeStoryParams {
  apiFetch: ApiFetchLike
  prompt: string
}

export interface ExpandHomeStoryResult {
  expandedText: string
}

export async function expandHomeStory({
  apiFetch,
  prompt,
}: ExpandHomeStoryParams): Promise<ExpandHomeStoryResult> {
  const response = await apiFetch('/api/user/ai-story-expand', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
    }),
  })

  const result = await resolveTaskResponse<ExpandHomeStoryPayload>(response)
  const expandedText = typeof result.expandedText === 'string' ? result.expandedText.trim() : ''
  if (!expandedText) {
    throw new Error('AI story expand response missing expandedText')
  }

  return {
    expandedText,
  }
}
