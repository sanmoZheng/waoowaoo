'use client'

import ScriptView from './ScriptView'
import { useWorkspaceStageRuntime } from '../WorkspaceStageRuntimeContext'
import { useWorkspaceEpisodeStageData } from '../hooks/useWorkspaceEpisodeStageData'
import { useWorkspaceProvider } from '../WorkspaceProvider'
import ScriptFileImportButton from '@/components/script-import/ScriptFileImportButton'
import { useTranslations } from 'next-intl'

export default function ScriptStage() {
  const runtime = useWorkspaceStageRuntime()
  const { projectId, episodeId } = useWorkspaceProvider()
  const { clips, storyboards } = useWorkspaceEpisodeStageData()
  const t = useTranslations('novelPromotion.scriptImport')
  const importDisabled = runtime.isStartingStoryToScript || runtime.isTransitioning

  return (
    <div className="space-y-4">
      <div className="glass-surface mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">
        <div>
          <div className="font-semibold text-[var(--glass-text-primary)]">{t('scriptTabTitle')}</div>
          <div className="text-sm text-[var(--glass-text-tertiary)]">{t('scriptTabDescription')}</div>
        </div>
        <ScriptFileImportButton
          disabled={importDisabled}
          className="glass-btn-primary shrink-0"
          onImported={async (text) => {
            await runtime.onNovelTextChange(text)
            await runtime.onRunStoryToScript('screenplay')
          }}
        />
      </div>
      <ScriptView
        projectId={projectId}
        episodeId={episodeId}
        clips={clips}
        storyboards={storyboards}
        assetsLoading={runtime.assetsLoading}
        onClipUpdate={runtime.onClipUpdate}
        onOpenAssetLibrary={runtime.onOpenAssetLibrary}
        onGenerateStoryboard={runtime.onRunScriptToStoryboard}
        isSubmittingStoryboardBuild={runtime.isConfirmingAssets || runtime.isStartingScriptToStoryboard}
      />
    </div>
  )
}
