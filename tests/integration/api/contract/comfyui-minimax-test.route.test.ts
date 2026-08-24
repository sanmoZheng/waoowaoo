import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireUserAuth: async () => unauthorized(),
  }
})

describe('POST/GET /api/user/comfyui-minimax-test', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('rejects an unauthenticated workflow submission before reading form data', async () => {
    const mod = await import('@/app/api/user/comfyui-minimax-test/route')
    const request = buildMockRequest({
      path: '/api/user/comfyui-minimax-test',
      method: 'POST',
    })

    const response = await mod.POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(401)
  })

  it('rejects an unauthenticated task-status query', async () => {
    const mod = await import('@/app/api/user/comfyui-minimax-test/route')
    const request = buildMockRequest({
      path: '/api/user/comfyui-minimax-test?baseUrl=http://127.0.0.1:8188&promptId=task-1',
      method: 'GET',
    })

    const response = await mod.GET(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(401)
  })
})
