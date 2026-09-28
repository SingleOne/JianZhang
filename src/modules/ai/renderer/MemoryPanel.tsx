import { useCallback, useEffect, useRef, useState } from 'react'
import { BrainCircuit } from 'lucide-react'
import { AppButton } from '../../../components/AppButton'
import { AppSelect, type AppSelectOption } from '../../../components/AppSelect'
import type { AiApi, AiConversation } from '../shared/types'
import type {
  MemoryFact,
  MemorySearchResult,
  MemorySourceDetail,
  MemoryStatus
} from '../shared/memory-types'
import { KnowledgePanel } from './KnowledgePanel'
import { MaintenancePanel } from './MaintenancePanel'

interface Props {
  api: AiApi
  conversation: AiConversation | null
}

export function MemoryPanel({ api, conversation }: Props) {
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [facts, setFacts] = useState<MemoryFact[]>([])
  const [results, setResults] = useState<MemorySearchResult[]>([])
  const [preview, setPreview] = useState<MemorySourceDetail | null>(null)
  const previewGeneration = useRef(0)
  const identityGeneration = useRef(0)
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
    const generation = ++identityGeneration.current
    const next = await api.getMemoryStatus()
    if (generation !== identityGeneration.current) return
    setStatus(next)
    if (next.activeProfileId) {
      const loaded = await api.listMemoryFacts()
      if (generation === identityGeneration.current) setFacts(loaded)
    } else setFacts([])
  }, [api])

  useEffect(() => {
    let alive = true
    const generation = ++identityGeneration.current
    void api
      .getMemoryStatus()
      .then(async (next) => {
        if (!alive || generation !== identityGeneration.current) return
        setStatus(next)
        if (next.activeProfileId) {
          const loaded = await api.listMemoryFacts()
          if (alive && generation === identityGeneration.current) setFacts(loaded)
        }
      })
      .catch(
        (reason: unknown) =>
          alive &&
          generation === identityGeneration.current &&
          setError(reason instanceof Error ? reason.message : '无法读取记忆状态')
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
      identityGeneration.current++
      previewGeneration.current++
      setResults([])
      setPreview(null)
      const profile = await api.connectMemory(name, url, token)
      setToken('')
      await refresh()
      setMessage(`已连接 ${profile.displayName}，新建会话会使用此记忆身份。`)
    })
  const select = (profileId: string | null) =>
    void run(async () => {
      identityGeneration.current++
      previewGeneration.current++
      setResults([])
      setPreview(null)
      await api.selectMemory(profileId)
      await refresh()
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
      const generation = ++previewGeneration.current
      setPreview(null)
      const found = await api.searchMemory(query)
      if (generation === previewGeneration.current) setResults(found)
    })
  const openPreview = (item: MemorySearchResult) =>
    void run(async () => {
      const generation = ++previewGeneration.current
      const source = await api.readMemorySource(item.kind, item.sourceId)
      if (generation === previewGeneration.current) setPreview(source)
    })

  const active = status?.profiles.find((profile) => profile.id === status.activeProfileId)
  const binding = conversation ? status?.bindings[conversation.id] : undefined
  const profileOptions: AppSelectOption<string>[] = [
    { value: '', label: '关闭记忆' },
    ...(status?.profiles.map((profile) => ({
      value: profile.id,
      label: `${profile.name} · ${profile.displayName}`
    })) ?? [])
  ]
  return (
    <section className="ai-settings-card ai-memory-panel">
      <header className="ai-settings-card-heading">
        <span className="ai-settings-card-icon">
          <BrainCircuit size={17} />
        </span>
        <div>
          <h3>记忆服务</h3>
          <p>本机服务保存用户资料与会话副本，连接令牌由见涨加密保存。</p>
        </div>
      </header>
      {error ? <p className="ai-memory-error">{error}</p> : null}
      {message ? <p className="ai-memory-success">{message}</p> : null}
      <div className="ai-memory-grid">
        <section className="ai-memory-card ai-memory-connection">
          <h4>连接与身份</h4>
          <div className="ai-memory-connection-fields">
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
          </div>
          <div className="ai-memory-connection-actions">
            <label>
              当前身份
              <AppSelect
                className="ai-settings-select ai-memory-identity-select"
                value={status?.activeProfileId ?? ''}
                options={profileOptions}
                label="当前记忆身份"
                disabled={busy}
                onChange={(profileId) => select(profileId || null)}
              />
            </label>
            <AppButton
              variant="primary"
              disabled={busy || !url.trim() || !token.trim()}
              onClick={connect}
            >
              测试并保存连接
            </AppButton>
          </div>
          <p className="ai-memory-connection-status">
            {active
              ? `用户：${active.displayName} · 服务：${active.serviceId.slice(0, 8)} · 待同步删除：${status?.pendingDeletes ?? 0}`
              : '记忆当前关闭，普通 AI 对话仍可使用。'}
          </p>
        </section>
        {active ? (
          <>
            <section className="ai-memory-card ai-memory-session">
              <h4>当前会话</h4>
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
                  <AppButton disabled={busy} onClick={bind}>
                    为此会话启用记忆
                  </AppButton>
                )
              ) : (
                <p>选择会话后可启用记忆；新会话会自动绑定当前身份。</p>
              )}
            </section>
            <section className="ai-memory-card ai-memory-facts">
              <h4>用户记忆</h4>
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
                <div className="ai-memory-form-actions">
                  <AppButton
                    variant="primary"
                    disabled={busy || !factKey.trim() || !factContent.trim()}
                    onClick={save}
                  >
                    {editing ? '保存修改' : '添加记忆'}
                  </AppButton>
                  {editing ? (
                    <AppButton
                      onClick={() => {
                        setEditing(null)
                        setFactKey('')
                        setFactContent('')
                      }}
                    >
                      取消编辑
                    </AppButton>
                  ) : null}
                </div>
              </div>
              <ul>
                {facts.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.key}</strong>
                      <p>{item.content}</p>
                    </div>
                    <div className="ai-memory-item-actions">
                      <AppButton
                        disabled={busy}
                        onClick={() => {
                          setEditing(item)
                          setFactKey(item.key)
                          setFactContent(item.content)
                        }}
                      >
                        编辑
                      </AppButton>
                      <AppButton variant="danger" disabled={busy} onClick={() => remove(item)}>
                        删除
                      </AppButton>
                    </div>
                  </li>
                ))}
              </ul>
              {!facts.length ? <p>还没有用户记忆。</p> : null}
            </section>
            <MaintenancePanel
              key={`maintenance:${active.id}`}
              api={api}
              conversation={conversation}
              facts={facts}
              onFactsChange={refresh}
            />
            <KnowledgePanel
              key={active.id}
              api={api}
              conversation={conversation}
              binding={binding?.profileId === active.id ? binding : undefined}
              onBindingChange={refresh}
              onSourcesChange={() => {
                previewGeneration.current++
                setResults([])
                setPreview(null)
              }}
            />
            <section className="ai-memory-card ai-memory-search-card">
              <h4>检索用户资料、历史与文件</h4>
              <div className="ai-memory-search">
                <input
                  aria-label="检索内容"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && query.trim()) search()
                  }}
                />
                <AppButton disabled={busy || !query.trim()} onClick={search}>
                  检索
                </AppButton>
              </div>
              <ul>
                {results.map((item) => (
                  <li key={`${item.kind}:${item.sourceId}`}>
                    <strong>
                      {item.kind === 'fact'
                        ? item.key
                        : item.kind === 'document'
                          ? `${item.fileName ?? '文件'} · ${item.locator ?? '正文'}`
                          : item.title}
                    </strong>
                    <p>{item.text}</p>
                    <AppButton disabled={busy} onClick={() => openPreview(item)}>
                      查看来源
                    </AppButton>
                  </li>
                ))}
              </ul>
              {preview ? (
                <div className="ai-memory-source-preview">
                  <strong>
                    {preview.kind === 'document'
                      ? `${preview.fileName ?? '文件'} · ${preview.locator ?? '正文'}`
                      : '来源内容'}
                  </strong>
                  <p>{preview.text}</p>
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </section>
  )
}
