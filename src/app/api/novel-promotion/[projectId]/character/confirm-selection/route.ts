import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * POST - 确认当前选择，并保留全部候选图片供后续切换
 * Body: { characterId, appearanceId }
 * 
 * 工作流程：
 * 1. 验证已经选择了一张图片（selectedIndex 不为 null）
 * 2. 将当前选中图片同步为主图
 * 3. 保留 imageUrls 中的全部候选图片
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
  const { characterId, appearanceId } = body

  if (!characterId || !appearanceId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 获取形象记录 - 使用 UUID 直接查询
  const appearance = await prisma.characterAppearance.findUnique({
    where: { id: appearanceId },
    include: { character: true }
  })

  if (!appearance) {
    throw new ApiError('NOT_FOUND')
  }

  // 检查是否已选择
  if (appearance.selectedIndex === null || appearance.selectedIndex === undefined) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 解析图片数组
  const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')

  const selectedIndex = appearance.selectedIndex
  const selectedImageUrl = imageUrls[selectedIndex]

  if (!selectedImageUrl) {
    throw new ApiError('NOT_FOUND')
  }

  // 只同步主图；候选图片、索引和描述数组全部保留，允许之后再次切换。
  await prisma.characterAppearance.update({
    where: { id: appearance.id },
    data: {
      imageUrl: selectedImageUrl,
      selectedIndex,
    }
  })

  _ulogInfo(`✓ 确认选择: ${appearance.character.name} - ${appearance.changeReason}`)

  return NextResponse.json({
    success: true,
    message: '已确认选择，其他候选图片已保留',
    deletedCount: 0
  })
})
