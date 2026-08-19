export const MAX_TEXT_DOCUMENT_FILE_SIZE = 10 * 1024 * 1024

export async function readTextDocumentFile(file: File): Promise<string> {
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

