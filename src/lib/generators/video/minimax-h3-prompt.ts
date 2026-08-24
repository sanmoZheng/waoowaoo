import { createHash } from 'node:crypto'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { logWarn } from '@/lib/logging/core'

const MAX_CACHE_ENTRIES = 500
const promptCache = new Map<string, string>()

const SYSTEM_PROMPT = `You convert storyboard shot descriptions into MiniMax H3 Image-to-Video prompts.

Rules:
1. The supplied image is the first frame. Preserve its characters, faces, clothing, props, lighting, composition and location. Never redesign or reintroduce them.
2. Describe only motion that is explicitly requested or physically necessary for the requested action. Do not invent secondary motion merely to make the shot busier.
3. Describe exactly one continuous shot. Do not add cuts, scene changes, new characters or new objects unless the source explicitly requires them.
4. Give camera direction as motion type + amplitude + speed. Prefer restrained motion when the source does not specify a camera move.
5. Arrange events in chronological order suitable for the supplied duration. Avoid impossible action density.
6. When a dialogue line is supplied, preserve it verbatim and place it explicitly in the final prompt. State which visible character is the only speaker, require natural Mandarin delivery and lip movement synchronized to the exact quoted words, and require every other visible character to keep their mouth closed. Never paraphrase, shorten, extend, repeat or invent dialogue. If there is no supplied dialogue, do not invent speech or lip movement.
7. Add only plausible ambient and action sounds. Do not add music unless requested.
8. Resolve contradictions conservatively in favor of first-frame identity and continuity.
9. Apply strict physical realism. Beds, mattresses, woven mats, floors, furniture, walls, papers held down by weight, and other supported or heavy objects remain stationary unless the source explicitly says they move. A general mention of wind does not authorize moving nearby props. If wind has no explicit target, keep it subtle and express it only through faint ambient sound or minimal movement of visibly loose hair, curtains, leaves, or lightweight fabric.
10. Prefer minimal motion over exaggerated motion. Use wording such as slight, restrained, low-amplitude and natural when intensity is unspecified. Never add billowing, lifting, violent shaking or large deformation unless explicitly requested.
11. Return one compact Chinese paragraph only, without headings, markdown, explanations or quotation marks. Keep it under 1200 Chinese characters.`

function normalizeOutput(value: string): string {
  return value
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/^(?:优化后提示词|MiniMax H3 提示词|提示词)\s*[:：]\s*/i, '')
    .trim()
    .slice(0, 2000)
}

const SUPPORTED_OBJECT_PATTERN = /(竹(?:凉)?席|床(?:铺|垫)?|床单|地面|地板|家具|桌(?:子)?|椅(?:子)?|墙(?:面)?)/
const EXAGGERATED_MOTION_PATTERN = /(吹|掀|卷|抬|翘|飘|飞|鼓|翻|晃|摇|震|变形|扭曲).{0,4}(起|动|舞|开|起来|起来了|变形|扭曲)|(?:吹起|掀起|卷起|抬起|翘起|飘起|飞起|鼓起|翻起|晃动|摇动|震动|变形|扭曲)/

function introducesUnsupportedObjectMotion(original: string, optimized: string): boolean {
  const clauses = optimized.split(/[，。；！？,;!?]/).map((item) => item.trim()).filter(Boolean)
  return clauses.some((clause) => {
    if (!SUPPORTED_OBJECT_PATTERN.test(clause) || !EXAGGERATED_MOTION_PATTERN.test(clause)) return false
    return !original.includes(clause)
  })
}

function extractDialogue(value?: string): string[] {
  if (!value) return []
  const matches = [...value.matchAll(/[「“\"]([^」”\"]+)[」”\"]/g)]
  return matches.map((match) => match[1]?.trim()).filter((line): line is string => Boolean(line))
}

function cacheKey(model: string, prompt: string, duration: number, dialogue: string[], speaker?: string): string {
  return createHash('sha256').update(`${model}\n${duration}\n${prompt}\n${speaker || ''}\n${dialogue.join('\n')}`).digest('hex')
}

function remember(key: string, value: string) {
  if (promptCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = promptCache.keys().next().value
    if (typeof oldest === 'string') promptCache.delete(oldest)
  }
  promptCache.set(key, value)
}

export async function optimizeMiniMaxH3Prompt(input: {
  userId: string
  analysisModel?: string
  projectId?: string
  prompt: string
  dialogueContext?: string
  dialogueSpeaker?: string
  duration?: number
}): Promise<string> {
  const original = input.prompt.trim()
  const model = input.analysisModel?.trim()
  if (!original || !model) return original

  const duration = input.duration && input.duration > 0 ? input.duration : 5
  const dialogue = extractDialogue(input.dialogueContext)
  const speaker = input.dialogueSpeaker?.trim()
  const key = cacheKey(model, original, duration, dialogue, speaker)
  const cached = promptCache.get(key)
  if (cached) return cached

  try {
    const completion = await executeAiTextStep({
      userId: input.userId,
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `视频时长：${duration} 秒`,
            `原始分镜提示词：\n${original}`,
            dialogue.length > 0
              ? `唯一说话人：${speaker || '原始分镜中正在说话的角色'}\n必须逐字说出的对白：\n${dialogue.map((line) => `「${line}」`).join('\n')}`
              : '本镜头没有对白。',
          ].join('\n'),
        },
      ],
      temperature: 0.25,
      reasoning: false,
      reasoningEffort: 'low',
      projectId: input.projectId || 'comfyui-minimax-h3',
      action: 'minimax_h3_prompt_optimize',
      meta: {
        stepId: 'minimax_h3_prompt_optimize',
        stepTitle: 'MiniMax H3 提示词优化',
        stepIndex: 1,
        stepTotal: 1,
      },
    })
    const optimized = normalizeOutput(completion.text)
    if (optimized.length < 8) return original
    if (introducesUnsupportedObjectMotion(original, optimized)) {
      logWarn('[MiniMax H3] rejected prompt optimization that introduced unsupported object motion')
      return original
    }
    remember(key, optimized)
    return optimized
  } catch (error) {
    logWarn('[MiniMax H3] prompt optimization failed; using original prompt', error)
    return original
  }
}
