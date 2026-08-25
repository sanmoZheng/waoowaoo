/** Create an ID without assuming randomUUID exists in the current runtime. */
export function createRuntimeId(prefix = ''): string {
  const runtimeCrypto = globalThis.crypto
  let value = ''

  try {
    if (typeof runtimeCrypto?.randomUUID === 'function') {
      value = runtimeCrypto.randomUUID()
    } else if (typeof runtimeCrypto?.getRandomValues === 'function') {
      const bytes = runtimeCrypto.getRandomValues(new Uint8Array(16))
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
      value = `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
    }
  } catch {
    // Insecure and embedded browsers may expose crypto methods that still throw.
  }

  if (!value) {
    value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  }
  return prefix ? `${prefix}${value}` : value
}
