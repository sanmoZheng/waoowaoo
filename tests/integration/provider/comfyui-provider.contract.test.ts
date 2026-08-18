import { describe, expect, it } from 'vitest'

import { convertComfyWorkflowToApi } from '@/lib/generators/video/comfyui'

describe('ComfyUI provider contract', () => {
  it('converts an image-to-video workflow while retaining the output video link', () => {
    const workflow = convertComfyWorkflowToApi({
      nodes: [
        {
          id: 1,
          type: 'LoadImage',
          inputs: [{ name: 'image', type: 'COMBO', link: null }],
          widgets_values: ['first-frame.png'],
        },
        {
          id: 2,
          type: 'MiniMaxH3ImageToVideo',
          inputs: [
            { name: 'first_frame', type: 'IMAGE', link: 10 },
            { name: 'prompt', type: 'STRING', link: null },
            { name: 'duration', type: 'FLOAT', link: null },
          ],
          widgets_values: ['少年沿石阶自然向上奔跑', 5],
        },
        {
          id: 3,
          type: 'SaveVideo',
          inputs: [{ name: 'video', type: 'VIDEO', link: 11 }],
        },
      ],
      links: [
        [10, 1, 0, 2, 0, 'IMAGE'],
        [11, 2, 0, 3, 0, 'VIDEO'],
      ],
    })

    expect(workflow['2']).toEqual({
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: {
        first_frame: ['1', 0],
        prompt: '少年沿石阶自然向上奔跑',
        duration: 5,
      },
    })
    expect(workflow['3'].inputs.video).toEqual(['2', 0])
  })
})
