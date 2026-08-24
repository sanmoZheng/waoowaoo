import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisMockState = vi.hoisted(() => ({
  configs: [] as Array<Record<string, unknown>>,
}))

vi.mock('ioredis', () => ({
  default: class RedisMock {
    constructor(config: Record<string, unknown>) {
      redisMockState.configs.push(config)
    }

    on() {
      return this
    }
  },
}))

vi.mock('@/lib/logging/core', () => ({
  logDebug: vi.fn(),
  logError: vi.fn(),
}))

describe('redis clients', () => {
  beforeEach(() => {
    vi.resetModules()
    redisMockState.configs.length = 0
    delete (globalThis as typeof globalThis & { __waoowaooRedis?: unknown }).__waoowaooRedis
  })

  it('does not connect eagerly when imported during a production build', async () => {
    const redisModule = await import('@/lib/redis')

    expect(redisMockState.configs).toHaveLength(2)
    expect(redisMockState.configs.every((config) => config.lazyConnect === true)).toBe(true)

    redisModule.createSubscriber()
    expect(redisMockState.configs).toHaveLength(3)
    expect(redisMockState.configs[2]?.lazyConnect).toBe(true)
  })
})
