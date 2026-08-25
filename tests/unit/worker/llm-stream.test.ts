import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { TaskJobData } from '@/lib/task/types'

const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const reportTaskStreamChunkMock = vi.hoisted(() => vi.fn(async () => undefined))
const assertTaskActiveMock = vi.hoisted(() => vi.fn(async () => undefined))
const isTaskActiveMock = vi.hoisted(() => vi.fn(async () => true))

vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: reportTaskProgressMock,
  reportTaskStreamChunk: reportTaskStreamChunkMock,
}))

vi.mock('@/lib/workers/utils', () => ({
  assertTaskActive: assertTaskActiveMock,
}))

vi.mock('@/lib/task/service', () => ({
  isTaskActive: isTaskActiveMock,
}))

import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from '@/lib/workers/handlers/llm-stream'

function buildJob(): Job<TaskJobData> {
  const data: TaskJobData = {
    taskId: 'task-1',
    type: 'story_to_script_run',
    locale: 'zh',
    projectId: 'project-1',
    userId: 'user-1',
    targetType: 'NovelPromotionEpisode',
    targetId: 'episode-1',
    payload: {},
    trace: null,
  }
  return {
    data,
  } as unknown as Job<TaskJobData>
}

describe('createWorkerLLMStreamCallbacks', () => {
  beforeEach(() => {
    reportTaskProgressMock.mockReset()
    reportTaskStreamChunkMock.mockReset()
    assertTaskActiveMock.mockReset()
    isTaskActiveMock.mockReset()
    isTaskActiveMock.mockResolvedValue(true)
  })

  it('publishes final step output on onComplete for replay recovery', async () => {
    const job = buildJob()
    const context = createWorkerLLMStreamContext(job, 'story_to_script')
    const callbacks = createWorkerLLMStreamCallbacks(job, context)

    expect(callbacks.onStage).toBeTruthy()
    callbacks.onStage?.({
      stage: 'streaming',
      provider: 'ark',
      step: {
        id: 'screenplay_clip_1',
        attempt: 2,
        title: 'progress.streamStep.screenplayConversion',
        index: 1,
        total: 1,
      },
    })
    expect(callbacks.onComplete).toBeTruthy()
    callbacks.onComplete?.('final screenplay text', {
      id: 'screenplay_clip_1',
      attempt: 2,
      title: 'progress.streamStep.screenplayConversion',
      index: 1,
      total: 1,
    })
    await callbacks.flush()

    const finalProgressCall = reportTaskProgressMock.mock.calls.find((call) => {
      const payload = (call as unknown as [unknown, unknown, Record<string, unknown> | undefined])[2]
      return payload?.stage === 'worker_llm_complete'
    })

    expect(finalProgressCall).toBeDefined()
    const payload = (finalProgressCall as unknown as [unknown, unknown, Record<string, unknown>])[2]
    expect(payload.done).toBe(true)
    expect(payload.output).toBe('final screenplay text')
    expect(payload.stepId).toBe('screenplay_clip_1')
    expect(payload.stepAttempt).toBe(2)
    expect(payload.stepTitle).toBe('progress.streamStep.screenplayConversion')
    expect(payload.stepIndex).toBe(1)
    expect(payload.stepTotal).toBe(1)
  })

  it('keeps completion payload bound to provided step under interleaved steps', async () => {
    const job = buildJob()
    const context = createWorkerLLMStreamContext(job, 'story_to_script')
    const callbacks = createWorkerLLMStreamCallbacks(job, context)

    expect(callbacks.onChunk).toBeTruthy()
    callbacks.onChunk?.({
      kind: 'text',
      delta: 'A-',
      seq: 1,
      lane: 'main',
      step: { id: 'analyze_characters', attempt: 1, title: 'A', index: 1, total: 2 },
    })
    callbacks.onChunk?.({
      kind: 'text',
      delta: 'B-',
      seq: 1,
      lane: 'main',
      step: { id: 'analyze_locations', attempt: 1, title: 'B', index: 2, total: 2 },
    })
    expect(callbacks.onComplete).toBeTruthy()
    callbacks.onComplete?.('characters-final', {
      id: 'analyze_characters',
      attempt: 1,
      title: 'A',
      index: 1,
      total: 2,
    })
    await callbacks.flush()

    const finalProgressCall = reportTaskProgressMock.mock.calls.find((call) => {
      const payload = (call as unknown as [unknown, unknown, Record<string, unknown> | undefined])[2]
      return payload?.stage === 'worker_llm_complete'
    })

    expect(finalProgressCall).toBeDefined()
    const payload = (finalProgressCall as unknown as [unknown, unknown, Record<string, unknown>])[2]
    expect(payload.stepId).toBe('analyze_characters')
    expect(payload.stepTitle).toBe('A')
    expect(payload.output).toBe('characters-final')
  })

  it('uses injected active controller for run-owned workflows', async () => {
    const job = buildJob()
    const context = createWorkerLLMStreamContext(job, 'story_to_script')
    const assertActive = vi.fn(async () => undefined)
    const isActive = vi.fn(async () => true)
    const callbacks = createWorkerLLMStreamCallbacks(job, context, {
      assertActive,
      isActive,
    })

    callbacks.onChunk?.({
      kind: 'text',
      delta: 'hello',
      seq: 1,
      lane: 'main',
      step: { id: 'split_clips', attempt: 1, title: 'split', index: 1, total: 1 },
    })
    await callbacks.flush()

    expect(assertActive).toHaveBeenCalledWith('worker_llm_stream')
    expect(assertTaskActiveMock).not.toHaveBeenCalled()
    expect(reportTaskStreamChunkMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        delta: 'hello',
      }),
      expect.objectContaining({
        stepId: 'split_clips',
      }),
    )
  })

  it('can suppress intermediate chunks while preserving the final output', async () => {
    const job = buildJob()
    const context = createWorkerLLMStreamContext(job, 'story_to_script')
    const callbacks = createWorkerLLMStreamCallbacks(job, context, {
      publishStreamChunks: false,
    })

    callbacks.onChunk?.({
      kind: 'reasoning',
      delta: 'verbose reasoning',
      seq: 1,
      lane: 'reasoning',
      step: { id: 'analyze_locations', attempt: 1, title: 'locations', index: 1, total: 1 },
    })
    callbacks.onComplete?.('final structured result', {
      id: 'analyze_locations',
      attempt: 1,
      title: 'locations',
      index: 1,
      total: 1,
    })
    await callbacks.flush()

    expect(reportTaskStreamChunkMock).not.toHaveBeenCalled()
    expect(reportTaskProgressMock).toHaveBeenCalledWith(
      expect.anything(),
      90,
      expect.objectContaining({
        stage: 'worker_llm_complete',
        output: 'final structured result',
        stepId: 'analyze_locations',
      }),
    )
  })

  it('coalesces many small chunks into a small number of Redis publications', async () => {
    const job = buildJob()
    const context = createWorkerLLMStreamContext(job, 'story_to_script')
    const callbacks = createWorkerLLMStreamCallbacks(job, context)

    for (let index = 0; index < 10; index += 1) {
      callbacks.onChunk?.({
        kind: 'text',
        delta: 'x'.repeat(128),
        seq: index + 1,
        lane: 'main',
        step: { id: 'analyze_locations', attempt: 1, title: 'locations', index: 1, total: 1 },
      })
    }
    await callbacks.flush()

    expect(reportTaskStreamChunkMock).toHaveBeenCalledTimes(2)
    const publishedText = (reportTaskStreamChunkMock.mock.calls as unknown as Array<[unknown, { delta: string }]>)
      .map((call) => call[1].delta)
      .join('')
    expect(publishedText).toHaveLength(1280)
  })

  it('does not wait for slow progress publication when flushing in background', () => {
    reportTaskStreamChunkMock.mockImplementationOnce(async () => await new Promise<undefined>(() => undefined))
    const job = buildJob()
    const context = createWorkerLLMStreamContext(job, 'story_to_script')
    const callbacks = createWorkerLLMStreamCallbacks(job, context)

    callbacks.onChunk?.({
      kind: 'text',
      delta: 'latest progress',
      seq: 1,
      lane: 'main',
      step: { id: 'analyze_locations', attempt: 1, title: 'locations', index: 1, total: 1 },
    })

    expect(() => callbacks.flushInBackground()).not.toThrow()
  })
})
