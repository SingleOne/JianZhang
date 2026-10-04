import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { AiApi } from '../shared/types'
import type { ChatMemorySourceResult } from '../shared/memory-types'

export function ChatSourcePreview({
  api,
  conversationId,
  messageId,
  citationId,
  onClose
}: {
  api: AiApi
  conversationId: string
  messageId: string
  citationId: string
  onClose: () => void
}) {
  const [result, setResult] = useState<ChatMemorySourceResult | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    let alive = true
    const read = async () => {
      const requestGeneration = ++generation.current
      setResult(null)
      try {
        const loaded = await api.readChatMemorySource(conversationId, messageId, citationId)
        if (alive && requestGeneration === generation.current) setResult(loaded)
      } catch {
        if (alive && requestGeneration === generation.current)
          setResult({ state: 'unavailable', message: '暂时无法读取来源，请稍后重试' })
      }
    }
    const unsubscribe = api.onMemorySourcesChanged(() => {
      generation.current++
      setResult(null)
      onClose()
    })
    void read()
    const timer = window.setInterval(() => void read(), 30_000)
    return () => {
      alive = false
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [api, conversationId, messageId, citationId, onClose])
  return (
    <div className="ai-memory-source-preview ai-chat-source-preview" aria-live="polite">
      <div className="ai-chat-source-preview-heading">
        <strong>
          [{citationId}]{' '}
          {result?.state === 'available'
            ? (result.source.fileName ?? result.source.title ?? result.source.key ?? '来源原文')
            : '来源原文'}
        </strong>
        <button type="button" onClick={onClose} aria-label="关闭来源原文">
          <X size={14} />
        </button>
      </div>
      {result?.state === 'available' ? (
        <>
          <small>
            {[
              result.source.versionNo ? `版本 ${result.source.versionNo}` : '',
              result.source.locator,
              result.source.coverage === 'partial' ? '部分页未覆盖' : '',
              result.source.evidenceInvalid ? '该回答的来源证据已失效' : ''
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
          <p>{result.source.text}</p>
        </>
      ) : (
        <p>{result?.message ?? '正在读取来源…'}</p>
      )}
    </div>
  )
}
