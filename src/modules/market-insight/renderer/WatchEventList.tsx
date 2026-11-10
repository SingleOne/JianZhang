import { Check, CircleAlert } from 'lucide-react'
import { AppButton } from '../../../components/AppButton'
import type { WatchEvent } from '../shared/types'

interface WatchEventListProps {
  events: readonly WatchEvent[]
  onAcknowledge: (eventId: string) => void
  onClearExpired: () => void
}

export function WatchEventList({ events, onAcknowledge, onClearExpired }: WatchEventListProps) {
  const expiredCount = events.filter((event) => event.status === 'expired').length
  return (
    <section className="insight-section">
      <div className="insight-section-heading">
        <h3>当前观察事件</h3>
        {expiredCount > 0 ? (
          <AppButton variant="plain" onClick={onClearExpired}>
            清除已过期（{expiredCount}）
          </AppButton>
        ) : null}
      </div>
      {events.length === 0 ? (
        <p className="insight-empty">当前快照未检测到新的观察事件。</p>
      ) : (
        <div className="insight-event-list">
          {events.map((event) => (
            <article
              className={`insight-event is-${event.severity} is-${event.status}`}
              key={event.id}
            >
              <CircleAlert size={15} />
              <div>
                <strong>{event.title}</strong>
                <span>{event.facts.join(' · ')}</span>
              </div>
              {event.status === 'active' ? (
                <AppButton className="insight-event-ack" onClick={() => onAcknowledge(event.id)}>
                  <Check size={13} />
                  确认已读
                </AppButton>
              ) : (
                <small>{event.status === 'acknowledged' ? '已确认' : '已过期'}</small>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
