import { describe, expect, it } from 'vitest'
import { assessImportedScript } from '@/lib/script-import'

describe('script import format assessment', () => {
  it('accepts a structured screenplay', () => {
    const text = `第一场 山门外 日\n韩立：张铁，你怎么来了？\n张铁沿石阶快步跑来。\n镜头缓缓推近。`
    expect(assessImportedScript(text)).toEqual({ level: 'ready' })
  })

  it('offers AI normalization for readable but loose script text', () => {
    const text = `韩立站在七玄门前。\n张铁从山下追来。\n两人谈起入门试炼，随后一同向山门走去。${'剧情继续发展。'.repeat(30)}`
    expect(assessImportedScript(text)).toEqual({ level: 'normalize' })
  })

  it('rejects content that is too short to form a script', () => {
    expect(assessImportedScript('韩立来到山门。')).toEqual({ level: 'reject', reason: 'tooShort' })
  })
})
