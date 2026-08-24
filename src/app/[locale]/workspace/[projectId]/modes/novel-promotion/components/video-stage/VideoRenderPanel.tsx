import { getAspectRatioConfig } from '@/lib/constants'
import { useMemo, useState, type MutableRefObject } from 'react'
import type { CapabilitySelections, CapabilityValue } from '@/lib/model-config-contract'
import { VideoPanelCard, type Clip, type VideoPanel, type VideoModelOption, type MatchedVoiceLine, type FirstLastFrameParams, type VideoGenerationOptions } from '../video'
import { useTranslations } from 'next-intl'
import type { PromptField } from '@/lib/novel-promotion/stages/video-stage-runtime/useVideoPromptState'
import { AppIcon } from '@/components/ui/icons'
import SegmentVideoPreviewModal from './SegmentVideoPreviewModal'

interface VideoRenderPanelProps {
  allPanels: VideoPanel[]
  clips: Clip[]
  linkedPanels: Map<string, boolean>
  highlightedPanelKey: string | null
  panelRefs: MutableRefObject<Map<string, HTMLDivElement>>
  videoRatio: string
  defaultVideoModel: string
  capabilityOverrides: CapabilitySelections
  userVideoModels?: VideoModelOption[]
  projectId: string
  episodeId: string
  runningVoiceLineIds: Set<string>
  panelVoiceLines: Map<string, MatchedVoiceLine[]>
  panelVideoPreference: Map<string, boolean>
  savingPrompts: Set<string>
  flModel: string
  flModelOptions: VideoModelOption[]
  flGenerationOptions: VideoGenerationOptions
  flCapabilityFields: Array<{
    field: string
    label: string
    options: CapabilityValue[]
    disabledOptions?: CapabilityValue[]
    value: CapabilityValue | undefined
  }>
  flMissingCapabilityFields: string[]
  flCustomPrompts: Map<string, string>
  onGenerateVideo: (
    storyboardId: string,
    panelIndex: number,
    videoModel?: string,
    firstLastFrame?: FirstLastFrameParams,
    generationOptions?: VideoGenerationOptions,
    panelId?: string,
  ) => Promise<void>
  onUpdatePanelVideoModel: (storyboardId: string, panelIndex: number, model: string) => Promise<void>
  onLipSync: (storyboardId: string, panelIndex: number, voiceLineId: string, panelId?: string) => Promise<void>
  onToggleLink: (panelKey: string, storyboardId: string, panelIndex: number) => Promise<void>
  onFlModelChange: (model: string) => void
  onFlCapabilityChange: (field: string, rawValue: string) => void
  onFlCustomPromptChange: (key: string, value: string) => void
  onResetFlPrompt: (key: string) => void
  onGenerateFirstLastFrame: (
    firstStoryboardId: string,
    firstPanelIndex: number,
    lastStoryboardId: string,
    lastPanelIndex: number,
    panelKey: string,
    generationOptions?: VideoGenerationOptions,
    firstPanelId?: string,
  ) => Promise<void>
  onPreviewImage: (imageUrl: string | null) => void
  onToggleLipSyncVideo: (key: string, value: boolean) => void
  getNextPanel: (currentIndex: number) => VideoPanel | null
  isLinkedAsLastFrame: (currentIndex: number) => boolean
  getDefaultFlPrompt: (firstPrompt?: string, lastPrompt?: string) => string
  getLocalPrompt: (panelKey: string, externalPrompt?: string, field?: PromptField) => string
  updateLocalPrompt: (panelKey: string, value: string, field?: PromptField) => void
  savePrompt: (
    storyboardId: string,
    panelIndex: number,
    panelKey: string,
    value: string,
    field?: PromptField,
  ) => Promise<void>
}

