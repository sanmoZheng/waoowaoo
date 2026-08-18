'use client'

import { useEffect, useState } from 'react'
import { VideoEditorStage, createProjectFromPanels } from '@/features/video-editor'
import type { VideoEditorProject } from '@/features/video-editor'
import { apiFetch } from '@/lib/api-fetch'
import { useWorkspaceProvider } from '../WorkspaceProvider'

interface EpisodePanel {
  id: string
  panelIndex: number
  storyboardId: string
  videoUrl?: string | null
  lipSyncVideoUrl?: string | null
  description?: string | null
  duration?: number | null
}

interface EpisodeStoryboard {
  id: string
  panels?: EpisodePanel[]
}

export default function EditorStageRoute() {
  const { projectId, episodeId } = useWorkspaceProvider()
  const [project, setProject] = useState<VideoEditorProject | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!episodeId) return
    let cancelled = false

    async function load() {
      try {
        const savedResponse = await apiFetch(
          `/api/novel-promotion/${projectId}/editor?episodeId=${episodeId}`,
        )
        if (!savedResponse.ok) throw new Error('无法读取剪辑工程')
        const saved = await savedResponse.json()
        if (saved.projectData) {
          if (!cancelled) setProject(saved.projectData)
          return
        }

        const episodeResponse = await apiFetch(
          `/api/novel-promotion/${projectId}/episodes/${episodeId}`,
        )
        if (!episodeResponse.ok) throw new Error('无法读取镜头素材')
        const data = await episodeResponse.json()
        const panels = ((data.episode?.storyboards || []) as EpisodeStoryboard[])
          .flatMap((storyboard) => (storyboard.panels || []).map((panel) => ({
            ...panel,
            storyboardId: storyboard.id,
            videoUrl: panel.lipSyncVideoUrl || panel.videoUrl || undefined,
            description: panel.description || undefined,
            duration: panel.duration || undefined,
          })))

        if (!cancelled) setProject(createProjectFromPanels(episodeId!, panels))
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '剪辑器加载失败')
      }
    }

    void load()
    return () => { cancelled = true }
  }, [episodeId, projectId])

  if (!episodeId) return <div className="p-8 text-center">请先选择剧集</div>
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>
  if (!project) return <div className="p-8 text-center">正在载入剪辑工程…</div>

  return <VideoEditorStage projectId={projectId} episodeId={episodeId} initialProject={project} />
}
