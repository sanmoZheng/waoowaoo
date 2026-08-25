import { describe, expect, it } from 'vitest'
import { createRuntimeId } from '@/lib/runtime-id'

describe('createRuntimeId', () => {
  it('creates a non-empty prefixed ID in the current runtime', () => {
    const id = createRuntimeId('test-')
    expect(id.startsWith('test-')).toBe(true)
    expect(id.length).toBeGreaterThan('test-'.length)
  })
})
