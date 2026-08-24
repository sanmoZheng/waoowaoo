import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(async () => ({
      customModels: JSON.stringify([
        {
          modelId: 'qwen3-tts-vd-2026-01-26',
          modelKey: 'bailian::qwen3-tts-vd-2026-01-26',
          name: 'Qwen3 TTS',
          type: 'audio',
          provider: 'bailian',
        },
        {
          modelId: 'qwen-voice-design',
          modelKey: 'bailian::qwen-voice-design',
          name: 'Qwen Voice Design',
          type: 'audio',
          provider: 'bailian',
        },
        {
          modelId: 'workflow:video_minimax_h3.json',
          modelKey: 'comfyui::workflow:video_minimax_h3.json',
          name: 'MiniMax H3',
          type: 'video',
          provider: 'comfyui',
        },
      ]),
      customProviders: JSON.stringify([
        {
          id: 'bailian',
          name: 'Alibaba Bailian',
          apiKey: 'k-bailian',
        },
        {
          id: 'comfyui',
          name: 'ComfyUI',
          baseUrl: 'http://127.0.0.1:8188',
        },
      ]),
    })),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/model-capabilities/catalog', () => ({
  findBuiltinCapabilities: vi.fn(() => undefined),
}))
vi.mock('@/lib/model-pricing/catalog', () => ({
  findBuiltinPricingCatalogEntry: vi.fn(() => undefined),
}))

describe('api specific - user models audio filter', () => {
  const routeContext = { params: Promise.resolve({}) }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('excludes voice design models from the audio model list', async () => {
    const mod = await import('@/app/api/user/models/route')
    const req = buildMockRequest({
      path: '/api/user/models',
      method: 'GET',
    })
    const res = await mod.GET(req, routeContext)

    expect(res.status).toBe(200)
    const body = await res.json() as { audio: Array<{ value: string }> }
    expect(body.audio.map((item) => item.value)).toEqual([
      'bailian::qwen3-tts-vd-2026-01-26',
    ])
  })

  it('exposes duration capability for discovered ComfyUI video workflows', async () => {
    const mod = await import('@/app/api/user/models/route')
    const req = buildMockRequest({
      path: '/api/user/models',
      method: 'GET',
    })
    const res = await mod.GET(req, routeContext)

    expect(res.status).toBe(200)
    const body = await res.json() as {
      video: Array<{ value: string; capabilities?: { video?: { durationOptions?: number[] } } }>
    }
    expect(body.video).toEqual([
      expect.objectContaining({
        value: 'comfyui::workflow:video_minimax_h3.json',
        capabilities: expect.objectContaining({
          video: expect.objectContaining({ durationOptions: [3, 5, 6, 10] }),
        }),
      }),
    ])
  })
})