export default function VideoRenderPanel({
  allPanels,
  clips,
  linkedPanels,
  highlightedPanelKey,
  panelRefs,
  videoRatio,
  defaultVideoModel,
  capabilityOverrides,
  userVideoModels,
  projectId,
  episodeId,
  runningVoiceLineIds,
  panelVoiceLines,
  panelVideoPreference,
  savingPrompts,
  flModel,
  flModelOptions,
  flGenerationOptions,
  flCapabilityFields,
  flMissingCapabilityFields,
  flCustomPrompts,
  onGenerateVideo,
  onUpdatePanelVideoModel,
  onLipSync,
  onToggleLink,
  onFlModelChange,
  onFlCapabilityChange,
  onFlCustomPromptChange,
  onResetFlPrompt,
  onGenerateFirstLastFrame,
  onPreviewImage,
  onToggleLipSyncVideo,
  getNextPanel,
  isLinkedAsLastFrame,
  getDefaultFlPrompt,
  getLocalPrompt,
  updateLocalPrompt,
  savePrompt,
}: VideoRenderPanelProps) {
  const t = useTranslations('video')
  const [collapsedClipIds, setCollapsedClipIds] = useState<Set<string>>(new Set())
  const [previewClipId, setPreviewClipId] = useState<string | null>(null)
  const groups = clips.map((clip, clipIndex) => ({
    clip,
    clipIndex,
    panels: allPanels.filter((panel) => panel.clipId === clip.id),
  })).filter((group) => group.panels.length > 0)
  const orphanPanels = allPanels.filter((panel) => !clips.some((clip) => clip.id === panel.clipId))
  if (orphanPanels.length > 0) {
    groups.push({
      clip: { id: '__ungrouped__', start: 0, end: 0, summary: '' },
      clipIndex: groups.length,
      panels: orphanPanels,
    })
  }
  const previewGroup = groups.find((group) => group.clip.id === previewClipId)
  const previewVideos = useMemo(() => {
    if (!previewGroup) return []
    return previewGroup.panels.flatMap((panel) => {
      const panelKey = `${panel.storyboardId}-${panel.panelIndex}`
      const useLipSync = panelVideoPreference.get(panelKey) ?? true
      const url = useLipSync && panel.lipSyncVideoUrl ? panel.lipSyncVideoUrl : panel.videoUrl
      if (!url) return []
      return [{
        key: panelKey,
        url,
        shotNumber: allPanels.indexOf(panel) + 1,
      }]
    })
  }, [allPanels, panelVideoPreference, previewGroup])

  const toggleCollapsed = (clipId: string) => {
    setCollapsedClipIds((previous) => {
      const next = new Set(previous)
      if (next.has(clipId)) next.delete(clipId)
      else next.add(clipId)
      return next
    })
  }

  const renderPanel = (panel: VideoPanel) => {
    const idx = allPanels.indexOf(panel)
    const panelKey = `${panel.storyboardId}-${panel.panelIndex}`
    const isLinked = linkedPanels.get(panelKey) || false
    const isLastFrame = isLinkedAsLastFrame(idx)
    const nextPanel = getNextPanel(idx)
    const prevPanel = idx > 0 ? allPanels[idx - 1] : null
    const hasNext = idx < allPanels.length - 1
    const promptField: PromptField = isLinked ? 'firstLastFramePrompt' : 'videoPrompt'
    const defaultFlPrompt = getDefaultFlPrompt(panel.textPanel?.video_prompt, nextPanel?.textPanel?.video_prompt)
    const externalPrompt = isLinked
      ? (panel.firstLastFramePrompt || defaultFlPrompt)
      : panel.textPanel?.video_prompt
    const localPrompt = getLocalPrompt(panelKey, externalPrompt, promptField)
    const isSavingPrompt = savingPrompts.has(`${promptField}:${panelKey}`)

    return (
      <div
        key={panelKey}
        ref={(element) => {
          if (element) panelRefs.current.set(panelKey, element)
          else panelRefs.current.delete(panelKey)
        }}
        className={`transition-all duration-500 ${highlightedPanelKey === panelKey
          ? 'ring-4 ring-[var(--glass-stroke-focus)] ring-offset-2 ring-offset-[var(--glass-bg-canvas)] rounded-2xl scale-[1.02]'
          : ''
        }`}
      >
        <VideoPanelCard
          panel={{ ...panel, lipSyncTaskRunning: panel.lipSyncTaskRunning || false }}
          panelIndex={idx}
          defaultVideoModel={defaultVideoModel}
          capabilityOverrides={capabilityOverrides}
          videoRatio={videoRatio}
          userVideoModels={userVideoModels}
          projectId={projectId}
          episodeId={episodeId}
          runningVoiceLineIds={runningVoiceLineIds}
          matchedVoiceLines={panelVoiceLines.get(panelKey) || []}
          onLipSync={onLipSync}
          showLipSyncVideo={panelVideoPreference.get(panelKey) ?? true}
          onToggleLipSyncVideo={onToggleLipSyncVideo}
          isLinked={isLinked}
          isLastFrame={isLastFrame}
          nextPanel={nextPanel}
          prevPanel={prevPanel}
          hasNext={hasNext}
          flModel={flModel}
          flModelOptions={flModelOptions}
          flGenerationOptions={flGenerationOptions}
          flCapabilityFields={flCapabilityFields}
          flMissingCapabilityFields={flMissingCapabilityFields}
          flCustomPrompt={flCustomPrompts.get(panelKey) || panel.firstLastFramePrompt || ''}
          defaultFlPrompt={defaultFlPrompt}
          localPrompt={localPrompt}
          isSavingPrompt={isSavingPrompt}
          onUpdateLocalPrompt={(value) => {
            updateLocalPrompt(panelKey, value, promptField)
            if (isLinked) onFlCustomPromptChange(panelKey, value)
          }}
          onSavePrompt={(value) => savePrompt(panel.storyboardId, panel.panelIndex, panelKey, value, promptField)}
          onGenerateVideo={onGenerateVideo}
          onUpdatePanelVideoModel={onUpdatePanelVideoModel}
          onToggleLink={onToggleLink}
          onFlModelChange={onFlModelChange}
          onFlCapabilityChange={onFlCapabilityChange}
          onFlCustomPromptChange={onFlCustomPromptChange}
          onResetFlPrompt={onResetFlPrompt}
          onGenerateFirstLastFrame={onGenerateFirstLastFrame}
          onPreviewImage={onPreviewImage}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {groups.map(({ clip, clipIndex, panels }) => {
        const isCollapsed = collapsedClipIds.has(clip.id)
        const generatedCount = panels.filter((panel) => panel.videoUrl || panel.lipSyncVideoUrl).length
        return (
        <section key={clip.id} className="glass-surface-elevated overflow-hidden rounded-3xl">
          <div className="flex items-center justify-between gap-4 px-5 py-5">
            <button
              type="button"
              onClick={() => toggleCollapsed(clip.id)}
              className="flex min-w-0 flex-1 items-center gap-4 text-left"
              aria-expanded={!isCollapsed}
            >
              <AppIcon
                name="chevronDown"
                className={`h-4 w-4 shrink-0 text-[var(--glass-text-secondary)] transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
              />
              <div className="glass-surface-soft flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl font-bold text-[var(--glass-tone-info-fg)]">
                {clipIndex + 1}
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium text-[var(--glass-text-secondary)]">
                  {t('clipGroup.title', { index: clipIndex + 1 })}
                </h3>
                {clip.summary && (
                  <p className="mt-0.5 line-clamp-1 text-xs text-[var(--glass-text-tertiary)]">{clip.summary}</p>
                )}
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full bg-[var(--glass-bg-surface-strong)] px-3 py-1.5 text-xs text-[var(--glass-text-secondary)]">
                {t('clipGroup.generatedCount', { generated: generatedCount, total: panels.length })}
              </span>
              <button
                type="button"
                disabled={generatedCount === 0}
                onClick={() => setPreviewClipId(clip.id)}
                className="glass-btn-base glass-btn-soft rounded-xl px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                <AppIcon name="playCircle" className="h-4 w-4" />
                {t('clipGroup.preview')}
              </button>
            </div>
          </div>
          {!isCollapsed && <div className={`grid gap-4 border-t border-[var(--glass-stroke-subtle)] p-4 ${getAspectRatioConfig(videoRatio).isVertical
            ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
            : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
          }`}>
            {panels.map(renderPanel)}
          </div>}
        </section>
        )
      })}
      {previewGroup && previewVideos.length > 0 && (
        <SegmentVideoPreviewModal
          title={t('clipPreview.title', { index: previewGroup.clipIndex + 1 })}
          videos={previewVideos}
          onClose={() => setPreviewClipId(null)}
        />
      )}
    </div>
  )
}
