export type ScriptFormatAssessment = {
  level: 'ready' | 'normalize' | 'reject'
  reason?: 'empty' | 'tooShort' | 'binary' | 'unstructured'
}

export function assessImportedScript(text: string): ScriptFormatAssessment {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return { level: 'reject', reason: 'empty' }

  const controlCharacters = normalized.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g)?.length ?? 0
  if (controlCharacters / normalized.length > 0.01) {
    return { level: 'reject', reason: 'binary' }
  }

  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean)
  const sceneHeadings = lines.filter((line) => /^(?:第[一二三四五六七八九十百0-9]+[场幕]|场景|内景|外景|INT\.?|EXT\.?)/i.test(line)).length
  const dialogueLines = lines.filter((line) => /^[\p{L}\p{N}_·]{1,20}\s*[：:]/u.test(line)).length
  const actionLines = lines.filter((line) => /(?:镜头|画面|动作|旁白|转场|淡入|淡出|切至|特写|近景|中景|远景)/.test(line)).length
  const structuredSignals = sceneHeadings + dialogueLines + actionLines

  if (structuredSignals >= 2 || (sceneHeadings >= 1 && lines.length >= 4)) {
    return { level: 'ready' }
  }
  if (normalized.length < 80) return { level: 'reject', reason: 'tooShort' }
  if (lines.length >= 3 || normalized.length >= 300) {
    return { level: 'normalize' }
  }
  return { level: 'reject', reason: 'unstructured' }
}
