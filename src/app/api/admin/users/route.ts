import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { isAdminSession, isErrorResponse, requireUserAuth, type AuthSession } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

function validateCredentials(name: unknown, password: unknown) {
  const normalizedName = typeof name === 'string' ? name.trim() : ''
  const normalizedPassword = typeof password === 'string' ? password : ''
  if (normalizedName.length < 3 || normalizedName.length > 50) throw new Error('账号长度必须为 3–50 个字符')
  if (!/^[a-zA-Z0-9_.-]+$/.test(normalizedName)) throw new Error('账号只能包含字母、数字、点、下划线和短横线')
  if (normalizedPassword.length < 6 || normalizedPassword.length > 100) throw new Error('密码长度必须为 6–100 个字符')
  return { name: normalizedName, password: normalizedPassword }
}

function rejectNonAdmin(session: AuthSession) {
  return isAdminSession(session)
    ? null
    : NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 })
}

export const GET = apiHandler(async () => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const denied = rejectNonAdmin(auth.session)
  if (denied) return denied
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { projects: true, globalCharacters: true, globalLocations: true, tasks: true } },
    },
  })
  return NextResponse.json({ users })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const denied = rejectNonAdmin(auth.session)
  if (denied) return denied
  try {
    const body = await request.json() as { name?: unknown; password?: unknown }
    const input = validateCredentials(body.name, body.password)
    const passwordHash = await bcrypt.hash(input.password, 12)
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { name: input.name, password: passwordHash } })
      await tx.userBalance.create({ data: { userId: created.id, balance: 0, frozenAmount: 0, totalSpent: 0 } })
      return created
    })
    return NextResponse.json({ success: true, user: { id: user.id, name: user.name } }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error && error.message.includes('Unique constraint')
      ? '账号已经存在'
      : error instanceof Error ? error.message : '创建账号失败'
    return NextResponse.json({ success: false, message }, { status: 400 })
  }
})

export const PATCH = apiHandler(async (request: NextRequest) => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const denied = rejectNonAdmin(auth.session)
  if (denied) return denied
  try {
    const body = await request.json() as { userId?: unknown; password?: unknown }
    const userId = typeof body.userId === 'string' ? body.userId : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!userId) throw new Error('缺少用户 ID')
    if (password.length < 6 || password.length > 100) throw new Error('密码长度必须为 6–100 个字符')
    await prisma.user.update({ where: { id: userId }, data: { password: await bcrypt.hash(password, 12) } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : '重置密码失败' }, { status: 400 })
  }
})
