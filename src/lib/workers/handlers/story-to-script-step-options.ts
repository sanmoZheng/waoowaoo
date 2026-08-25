export type StoryToScriptReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

const FAST_STRUCTURED_ANALYSIS_STEPS = new Set([
  'analyze_characters',
  'analyze_locations',
  'analyze_props',
])

function shouldPublishStreamChunks(stepId: string) {
  if (FAST_STRUCTURED_ANALYSIS_STEPS.has(stepId)) return false
  // 剧本转换只展示阶段进度和最终结构化结果，避免把长文本逐块写入 Redis/SSE。
  if (stepId.startsWith('screenplay_')) return false
  return true
}

export function resolveStoryToScriptStepAiOptions(
  stepId: string,
  defaults: {
    reasoning: boolean
    reasoningEffort: StoryToScriptReasoningEffort
  },
) {
  const fastStructuredAnalysis = FAST_STRUCTURED_ANALYSIS_STEPS.has(stepId)

  return {
    reasoning: fastStructuredAnalysis ? false : defaults.reasoning,
    reasoningEffort: fastStructuredAnalysis ? undefined : defaults.reasoningEffort,
    publishStreamChunks: shouldPublishStreamChunks(stepId),
  }
}
