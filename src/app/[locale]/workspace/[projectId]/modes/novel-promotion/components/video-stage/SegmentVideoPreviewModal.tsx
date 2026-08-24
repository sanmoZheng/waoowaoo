'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'

interface SegmentPreviewVideo {
  key: string
  url: string
  shotNumber: number
}

interface SegmentVideoPreviewModalProps {
  title: string
  videos: SegmentPreviewVideo[]
  onClose: () => void
}

export default function SegmentVideoPreviewModal({
  title,
  videos,
  onClose,
}: SegmentVideoPreviewModalProps) {
  const t = useTranslations('video')
  const videoRef = useRef<HTMLVideoElement>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const playCurrent = () => {
    void videoRef.current?.play().catch(() => undefined)
    setIsTransitioning(false)
  }

  const switchTo = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= videos.length || nextIndex === currentIndex) return
    setIsTransitioning(true)
    window.setTimeout(() => setCurrentIndex(nextIndex), 180)
  }

  const handleEnded = () => {
    if (currentIndex < videos.length - 1) {
      switchTo(currentIndex + 1)
    }
  }

  const current = videos[currentIndex]
  if (!current) return null

  return (
    <div
      className="fixed inset-0 z-[150] glass-overlay flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="glass-surface-modal w-full max-w-4xl overflow-hidden rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-[var(--glass-stroke-subtle)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-[var(--glass-text-primary)]">{title}</h3>
            <p className="mt-0.5 text-xs text-[var(--glass-text-tertiary)]">
              {t('clipPreview.progress', { current: currentIndex + 1, total: videos.length })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="glass-btn-base glass-btn-soft h-9 w-9 justify-center rounded-full"
            aria-label={t('clipPreview.close')}
          >
            <AppIcon name="close" className="h-4 w-4" />
          </button>
        </div>

        <div className="bg-black p-3 sm:p-5">
          <div className="relative mx-auto flex max-h-[70vh] min-h-64 items-center justify-center overflow-hidden rounded-2xl bg-black">
            <video
              key={current.key}
              ref={videoRef}
              src={current.url}
              controls
              autoPlay
              playsInline
              onCanPlay={playCurrent}
              onEnded={handleEnded}
              className={`max-h-[70vh] w-full object-contain transition-opacity duration-200 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}
            />
            <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
              {t('clipPreview.shot', { number: current.shotNumber })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <button
            type="button"
            disabled={currentIndex === 0}
            onClick={() => switchTo(currentIndex - 1)}
            className="glass-btn-base glass-btn-soft px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            <AppIcon name="chevronLeft" className="h-4 w-4" />
            {t('clipPreview.previous')}
          </button>
          <div className="flex max-w-[60%] gap-1.5 overflow-x-auto py-1">
            {videos.map((video, index) => (
              <button
                key={video.key}
                type="button"
                onClick={() => switchTo(index)}
                className={`h-2.5 shrink-0 rounded-full transition-all ${index === currentIndex
                  ? 'w-8 bg-[var(--glass-tone-info-fg)]'
                  : 'w-2.5 bg-[var(--glass-stroke-strong)] hover:bg-[var(--glass-text-tertiary)]'
                }`}
                aria-label={t('clipPreview.jumpToShot', { number: video.shotNumber })}
              />
            ))}
          </div>
          <button
            type="button"
            disabled={currentIndex === videos.length - 1}
            onClick={() => switchTo(currentIndex + 1)}
            className="glass-btn-base glass-btn-soft px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('clipPreview.next')}
            <AppIcon name="chevronRight" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
