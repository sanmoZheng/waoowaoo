'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import Navbar from '@/components/Navbar'

interface AdminUser {
  id: string
  name: string
  email: string | null
  createdAt: string
  _count: { projects: number; globalCharacters: number; globalLocations: number; tasks: number }
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    const response = await fetch('/api/admin/users')
    const data = await response.json() as { users?: AdminUser[]; message?: string }
    if (!response.ok) setMessage(data.message || '无权访问账号后台')
    else setUsers(data.users || [])
    setLoading(false)
  }, [])

  useEffect(() => { void loadUsers() }, [loadUsers])

  const createUser = async (event: FormEvent) => {
    event.preventDefault()
    setMessage('')
    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, password }),
    })
    const data = await response.json() as { success?: boolean; message?: string }
    if (!response.ok) return setMessage(data.message || '创建失败')
    setName('')
    setPassword('')
    setMessage('账号创建成功')
    await loadUsers()
  }

  const resetPassword = async (user: AdminUser) => {
    const nextPassword = window.prompt(`为 ${user.name} 设置新密码（至少 6 位）`)
    if (!nextPassword) return
    const response = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: user.id, password: nextPassword }),
    })
    const data = await response.json() as { success?: boolean; message?: string }
    setMessage(response.ok ? `已重置 ${user.name} 的密码` : data.message || '重置失败')
  }

  return (
    <div className="glass-page min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-6xl space-y-5 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--glass-text-primary)]">账号管理</h1>
          <p className="mt-1 text-sm text-[var(--glass-text-tertiary)]">查看账号、创建账号和重置密码。已有密码经过哈希处理，无法显示明文。</p>
        </div>
        <form onSubmit={createUser} className="glass-surface-elevated flex flex-wrap items-end gap-3 p-5">
          <label className="min-w-52 flex-1 text-xs text-[var(--glass-text-secondary)]">账号
            <input value={name} onChange={(event) => setName(event.target.value)} className="glass-input-base mt-1 w-full px-3 py-2 text-sm" placeholder="例如 editor01" />
          </label>
          <label className="min-w-52 flex-1 text-xs text-[var(--glass-text-secondary)]">初始密码
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="glass-input-base mt-1 w-full px-3 py-2 text-sm" placeholder="至少 6 位" />
          </label>
          <button className="glass-btn-base glass-btn-primary px-5 py-2 text-sm" type="submit">新建账号</button>
        </form>
        {message && <div className="rounded-xl bg-[var(--glass-bg-muted)] px-4 py-3 text-sm text-[var(--glass-text-secondary)]">{message}</div>}
        <div className="glass-surface-elevated overflow-hidden">
          <div className="grid grid-cols-[1.4fr_1fr_2fr_auto] gap-3 border-b border-[var(--glass-stroke-base)] px-5 py-3 text-xs font-semibold text-[var(--glass-text-tertiary)]">
            <span>账号</span><span>创建时间</span><span>用户数据</span><span>操作</span>
          </div>
          {loading ? <div className="p-6 text-sm">加载中…</div> : users.map((user) => (
            <div key={user.id} className="grid grid-cols-[1.4fr_1fr_2fr_auto] items-center gap-3 border-b border-[var(--glass-stroke-base)] px-5 py-4 text-sm last:border-0">
              <span className="font-semibold text-[var(--glass-text-primary)]">{user.name}</span>
              <span className="text-xs text-[var(--glass-text-secondary)]">{new Date(user.createdAt).toLocaleDateString()}</span>
              <span className="text-xs text-[var(--glass-text-secondary)]">项目 {user._count.projects} · 角色 {user._count.globalCharacters} · 场景/道具 {user._count.globalLocations} · 任务 {user._count.tasks}</span>
              <button type="button" onClick={() => resetPassword(user)} className="glass-btn-base glass-btn-soft px-3 py-1.5 text-xs">重置密码</button>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
