import { describe, expect, it } from 'vitest'

import { isSuperAdminUsername, SUPER_ADMIN_USERNAME } from '@/lib/admin-identity'

describe('super admin identity', () => {
  it('grants super-admin identity only to waoowaoo_admin', () => {
    expect(SUPER_ADMIN_USERNAME).toBe('waoowaoo_admin')
    expect(isSuperAdminUsername('waoowaoo_admin')).toBe(true)
    expect(isSuperAdminUsername('WAOOWAOO_ADMIN')).toBe(true)
    expect(isSuperAdminUsername('other_admin')).toBe(false)
    expect(isSuperAdminUsername('waoowaoo_admin2')).toBe(false)
    expect(isSuperAdminUsername(null)).toBe(false)
  })
})
