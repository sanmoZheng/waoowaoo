const RESOLUTION_MEGAPIXELS: Readonly<Record<string, number>> = {
  '480P': 0.4,
  '540P': 0.5,
  '576P': 0.6,
  '600P': 0.65,
  '720P': 0.9,
  '768P': 1.0,
  '900P': 1.4,
  '1080P': 2.0,
}

export function resolveMinimaxMegapixels(resolution: string): number {
  const megapixels = RESOLUTION_MEGAPIXELS[resolution.toUpperCase()]
  if (megapixels === undefined) {
    throw new Error(`COMFYUI_RESOLUTION_INVALID: ${resolution}`)
  }
  return megapixels
}
