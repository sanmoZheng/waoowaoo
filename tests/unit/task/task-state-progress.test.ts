import { describe, expect, it } from 'vitest'
import { resolveTargetState } from '@/lib/task/state-service'

describe('task target progress details', () => {
  it('exposes progress message and metadata for batch UI', () => {
    const state = resolveTargetState(
      { targetType: 'NovelPromotionProject', targetId: 'project-1' },
      [{
        id: 'task-1',
        type: 'character_profile_batch_confirm',
        status: 'processing',
        progress: 44,
        payload: {
          stage: 'character_profile_batch_loop_character',
          stageLabel: '批量角色档案确认中',
          message: '2/5 顾言深',
          meta: { characterId: 'character-2', completed: 1, total: 5 },
        },
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date('2026-08-20T08:00:00.000Z'),
      }],
    )

    expect(state.phase).toBe('processing')
    expect(state.message).toBe('2/5 顾言深')
    expect(state.meta).toEqual({ characterId: 'character-2', completed: 1, total: 5 })
  })
})
