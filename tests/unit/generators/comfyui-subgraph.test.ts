import { describe, expect, it } from 'vitest'

import { convertComfyWorkflowToApi } from '@/lib/generators/video/comfyui'

describe('ComfyUI workflow conversion', () => {
  it('expands a saved workflow subgraph and reconnects its output', () => {
    const workflow = convertComfyWorkflowToApi({
      nodes: [
        {
          id: 1,
          type: 'LoadImage',
          inputs: [{ name: 'image', type: 'COMBO', link: null }],
          widgets_values: ['input.png'],
        },
        {
          id: 105,
          type: 'minimax-subgraph',
          inputs: [
            { name: 'first_frame', type: 'IMAGE', link: 10 },
            { name: 'prompt', type: 'STRING', link: null },
            { name: 'duration', type: 'FLOAT', link: null },
          ],
          widgets_values: ['少年沿石阶上山', 5],
        },
        {
          id: 92,
          type: 'SaveVideo',
          inputs: [{ name: 'video', type: 'VIDEO', link: 11 }],
        },
      ],
      links: [
        [10, 1, 0, 105, 0, 'IMAGE'],
        [11, 105, 0, 92, 0, 'VIDEO'],
      ],
      definitions: {
        subgraphs: [{
          id: 'minimax-subgraph',
          inputs: [
            { name: 'first_frame', type: 'IMAGE' },
            { name: 'prompt', type: 'STRING' },
            { name: 'duration', type: 'FLOAT' },
          ],
          nodes: [
            { id: -10, type: 'SubgraphInput', inputs: [] },
            {
              id: 7,
              type: 'MiniMaxH3ImageToVideo',
              inputs: [
                { name: 'first_frame', type: 'IMAGE', link: 20 },
                { name: 'prompt', type: 'STRING', link: 21 },
                { name: 'duration', type: 'FLOAT', link: 22 },
              ],
            },
            {
              id: 91,
              type: 'CreateVideo',
              inputs: [{ name: 'images', type: 'IMAGE', link: 23 }],
            },
            { id: -20, type: 'SubgraphOutput', inputs: [{ name: 'video', type: 'VIDEO', link: 24 }] },
          ],
          links: [
            [20, -10, 0, 7, 0, 'IMAGE'],
            [21, -10, 1, 7, 1, 'STRING'],
            [22, -10, 2, 7, 2, 'FLOAT'],
            [23, 7, 0, 91, 0, 'IMAGE'],
            [24, 91, 0, -20, 0, 'VIDEO'],
          ],
        }],
      },
    })

    expect(workflow['105']).toBeUndefined()
    expect(workflow['105:-10']).toBeUndefined()
    expect(workflow['105:-20']).toBeUndefined()
    expect(workflow['105:7']).toEqual({
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: {
        first_frame: ['1', 0],
        prompt: '少年沿石阶上山',
        duration: 5,
      },
    })
    expect(workflow['105:91'].inputs.images).toEqual(['105:7', 0])
    expect(workflow['92'].inputs.video).toEqual(['105:91', 0])
  })
})
