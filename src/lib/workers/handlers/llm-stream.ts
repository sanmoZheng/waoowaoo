import type { Job } from 'bullmq'
import { type InternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import type { LLMStreamKind } from '@/lib/llm-observe/types'
import { TaskTerminatedError } from '@/lib/task/errors'
import { isTaskActive } from '@/lib/task/service'
import { reportTaskProgress, reportTaskStreamChunk } from '@/lib/workers/shared'
import type { TaskJobData } from '@/lib/task/types'
import { assertTaskActive } from '@/lib/workers/utils'

export type WorkerLLMStreamContext = {
  streamRunId: string
  nextSeqByStepLane: Record<string, number>
}

export type WorkerInternalLLMStreamCallbacks = InternalLLMStreamCallbacks & {
  flush: () => Promise<void>
  flushInBackground: () => void
}

export type WorkerLLMActiveController = {
  assertActive?: (stage: string) => Promise<void>
  isActive?: () => Promise<boolean>
}

export function createWorkerLLMStreamContext(job: Job<TaskJobData>, label = 'worker'): WorkerLLMStreamContext {
  return {
    streamRunId: `run:${job.data.taskId}:${label}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
    nextSeqByStepLane: {},
  }
}

function nextWorkerStreamSeq(streamContext: WorkerLLMStreamContext, stepId: string | null, lane: string) {
  const key = `${stepId || '__default'}|${lane || 'main'}`
  const current = streamContext.nextSeqByStepLane[key] || 1
  streamContext.nextSeqByStepLane[key] = current + 1
  return current
}

export function createWorkerLLMStreamCallbacks(
  job: Job<TaskJobData>,
  streamContext: WorkerLLMStreamContext,
  activeController?: WorkerLLMActiveController,
): WorkerInternalLLMStreamCallbacks {
  const chunkBatchChars = 1024
  const maxBufferedChars = 2000
  const chunkBatchDelayMs = 1000
  const activeProbeIntervalMs = 600
  let publishQueue: Promise<void> = Promise.resolve()
  let terminatedError: TaskTerminatedError | null = null
  let checkingActive = false
  let lastActiveProbeAt = 0
  let batchTimer: ReturnType<typeof setTimeout> | null = null
  const chunkBatches = new Map<string, {
    kind: LLMStreamKind
    delta: string
    lane: string
    stepId: string | null
    stepAttempt: number | null
    stepTitle: string | null
    stepIndex: number | null
    stepTotal: number | null
  }>()

  const markTerminated = (stage: string) => {
    if (terminatedError) return
    terminatedError = new TaskTerminatedError(
      job.data.taskId,
      `Task terminated during ${stage}`,
    )
  }

  const ensureActiveOrThrow = (stage: string) => {
    void stage
    if (terminatedError) throw terminatedError
  }

  const assertActive = async (stage: string) => {
    if (activeController?.assertActive) {
      await activeController.assertActive(stage)
      return
    }
    await assertTaskActive(job, stage)
  }

  const probeActive = async () => {
    if (activeController?.isActive) {
      return await activeController.isActive()
    }
    return await isTaskActive(job.data.taskId)
  }

  const scheduleActiveProbe = () => {
    if (terminatedError || checkingActive) return
    const now = Date.now()
    if (now - lastActiveProbeAt < activeProbeIntervalMs) return
    checkingActive = true
    lastActiveProbeAt = now
    void probeActive()
      .then((active) => {
        if (!active) {
          markTerminated('worker_llm_stream_probe')
        }
      })
      .finally(() => {
        checkingActive = false
      })
  }

  const enqueue = (stage: string, work: () => Promise<void>) => {
    ensureActiveOrThrow(stage)
    scheduleActiveProbe()
    publishQueue = publishQueue
      .catch(() => undefined)
      .then(async () => {
        ensureActiveOrThrow(stage)
        await assertActive(stage)
        await work()
      })
      .catch((error) => {
        if (error instanceof TaskTerminatedError) {
          markTerminated(stage)
          return
        }
        throw error
      })
  }

  const publishBufferedChunks = () => {
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }
    if (chunkBatches.size === 0) return

    const batches = [...chunkBatches.values()]
    chunkBatches.clear()
    for (const batch of batches) {
      enqueue('worker_llm_stream', async () => {
        await reportTaskStreamChunk(
          job,
          {
            kind: batch.kind,
            delta: batch.delta,
            seq: nextWorkerStreamSeq(streamContext, batch.stepId, batch.lane),
            lane: batch.lane,
          },
          {
            stage: 'worker_llm_stream',
            stageLabel: 'progress.runtime.stage.llmStreaming',
            displayMode: 'detail',
            done: false,
            message: batch.kind === 'reasoning' ? 'progress.runtime.llm.reasoning' : 'progress.runtime.llm.output',
            streamRunId: streamContext.streamRunId,
            ...(batch.stepId ? { stepId: batch.stepId } : {}),
            ...(batch.stepAttempt ? { stepAttempt: batch.stepAttempt } : {}),
            ...(batch.stepTitle ? { stepTitle: batch.stepTitle } : {}),
            ...(batch.stepIndex ? { stepIndex: batch.stepIndex } : {}),
            ...(batch.stepTotal ? { stepTotal: batch.stepTotal } : {}),
          },
        )
      })
    }
  }

  const scheduleBatchPublish = () => {
    if (batchTimer) return
    batchTimer = setTimeout(publishBufferedChunks, chunkBatchDelayMs)
    batchTimer.unref?.()
  }

  return {
    onStage: ({ stage, provider, step }) => {
      ensureActiveOrThrow(`worker_llm_stage:${stage}`)
      scheduleActiveProbe()
      const stageLabel =
        stage === 'submit'
          ? 'progress.runtime.stage.llmSubmit'
          : stage === 'streaming'
            ? 'progress.runtime.stage.llmStreaming'
            : stage === 'fallback'
              ? 'progress.runtime.stage.llmFallbackNonStream'
              : 'progress.runtime.stage.llmCompleted'
      const stageKey = `worker_llm_${stage}`
      const stepId = typeof step?.id === 'string' && step.id.trim() ? step.id.trim() : null
      const stepAttempt =
        typeof step?.attempt === 'number' && Number.isFinite(step.attempt)
          ? Math.max(1, Math.floor(step.attempt))
          : null
      const stepTitle = typeof step?.title === 'string' && step.title.trim() ? step.title.trim() : null
      const stepIndex =
        typeof step?.index === 'number' && Number.isFinite(step.index) ? Math.max(1, Math.floor(step.index)) : null
      const stepTotal =
        typeof step?.total === 'number' && Number.isFinite(step.total)
          ? Math.max(stepIndex || 1, Math.floor(step.total))
          : null
      enqueue(`worker_llm_stage:${stage}`, async () => {
        await reportTaskProgress(job, 65, {
          stage: stageKey,
          stageLabel,
          displayMode: 'detail',
          message: stageLabel,
          streamRunId: streamContext.streamRunId,
          ...(stepId ? { stepId } : {}),
          ...(stepAttempt ? { stepAttempt } : {}),
          ...(stepTitle ? { stepTitle } : {}),
          ...(stepIndex ? { stepIndex } : {}),
          ...(stepTotal ? { stepTotal } : {}),
          meta: {
            provider: provider || null,
          },
        })
      })
    },
    onChunk: ({ kind, delta, lane, step }) => {
      ensureActiveOrThrow('worker_llm_stream')
      scheduleActiveProbe()
      if (!delta) return
      const stepId = typeof step?.id === 'string' && step.id.trim() ? step.id.trim() : null
      const stepAttempt =
        typeof step?.attempt === 'number' && Number.isFinite(step.attempt)
          ? Math.max(1, Math.floor(step.attempt))
          : null
      const stepTitle = typeof step?.title === 'string' && step.title.trim() ? step.title.trim() : null
      const stepIndex =
        typeof step?.index === 'number' && Number.isFinite(step.index) ? Math.max(1, Math.floor(step.index)) : null
      const stepTotal =
        typeof step?.total === 'number' && Number.isFinite(step.total)
          ? Math.max(stepIndex || 1, Math.floor(step.total))
          : null
      const laneKey = lane || (kind === 'reasoning' ? 'reasoning' : 'main')
      const batchKey = `${stepId || '__default'}|${laneKey}`
      const previous = chunkBatches.get(batchKey)
      const combined = `${previous?.delta || ''}${delta}`
      chunkBatches.set(batchKey, {
        kind: kind as LLMStreamKind,
        // 进度流只保留最近内容；完整结果由 onComplete 单独发布。
        delta: combined.slice(-maxBufferedChars),
        lane: laneKey,
        stepId,
        stepAttempt,
        stepTitle,
        stepIndex,
        stepTotal,
      })
      if (combined.length >= chunkBatchChars) {
        publishBufferedChunks()
      } else {
        scheduleBatchPublish()
      }
    },
    onComplete: (text, step) => {
      ensureActiveOrThrow('worker_llm_complete')
      // 确保该步骤最后一批增量排在完成事件之前。
      publishBufferedChunks()
      const stepId = typeof step?.id === 'string' && step.id.trim() ? step.id.trim() : null
      const stepAttempt =
        typeof step?.attempt === 'number' && Number.isFinite(step.attempt)
          ? Math.max(1, Math.floor(step.attempt))
          : null
      const stepTitle = typeof step?.title === 'string' && step.title.trim() ? step.title.trim() : null
      const stepIndex =
        typeof step?.index === 'number' && Number.isFinite(step.index) ? Math.max(1, Math.floor(step.index)) : null
      const stepTotal =
        typeof step?.total === 'number' && Number.isFinite(step.total)
          ? Math.max(stepIndex || 1, Math.floor(step.total))
          : null
      enqueue('worker_llm_complete', async () => {
        await reportTaskProgress(job, 90, {
          stage: 'worker_llm_complete',
          stageLabel: 'progress.runtime.stage.llmCompleted',
          displayMode: 'detail',
          message: 'progress.runtime.llm.completed',
          done: true,
          ...(typeof text === 'string' ? { output: text } : {}),
          streamRunId: streamContext.streamRunId,
          ...(stepId ? { stepId } : {}),
          ...(stepAttempt ? { stepAttempt } : {}),
          ...(stepTitle ? { stepTitle } : {}),
          ...(stepIndex ? { stepIndex } : {}),
          ...(stepTotal ? { stepTotal } : {}),
        })
      })
    },
    onError: (error, step) => {
      if (error instanceof TaskTerminatedError) {
        markTerminated('worker_llm_error')
        throw error
      }
      ensureActiveOrThrow('worker_llm_error')
      const stepId = typeof step?.id === 'string' && step.id.trim() ? step.id.trim() : null
      const stepAttempt =
        typeof step?.attempt === 'number' && Number.isFinite(step.attempt)
          ? Math.max(1, Math.floor(step.attempt))
          : null
      const stepTitle = typeof step?.title === 'string' && step.title.trim() ? step.title.trim() : null
      const stepIndex =
        typeof step?.index === 'number' && Number.isFinite(step.index) ? Math.max(1, Math.floor(step.index)) : null
      const stepTotal =
        typeof step?.total === 'number' && Number.isFinite(step.total)
          ? Math.max(stepIndex || 1, Math.floor(step.total))
          : null
      enqueue('worker_llm_error', async () => {
        await reportTaskProgress(job, 90, {
          stage: 'worker_llm_error',
          stageLabel: 'progress.runtime.stage.llmFailed',
          displayMode: 'detail',
          message: error instanceof Error ? error.message : String(error),
          streamRunId: streamContext.streamRunId,
          ...(stepId ? { stepId } : {}),
          ...(stepAttempt ? { stepAttempt } : {}),
          ...(stepTitle ? { stepTitle } : {}),
          ...(stepIndex ? { stepIndex } : {}),
          ...(stepTotal ? { stepTotal } : {}),
        })
      })
    },
    async flush() {
      publishBufferedChunks()
      await publishQueue.catch(() => undefined)
      if (terminatedError) {
        throw terminatedError
      }
    },
    flushInBackground() {
      publishBufferedChunks()
      void publishQueue.catch(() => undefined)
    },
  }
}
