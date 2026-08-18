import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * POST - 确认场景选择并保留全部候选图片
 * Body: { locationId }
 * 
 * 工作流程：
 * 1. 验证已经选择了一张图片（有 isSelected 的图片）
 * 2. 固定当前主图
 * 3. 保留其他候选图片供后续切换
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { locationId } = body

  if (!locationId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 获取场景及其图片
  const location = await prisma.novelPromotionLocation.findUnique({
    where: { id: locationId },
    include: { images: { orderBy: { imageIndex: 'asc' } } }
  })

  if (!location) {
    throw new ApiError('NOT_FOUND')
  }

  const images = location.images || []

  // 找到选中的图片
  const selectedImage = location.selectedImageId
    ? images.find((img) => img.id === location.selectedImageId)
    : images.find((img) => img.isSelected)
  if (!selectedImage) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 在事务中只同步选中状态，不删除或重排任何候选图片。
  await prisma.$transaction(async (tx) => {
    await tx.locationImage.updateMany({
      where: { locationId },
      data: { isSelected: false },
    })
    await tx.locationImage.update({
      where: { id: selectedImage.id },
      data: { isSelected: true }
    })

    await tx.novelPromotionLocation.update({
      where: { id: locationId },
      data: { selectedImageId: selectedImage.id }
    })
  })

  _ulogInfo(`✓ 场景确认选择: ${location.name}`)

  return NextResponse.json({
    success: true,
    message: '已确认选择，其他候选图片已保留',
    deletedCount: 0
  })
})
