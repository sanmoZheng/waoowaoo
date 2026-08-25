import { describe, expect, it } from 'vitest'
import { resolveMinimaxMegapixels } from '@/lib/generators/video/minimax-h3-resolution'

describe('MiniMax H3 ComfyUI resolution contract', () => {
  it('maps every supported clarity option to the workflow megapixel value', () => {
    expect([
      '480P',
      '540P',
      '576P',
      '600P',
      '720P',
      '768P',
      '900P',
      '1080P',
    ].map(resolveMinimaxMegapixels)).toEqual([0.4, 0.5, 0.6, 0.65, 0.9, 1.0, 1.4, 2.0])
  })

  it('rejects unsupported clarity options', () => {
    expect(() => resolveMinimaxMegapixels('4K')).toThrow('COMFYUI_RESOLUTION_INVALID')
  })
})
