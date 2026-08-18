import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

export async function confirmProjectLocationBackedSelection(assetId: string): Promise<{ success: true }> {
  const location = await prisma.novelPromotionLocation.findUnique({
    where: { id: assetId },
    include: { images: { orderBy: { imageIndex: 'asc' } } },
  })
  if (!location) {
    throw new ApiError('NOT_FOUND')
  }

  const selectedImage = location.selectedImageId
    ? location.images.find((image) => image.id === location.selectedImageId)
    : location.images.find((image) => image.isSelected)

  if (!selectedImage || !selectedImage.imageUrl) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 确认只固定主方案，不删除或重排候选图片，确保之后仍可切换。
  await prisma.$transaction(async (tx) => {
    await tx.locationImage.updateMany({
      where: { locationId: assetId },
      data: { isSelected: false },
    })
    await tx.locationImage.update({
      where: { id: selectedImage.id },
      data: { isSelected: true },
    })
    await tx.novelPromotionLocation.update({
      where: { id: assetId },
      data: { selectedImageId: selectedImage.id },
    })
  })

  return { success: true }
}
