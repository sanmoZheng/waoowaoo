import { execFile } from 'node:child_process'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { generateUniqueKey, getObjectBuffer, getSignedUrl, uploadObject } from '@/lib/storage'
import type { VideoEditorProject } from '@/features/video-editor'

export const runtime = 'nodejs'
const execFileAsync = promisify(execFile)

async function findEditor(projectId: string) {
  return prisma.videoEditorProject.findFirst({
    where: { episode: { novelPromotionProject: { projectId } } },
  })
}

export const POST = apiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const body = await request.json() as { editorProjectId?: string }
  const editor = await findEditor(projectId)
  if (!editor) throw new ApiError('NOT_FOUND')

  const project = JSON.parse(editor.projectData) as VideoEditorProject
  if (!body.editorProjectId || project.id !== body.editorProjectId || !project.timeline.length) {
    throw new ApiError('INVALID_PARAMS')
  }
  await prisma.videoEditorProject.update({
    where: { id: editor.id }, data: { renderStatus: 'rendering', outputUrl: null },
  })

  const workDir = await mkdtemp(path.join(tmpdir(), 'waoo-editor-'))
  try {
    const panelIds = project.timeline.map((clip) => clip.metadata.panelId)
    const panels = await prisma.novelPromotionPanel.findMany({
      where: { id: { in: panelIds } },
      select: { id: true, videoUrl: true, lipSyncVideoUrl: true },
    })
    const panelById = new Map(panels.map((panel) => [panel.id, panel]))
    const concatLines: string[] = []

    for (const [index, clip] of project.timeline.entries()) {
      const panel = panelById.get(clip.metadata.panelId)
      const storageKey = await resolveStorageKeyFromMediaValue(panel?.lipSyncVideoUrl || panel?.videoUrl)
      if (!storageKey) throw new Error(`镜头 ${index + 1} 缺少视频文件`)
      const clipPath = path.join(workDir, `${String(index + 1).padStart(3, '0')}.mp4`)
      await writeFile(clipPath, await getObjectBuffer(storageKey))
      concatLines.push(`file '${clipPath.replaceAll('\\', '/')}'`)
    }

    const concatPath = path.join(workDir, 'concat.txt')
    const outputPath = path.join(workDir, 'output.mp4')
    await writeFile(concatPath, concatLines.join('\n'), 'utf8')
    await execFileAsync('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
      '-c', 'copy', '-movflags', '+faststart', outputPath,
    ], { maxBuffer: 10 * 1024 * 1024 })

    const outputKey = generateUniqueKey(`editor-${editor.episodeId}`, 'mp4')
    await uploadObject(await readFile(outputPath), outputKey, 1, 'video/mp4')
    await prisma.videoEditorProject.update({
      where: { id: editor.id }, data: { renderStatus: 'completed', outputUrl: outputKey },
    })
    return NextResponse.json({ status: 'completed', outputUrl: getSignedUrl(outputKey) })
  } catch (error) {
    await prisma.videoEditorProject.update({
      where: { id: editor.id }, data: { renderStatus: 'failed' },
    })
    throw error
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
})

export const GET = apiHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const editor = await findEditor(projectId)
  if (!editor) throw new ApiError('NOT_FOUND')
  return NextResponse.json({
    status: editor.renderStatus || 'pending',
    outputUrl: editor.outputUrl ? getSignedUrl(editor.outputUrl) : undefined,
  })
})
