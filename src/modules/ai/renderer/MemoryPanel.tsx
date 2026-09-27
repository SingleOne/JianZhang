import { useCallback, useEffect, useState } from 'react'
import type { AiApi, AiConversation } from '../shared/types'
import type { MemoryFact, MemorySearchResult, MemoryStatus } from '../shared/memory-types'

interface Props {
  api: AiApi
  conversation: AiConversation | null
}

export function MemoryPanel({ api, conversation }: Props) {
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [facts, setFacts] = useState<MemoryFact[]>([])
  const [results, setResults] = useState<MemorySearchResult[]>([])
  const [name, setName] = useState('本地记忆')
  const [url, setUrl] = useState('http://127.0.0.1:43127')
  const [token, setToken] = useState('')
  const [query, setQuery] = useState('')
  const [factKey, setFactKey] = useState('')
  const [factContent, setFactContent] = useState('')
  const [editing, setEditing] = useState<MemoryFact | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    const next = await api.getMemoryStatus()
    setStatus(next)
    if (next.activeProfileId) setFacts(await api.listMemoryFacts())
    else setFacts([])
  }, [api])

  useEffect(() => {
    let alive = true
    void api
      .getMemoryStatus()
      .then(async (next) => {
        if (!alive) return
        setStatus(next)
        if (next.activeProfileId) {
          const loaded = await api.listMemoryFacts()
          if (alive) setFacts(loaded)
        }
      })
      .catch(
        (reason: unknown) =>
          alive && setError(reason instanceof Error ? reason.message : '无法读取记忆状态')
      )
    return () => {
      alive = false
    }
  }, [api])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const connect = () =>
    void run(async () => {
      const profile = await api.connectMemory(name, url, token)
      setToken('')
      await refresh()
      setMessage(`已连接 ${profile.displayName}，新建会话会使用此记忆身份。`)
    })
  const select = (profileId: string | null) =>
    void run(async () => {
      await api.selectMemory(profileId)
      await refresh()
      setResults([])
    })
  const bind = () =>
    void run(async () => {
      if (!conversation) return
      await api.enableConversationMemory(conversation.id)
      await refresh()
      setMessage('此会话已绑定当前记忆用户；下次发送消息时同步。')
    })
  const changeHistory = (visible: boolean) =>
    void run(async () => {
      if (!conversation) return
      await api.setConversationMemoryHistory(conversation.id, visible)
      await refresh()
    })
  const save = () =>
    void run(async () => {
      await api.saveMemoryFact({
        id: editing?.id,
        expectedRevision: editing?.revision,
        key: factKey,
        content: factContent,
        category: editing?.category ?? 'preference',
        pinned: editing?.pinned ?? false
      })
      setEditing(null)
      setFactKey('')
      setFactContent('')
      await refresh()
      setMessage('记忆已保存。')
    })
  const remove = (item: MemoryFact) =>
    void run(async () => {
      await api.deleteMemoryFact(item.id, item.revision)
      await refresh()
      setMessage('记忆已删除。')
    })
  const search = () =>
    void run(async () => {
      setResults(await api.searchMemory(query))
    })

  const active = status?.profiles.find((profile) => profile.id === status.activeProfileId)
  const binding = conversation ? status?.bindings[conversation.id] : undefined
  return (
    <section className="ai-memory-panel">
      <header>
        <h2>记忆服务</h2>
        <p>
          独立服务需先在本机启动。启用后，会话消息副本会同步到该服务；连接令牌保存在见涨主进程的加密存储中。
        </p>
      </header>
      {error ? <p className="ai-memory-error">{error}</p> : null}
      {message ? <p className="ai-memory-success">{message}</p> : null}
      <section className="ai-memory-card">
        <h3>连接</h3>
        <label>
          连接名称
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          服务地址
          <input value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label>
          连接令牌
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
          />
        </label>
        <button type="button" disabled={busy || !url.trim() || !token.trim()} onClick={connect}>
          测试并保存连接
        </button>
        <label>
          当前身份
          <select
            value={status?.activeProfileId ?? ''}
            disabled={busy}
            onChange={(event) => select(event.target.value || null)}
          >
            <option value="">关闭记忆</option>
            {status?.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · {profile.displayName}
              </option>
            ))}
          </select>
        </label>
        {active ? (
          <p>
            用户：{active.displayName} · 服务：{active.serviceId.slice(0, 8)} · 待同步删除：
            {status?.pendingDeletes ?? 0}
          </p>
        ) : (
          <p>记忆功能当前关闭，普通 AI 对话仍可使用。</p>
        )}
      </section>
      {active ? (
        <>
          <section className="ai-memory-card">
            <h3>当前会话</h3>
            {conversation ? (
              binding ? (
                <>
                  <p>
                    {binding.profileId === active.id
                      ? '已绑定当前身份'
                      : '已绑定另一位用户，请切回原连接或新建会话'}
                    {binding.pendingDelete ? ' · 删除待同步' : ''}
                  </p>
                  {binding.profileId === active.id && !binding.pendingDelete ? (
                    <label className="ai-memory-history-control">
                      <input
                        type="checkbox"
                        checked={binding.historyVisible}
                        disabled={busy}
                        onChange={(event) => changeHistory(event.target.checked)}
                      />
                      允许同一用户的其他授权会话检索此会话
                    </label>
                  ) : null}
                </>
              ) : (
                <button type="button" disabled={busy} onClick={bind}>
                  为此会话启用记忆
                </button>
              )
            ) : (
              <p>选择一个会话后可启用记忆；新建会话会自动绑定当前身份。</p>
            )}
          </section>
          <section className="ai-memory-card">
            <h3>用户记忆</h3>
            <div className="ai-memory-form">
              <input
                aria-label="记忆名称"
                placeholder="例如：回答偏好"
                value={factKey}
                onChange={(event) => setFactKey(event.target.value)}
              />
              <textarea
                aria-label="记忆内容"
                placeholder="输入长期有效的事实或偏好"
                value={factContent}
                onChange={(event) => setFactContent(event.target.value)}
              />
              <button
                type="button"
                disabled={busy || !factKey.trim() || !factContent.trim()}
                onClick={save}
              >
                {editing ? '保存修改' : '添加记忆'}
              </button>
              {editing ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null)
                    setFactKey('')
                    setFactContent('')
                  }}
                >
                  取消编辑
                </button>
              ) : null}
            </div>
            <ul>
              {facts.map((item) => (
                <li key={item.id}>
                  <strong>{item.key}</strong>
                  <p>{item.content}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(item)
                      setFactKey(item.key)
                      setFactContent(item.content)
                    }}
                  >
                    编辑
                  </button>
                  <button type="button" disabled={busy} onClick={() => remove(item)}>
                    删除
                  </button>
                </li>
              ))}
            </ul>
            {!facts.length ? <p>还没有用户记忆。</p> : null}
          </section>
          <section className="ai-memory-card">
            <h3>检索记忆与历史</h3>
            <div className="ai-memory-search">
              <input
                aria-label="检索内容"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && query.trim()) search()
                }}
              />
              <button type="button" disabled={busy || !query.trim()} onClick={search}>
                检索
              </button>
            </div>
            <ul>
              {results.map((item) => (
                <li key={`${item.kind}:${item.sourceId}`}>
                  <strong>{item.kind === 'fact' ? item.key : item.title}</strong>
                  <p>{item.text}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </section>
  )
}
