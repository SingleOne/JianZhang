import { useCallback, useRef, useState, type DragEvent } from 'react'

interface UseDragReorderOptions {
  disabled: boolean
  onReorder: (sourceQuoteId: string, targetQuoteId: string) => void
}

export function useDragReorder({ disabled, onReorder }: UseDragReorderOptions) {
  const [draggingQuoteId, setDraggingQuoteId] = useState<string | null>(null)
  const [dragOverQuoteId, setDragOverQuoteId] = useState<string | null>(null)
  const draggingQuoteIdRef = useRef<string | null>(null)
  const disabledRef = useRef(disabled)
  const onReorderRef = useRef(onReorder)
  disabledRef.current = disabled
  onReorderRef.current = onReorder

  const clearDragState = useCallback(() => {
    draggingQuoteIdRef.current = null
    setDraggingQuoteId(null)
    setDragOverQuoteId(null)
  }, [])

  const handleDragStart = useCallback((quoteId: string, event: DragEvent<HTMLElement>) => {
    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'move'
    draggingQuoteIdRef.current = quoteId
    setDraggingQuoteId(quoteId)
  }, [])

  const handleDragOver = useCallback((quoteId: string, event: DragEvent<HTMLTableRowElement>) => {
    const sourceQuoteId = draggingQuoteIdRef.current
    if (disabledRef.current || !sourceQuoteId || sourceQuoteId === quoteId) return
    event.preventDefault()
    setDragOverQuoteId(quoteId)
  }, [])

  const handleDrop = useCallback(
    (quoteId: string, event: DragEvent<HTMLTableRowElement>) => {
      event.preventDefault()
      const sourceQuoteId = draggingQuoteIdRef.current
      if (sourceQuoteId && sourceQuoteId !== quoteId) {
        onReorderRef.current(sourceQuoteId, quoteId)
      }
      clearDragState()
    },
    [clearDragState]
  )

  return {
    draggingQuoteId,
    dragOverQuoteId,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd: clearDragState
  }
}
