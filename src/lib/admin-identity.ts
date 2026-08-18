export const SUPER_ADMIN_USERNAME = 'waoowaoo_admin'

export function isSuperAdminUsername(name: unknown): boolean {
  return typeof name === 'string' && name.trim().toLowerCase() === SUPER_ADMIN_USERNAME
}
