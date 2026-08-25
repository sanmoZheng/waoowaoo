import { describe, expect, it } from 'vitest'
import { resolveStoryToScriptStepAiOptions } from '@/lib/workers/handlers/story-to-script-step-options'

describe('resolveStoryToScriptStepAiOptions', () => {
  const defaults = {
    reasoning: true,
    reasoningEffort: 'high' as const,
  }

  it.each(['analyze_characters', 'analyze_locations', 'analyze_props'])(
    'uses fast structured mode for %s',
    (stepId) => {
      expect(resolveStoryToScriptStepAiOptions(stepId, defaults)).toEqual({
        reasoning: false,
        reasoningEffort: undefined,
        publishStreamChunks: false,
      })
    },
  )

  it('preserves reasoning and streaming for later creative steps', () => {
    expect(resolveStoryToScriptStepAiOptions('split_clips', defaults)).toEqual({
      reasoning: true,
      reasoningEffort: 'high',
      publishStreamChunks: true,
    })
  })
})
