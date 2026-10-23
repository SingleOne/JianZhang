import { ArrowDown } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AppButton } from '../../../components/AppButton'
import { Tooltip } from '../../../components/Tooltip'

const BOTTOM_THRESHOLD = 48

interface ChatMessageViewportProps {
  latestUserMessageId?: string
  children: ReactNode
}

export function ChatMessageViewport({ latestUserMessageId, children }: ChatMessageViewportProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const followLatestRef = useRef(true)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)

  const scrollToLatest = useCallback(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    followLatestRef.current = true
    scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'instant' })
    setShowScrollToLatest(false)
  }, [])

  const updateScrollPosition = useCallback(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const atBottom =
      scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= BOTTOM_THRESHOLD
    followLatestRef.current = atBottom
    setShowScrollToLatest(!atBottom)
  }, [])

  useLayoutEffect(() => {
    scrollToLatest()
  }, [latestUserMessageId, scrollToLatest])

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!scroll || !content) return
    const observer = new ResizeObserver(() => {
      if (followLatestRef.current) scrollToLatest()
      else updateScrollPosition()
    })
    observer.observe(scroll)
    observer.observe(content)
    return () => observer.disconnect()
  }, [scrollToLatest, updateScrollPosition])

  return (
    <div className="ai-message-viewport">
      <div className="ai-message-stream" ref={scrollRef} onScroll={updateScrollPosition}>
        <div className="ai-message-list" ref={contentRef}>
          {children}
        </div>
      </div>
      {showScrollToLatest ? (
        <Tooltip content="回到最新消息">
          <AppButton
            variant="plain"
            className="ai-scroll-to-latest"
            aria-label="回到最新消息"
            onClick={scrollToLatest}
          >
            <ArrowDown size={18} aria-hidden="true" />
          </AppButton>
        </Tooltip>
      ) : null}
    </div>
  )
}
