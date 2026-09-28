import { useCallback, useEffect, useState } from 'react'
import { AppButton } from '../../../components/AppButton'
import type { AiApi, AiConversation } from '../shared/types'
import type { MemoryCandidate, MemoryFact, MemoryMaintenanceStatus } from '../shared/memory-types'

interface Props {
  api: AiApi
  conversation: AiConversation | null
  facts: MemoryFact[]
  onFactsChange: () => Promise<void>
}

export function MaintenancePanel({ api, conversation, facts, onFactsChange }: Props) {
  const [status, setStatus] = useState<MemoryMaintenanceStatus | null>(null)
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    const [nextStatus, nextCandidates] = await Promise.all([
      api.getMemoryMaintenanceStatus(conversation?.id),
      api.listMemoryCandidates(),
      onFactsChange()
    ])
    setStatus(nextStatus)
    setCandidates(nextCandidates)
  }, [api, conversation?.id, onFactsChange])

  useEffect(() => {
    let alive = true
    void Promise.all([api.getMemoryMaintenanceStatus(conversation?.id), api.listMemoryCandidates()])
      .then(([nextStatus, nextCandidates]) => {
        if (!alive) return
        setStatus(nextStatus)
        setCandidates(nextCandidates)
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : '无法读取自动维护状态')
      })
    return () => {
      alive = false
    }
  }, [api, conversation?.id])

  const run = (action: () => Promise<void>) => {
    void (async () => {
      setBusy(true)
      setError('')
      setMessage('')
      try {
        await action()
        await refresh()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '操作失败')
      } finally {
        setBusy(false)
      }
    })()
  }

  const decide = (candidate: MemoryCandidate, decision: 'approve' | 'reject') =>
    run(async () => {
      const existing = facts.find(
        (item) => item.key.trim().toLocaleLowerCase() === candidate.key.trim().toLocaleLowerCase()
      )
      await api.decideMemoryCandidate(
        candidate.id,
        decision,
        candidate.revision,
        existing?.revision
      )
      setMessage(decision === 'approve' ? '已确认并保存。' : '已忽略此候选。')
    })

  return (
    <section className="ai-memory-card ai-memory-maintenance">
      <h4>自动维护</h4>
      {error ? <p className="ai-memory-error">{error}</p> : null}
      {message ? <p className="ai-memory-success">{message}</p> : null}
      <p>
        {status?.configuration === 'ready'
          ? '维护模型已配置'
          : status?.configuration === 'invalid'
            ? '维护模型配置无效'
            : '维护模型未配置'}
        {status ? ` · 待处理 ${status.jobs.pending ?? 0} · 失败 ${status.jobs.failed ?? 0}` : ''}
      </p>
      <label className="ai-memory-history-control">
        <input
          type="checkbox"
          checked={status?.enabled ?? false}
          disabled={busy || !status}
          onChange={(event) =>
            run(async () => {
              await api.setMemoryMaintenanceEnabled(event.target.checked)
            })
          }
        />
        自动提取明确的长期信息并更新会话概要
      </label>
      <p>维护模型独立于聊天模型配置。使用在线端点时，同步的对话内容会发送给该端点。</p>
      {status?.session ? (
        <div>
          <p>
            当前会话：已概括至第 {status.session.summaryThrough} 条 / 共{' '}
            {status.session.lastSequence} 条
            {status.session.state !== 'idle'
              ? ` · ${status.session.state === 'failed' ? '失败' : '处理中'}`
              : ''}
          </p>
          {status.session.lastError ? (
            <p className="ai-memory-error">{status.session.lastError}</p>
          ) : null}
          {status.session.state === 'failed' && conversation ? (
            <AppButton
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.retryMemoryMaintenance(conversation.id)
                })
              }
            >
              重试维护
            </AppButton>
          ) : null}
        </div>
      ) : null}
      <div className="ai-memory-item-actions">
        <strong>待确认信息（{candidates.length}）</strong>
        <AppButton disabled={busy} onClick={() => run(async () => undefined)}>
          刷新
        </AppButton>
      </div>
      <ul>
        {candidates.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.key}</strong>
              <p>{item.content}</p>
              <p>原话：{item.evidence}</p>
            </div>
            <div className="ai-memory-item-actions">
              <AppButton disabled={busy} onClick={() => decide(item, 'approve')}>
                确认
              </AppButton>
              <AppButton variant="danger" disabled={busy} onClick={() => decide(item, 'reject')}>
                忽略
              </AppButton>
            </div>
          </li>
        ))}
      </ul>
      {!candidates.length ? <p>目前没有待确认信息。</p> : null}
    </section>
  )
}
