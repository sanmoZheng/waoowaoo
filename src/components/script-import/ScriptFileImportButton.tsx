'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { assessImportedScript } from '@/lib/script-import'

const MAX_FILE_SIZE = 10 * 1024 * 1024

interface ScriptFileImportButtonProps {
  onImported: (text: string) => void | Promise<void>
  disabled?: boolean
  className?: string
}

async function readScriptFile(file: File): Promise<string> {
  const extension = file.name.toLowerCase().split('.').pop() || ''
  if (extension === 'txt') return file.text()
  if (extension === 'docx') {
    const mammoth = await import('mammoth/mammoth.browser')
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return result.value
  }
  if (extension === 'doc') throw new Error('docNotSupported')
  throw new Error('unsupportedType')
}

export default function ScriptFileImportButton({ onImported, disabled = false, className = '' }: ScriptFileImportButtonProps) {
  const t = useTranslations('novelPromotion.scriptImport')
  const inputRef = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_FILE_SIZE) {
      window.alert(t('errors.fileTooLarge'))
      return
    }

    setReading(true)
    try {
      const text = (await readScriptFile(file)).replace(/\r\n?/g, '\n').trim()
      const assessment = assessImportedScript(text)
      if (assessment.level === 'reject') {
        window.alert(t(`errors.${assessment.reason || 'unstructured'}`))
        return
      }
      if (assessment.level === 'normalize' && !window.confirm(t('normalizeConfirm'))) return
      await onImported(text)
    } catch (error) {
      const key = error instanceof Error ? error.message : 'readFailed'
      const knownKey = ['docNotSupported', 'unsupportedType'].includes(key) ? key : 'readFailed'
      window.alert(t(`errors.${knownKey}`))
    } finally {
      setReading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      <button
        type="button"
        disabled={disabled || reading}
        onClick={() => inputRef.current?.click()}
        className={`glass-btn-base flex h-10 items-center gap-2 px-3 text-sm disabled:opacity-50 ${className}`}
      >
        <AppIcon name="fileText" className="h-4 w-4" />
        <span>{reading ? t('reading') : t('button')}</span>
      </button>
    </>
  )
}

