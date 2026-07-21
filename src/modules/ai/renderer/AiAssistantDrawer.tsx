import {
  AlertCircle,
  Bot,
  Check,
  Download,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings2,
  Square,
  Trash2,
  X
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AiConnectionResult,
  AiConversation,
  AiMessage,
  AiProviderId,
  AiSettings,
  AiStatus
} from '../shared/types'

export interface AiAssistantContext {
  quoteId: string
  quoteName?: string
}

interface AiAssistantDrawerProps {
  open: boolean
  onClose: () => void
  context?: AiAssistantContext | null
}

function formatMessageTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function downloadJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

interface ConversationListProps {
  conversations: AiConversation[]
  activeId: string | null
  search: string
  onSearchChange: (value: string) => void
  onCreate: () => void
  onSelect: (conversationId: string) => void
  onRename: (conversation: AiConversation) => void
  onDelete: (conversation: AiConversation) => void
  onClear: () => void
  onExportAll: () => void
}

function ConversationList({
  conversations,
  activeId,
  search,
  onSearchChange,
  onCreate,
  onSelect,
  onRename,
  onDelete,
  onClear,
  onExportAll
}: ConversationListProps) {
  return (
    <aside className="ai-conversation-list">
      <button className="primary-button ai-new-conversation" type="button" onClick={onCreate}>
        <Plus size={15} />
        新对话
      </button>
      <label className="ai-conversation-search">
        <Search size={14} />
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索对话和消息" />
      </label>
      <div className="ai-conversation-items">
        {conversations.length > 0 ? conversations.map((conversation) => (
          <div className={`ai-conversation-item ${activeId === conversation.id ? 'is-active' : ''}`} key={conversation.id}>
            <button type="button" onClick={() => onSelect(conversation.id)}>
              <strong>{conversation.title}</strong>
              <span>{conversation.scope === 'stock' ? conversation.quoteName ?? conversation.quoteId : '普通对话'} · {formatMessageTime(conversation.updatedAt)}</span>
            </button>
            <div className="ai-conversation-item-actions">
              <button type="button" title="重命名" aria-label={`重命名${conversation.title}`} onClick={() => onRename(conversation)}>
                <Pencil size={13} />
              </button>
              <button type="button" title="删除" aria-label={`删除${conversation.title}`} onClick={() => onDelete(conversation)}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        )) : <p className="ai-empty-list">还没有匹配的本地对话</p>}
      </div>
      <footer className="ai-conversation-list-footer"><button type="button" onClick={onExportAll}><Download size={13} />导出全部</button><button type="button" onClick={onClear}><Trash2 size={13} />清空全部</button></footer>
    </aside>
  )
}

interface ChatThreadProps {
  conversation: AiConversation | null
  messages: AiMessage[]
  onCancel: () => void
  onRetry: (messageId: string) => void
  onExport: () => void
}

function ChatThread({ conversation, messages, onCancel, onRetry, onExport }: ChatThreadProps) {
  const isGenerating = messages.some((message) => message.role === 'assistant' && (message.status === 'pending' || message.status === 'streaming'))
  return (
    <section className="ai-chat-thread" aria-label="AI 对话内容">
      <header className="ai-chat-heading">
        <div>
          <small>{conversation?.scope === 'stock' ? '股票上下文对话' : '通用对话'}</small>
          <h2>{conversation?.title ?? '选择或创建一个对话'}</h2>
        </div>
        {conversation ? (
          <button className="icon-button ai-thread-export" type="button" title="导出此对话" aria-label="导出此对话" onClick={onExport}>
            <Download size={16} />
          </button>
        ) : null}
      </header>
      <div className="ai-message-stream">
        {conversation ? messages.length > 0 ? messages.map((message) => (
          <article className={`ai-message is-${message.role} is-${message.status}`} key={message.id}>
            <div className="ai-message-avatar">{message.role === 'assistant' ? <Bot size={15} /> : '我'}</div>
            <div className="ai-message-content">
              <div className="ai-message-meta">
                <span>{message.role === 'assistant' ? 'AI 助手' : '你'}</span>
                <time>{formatMessageTime(message.createdAt)}</time>
                {message.contextRef ? <small>快照 {message.contextRef.snapshotId}</small> : null}
              </div>
              <p>{message.content || (message.status === 'pending' || message.status === 'streaming' ? '正在生成…' : '')}</p>
              {message.status === 'error' ? (
                <div className="ai-message-error">
                  <AlertCircle size={13} />
                  <span>{message.errorMessage ?? '生成失败'}</span>
                  <button type="button" onClick={() => onRetry(message.id)}><RotateCcw size={13} />重试</button>
                </div>
              ) : null}
              {message.status === 'stopped' ? (
                <button className="ai-message-retry" type="button" onClick={() => onRetry(message.id)}><RotateCcw size={13} />重新生成</button>
              ) : null}
              {message.status === 'completed' && message.role === 'assistant' && !isGenerating ? (
                <button className="ai-message-retry" type="button" onClick={() => onRetry(message.id)}><RotateCcw size={13} />重新生成</button>
              ) : null}
            </div>
          </article>
        )) : <div className="ai-thread-empty"><Bot size={25} /><strong>开始一段对话</strong><span>可以询问应用功能、指标定义或新闻背景。</span></div> : <div className="ai-thread-empty"><MessageSquare size={25} /><strong>还未选择对话</strong><span>从左侧创建一个新对话即可开始。</span></div>}
      </div>
      {isGenerating ? (
        <div className="ai-generation-controls"><span><LoaderCircle size={14} className="is-spinning" />正在生成</span><button type="button" onClick={onCancel}><Square size={12} />停止</button></div>
      ) : null}
    </section>
  )
}

interface AiSettingsPanelProps {
  status: AiStatus
  settings: AiSettings
  onSave: (settings: AiSettings) => void
  onSaveCredential: (providerId: AiProviderId, key: string) => void
  onClearCredential: (providerId: AiProviderId) => void
  onTestConnection: (providerId: AiProviderId) => void
  busy: boolean
  connectionResult: AiConnectionResult | null
}

function AiSettingsPanel({
  status,
  settings,
  onSave,
  onSaveCredential,
  onClearCredential,
  onTestConnection,
  busy,
  connectionResult
}: AiSettingsPanelProps) {
  const [draft, setDraft] = useState(settings)
  const [apiKey, setApiKey] = useState('')
  const activeProvider = status.providers.find((item) => item.id === draft.providerId) ?? status.providers[0]
  const credential = status.credentials[draft.providerId]

  useEffect(() => setDraft(settings), [settings])

  const selectProvider = (providerId: AiProviderId) => {
    const provider = status.providers.find((item) => item.id === providerId)
    setDraft((current) => ({ ...current, providerId, model: provider?.defaultModel ?? current.model }))
    setApiKey('')
  }

  return (
    <section className="ai-settings-panel">
      <header><Settings2 size={17} /><div><h2>服务设置</h2><p>密钥只在主进程安全存储，界面不会读取明文。</p></div></header>
      <label className="ai-settings-toggle">
        <span><strong>启用 AI 助手</strong><small>关闭后不显示入口，也不会发送 Provider 请求。</small></span>
        <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} />
      </label>
      <div className="ai-settings-fields">
        <label>
          <span>Provider</span>
          <select value={draft.providerId} onChange={(event) => selectProvider(event.target.value as AiProviderId)}>
            {status.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
          <small>{activeProvider?.billingHint}</small>
        </label>
        <label>
          <span>模型 ID</span>
          <input value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} placeholder={activeProvider?.defaultModel} />
        </label>
        <label>
          <span>本地上下文消息数</span>
          <input type="number" min="4" max="40" value={draft.maxContextMessages} onChange={(event) => setDraft((current) => ({ ...current, maxContextMessages: Number(event.target.value) || 4 }))} />
        </label>
      </div>
      <div className="ai-credential-card">
        <div><KeyRound size={16} /><span><strong>API Key</strong><small>{credential.configured ? `已配置 · 尾号 ${credential.maskedSuffix}` : '尚未配置'}</small></span></div>
        <div className="ai-credential-actions">
          <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="粘贴新的 API Key" autoComplete="off" />
          <button className="secondary-button" type="button" disabled={!apiKey.trim() || busy} onClick={() => onSaveCredential(draft.providerId, apiKey)}>保存 Key</button>
          {credential.configured ? <button className="ai-text-button danger" type="button" disabled={busy} onClick={() => onClearCredential(draft.providerId)}>清除</button> : null}
        </div>
      </div>
      <div className="ai-settings-footer">
        <button className="secondary-button" type="button" disabled={!credential.configured || busy} onClick={() => onTestConnection(draft.providerId)}>{busy ? <LoaderCircle size={14} className="is-spinning" /> : <Check size={14} />}测试连接</button>
        <button className="primary-button" type="button" disabled={busy} onClick={() => onSave(draft)}>保存设置</button>
      </div>
      {connectionResult ? <p className={`ai-connection-result is-${connectionResult.kind}`}><span>{connectionResult.ok ? <Check size={14} /> : <AlertCircle size={14} />}</span>{connectionResult.message}</p> : null}
      <p className="ai-settings-note">OpenAI Codex 登录仍需官方运行时的发行可用性验证，本期只提供独立的 API Key 接入。</p>
    </section>
  )
}

export function AiAssistantDrawer({ open, onClose, context }: AiAssistantDrawerProps) {
  const api = window.aiApi
  const [activeTab, setActiveTab] = useState<'chat' | 'settings'>('chat')
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [conversations, setConversations] = useState<AiConversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [activeConversation, setActiveConversation] = useState<AiConversation | null>(null)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [search, setSearch] = useState('')
  const [composer, setComposer] = useState('')
  const [includeStockContext, setIncludeStockContext] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [connectionResult, setConnectionResult] = useState<AiConnectionResult | null>(null)
  const openedContextRef = useRef<string | null>(null)

  const loadConversations = useCallback(async (query = '') => {
    if (!api) return
    const next = await api.listConversations(query)
    setConversations(next)
    setActiveConversationId((current) => current && next.some((conversation) => conversation.id === current) ? current : next[0]?.id ?? null)
  }, [api])

  useEffect(() => {
    if (!api || !open) return
    let alive = true
    void Promise.all([api.getStatus(), api.getSettings(), api.listConversations(search)])
      .then(([nextStatus, nextSettings, nextConversations]) => {
        if (!alive) return
        setStatus(nextStatus)
        setSettings(nextSettings)
        setConversations(nextConversations)
        setActiveConversationId((current) => current && nextConversations.some((conversation) => conversation.id === current) ? current : nextConversations[0]?.id ?? null)
      })
      .catch((reason: unknown) => alive && setError(reason instanceof Error ? reason.message : '无法加载 AI 助手'))
    return () => { alive = false }
  }, [api, open, search])

  useEffect(() => {
    if (!api || !open || !context) return
    const contextKey = `${context.quoteId}:${context.quoteName ?? ''}`
    if (openedContextRef.current === contextKey) return
    openedContextRef.current = contextKey
    void api.createConversation({ scope: 'stock', quoteId: context.quoteId, quoteName: context.quoteName })
      .then((conversation) => {
        setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)])
        setActiveConversationId(conversation.id)
        setIncludeStockContext(true)
        setActiveTab('chat')
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '无法创建股票对话'))
  }, [api, context, open])

  useEffect(() => {
    if (!open) openedContextRef.current = null
  }, [open])

  useEffect(() => {
    if (!api || !activeConversationId) {
      setActiveConversation(null)
      setMessages([])
      return
    }
    let alive = true
    void api.getConversation(activeConversationId)
      .then((result) => {
        if (!alive) return
        setActiveConversation(result?.conversation ?? null)
        setMessages(result?.messages ?? [])
        setIncludeStockContext(result?.conversation?.scope === 'stock')
      })
      .catch((reason: unknown) => alive && setError(reason instanceof Error ? reason.message : '无法加载对话'))
    return () => { alive = false }
  }, [activeConversationId, api])

  useEffect(() => {
    if (!api) return
    const mergeMessage = (message: AiMessage) => {
      if (message.conversationId !== activeConversationId) return
      setMessages((current) => current.some((item) => item.id === message.id)
        ? current.map((item) => item.id === message.id ? message : item)
        : [...current, message])
      void loadConversations(search)
    }
    const unDelta = api.onChatDelta(({ conversationId, messageId, delta }) => {
      if (conversationId !== activeConversationId) return
      setMessages((current) => current.map((message) => message.id === messageId
        ? { ...message, content: `${message.content}${delta}`, status: 'streaming' }
        : message))
    })
    const unCompleted = api.onChatCompleted(({ message }) => mergeMessage(message))
    const unError = api.onChatError(({ message }) => mergeMessage(message))
    return () => { unDelta(); unCompleted(); unError() }
  }, [activeConversationId, api, loadConversations, search])

  const createConversation = async () => {
    if (!api) return
    try {
      const conversation = await api.createConversation()
      setConversations((current) => [conversation, ...current])
      setActiveConversationId(conversation.id)
      setIncludeStockContext(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法创建对话')
    }
  }

  const renameConversation = async (conversation: AiConversation) => {
    if (!api) return
    const title = window.prompt('输入新的对话标题', conversation.title)
    if (!title?.trim()) return
    try {
      const renamed = await api.renameConversation(conversation.id, title)
      setConversations((current) => current.map((item) => item.id === renamed.id ? renamed : item))
      setActiveConversation((current) => current?.id === renamed.id ? renamed : current)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法重命名对话')
    }
  }

  const deleteConversation = async (conversation: AiConversation) => {
    if (!api || !window.confirm(`删除“${conversation.title}”及其全部本地消息？`)) return
    try {
      await api.deleteConversation(conversation.id)
      await loadConversations(search)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法删除对话')
    }
  }

  const clearConversations = async () => {
    if (!api || !window.confirm('清空全部 AI 本地对话及消息？此操作无法恢复。')) return
    try {
      await api.clearConversations()
      setConversations([])
      setActiveConversationId(null)
      setActiveConversation(null)
      setMessages([])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法清空对话')
    }
  }

  const sendMessage = async () => {
    if (!api || !activeConversation || !composer.trim()) return
    const content = composer.trim()
    setComposer('')
    try {
      const result = await api.sendChat({
        conversationId: activeConversation.id,
        content,
        includeStockContext
      })
      setMessages((current) => [...current, result.userMessage, result.assistantMessage])
      await loadConversations(search)
    } catch (reason) {
      setComposer(content)
      setError(reason instanceof Error ? reason.message : '消息发送失败')
    }
  }

  const retryMessage = async (messageId: string) => {
    if (!api || !activeConversation) return
    try {
      const result = await api.retryChat(activeConversation.id, messageId)
      setMessages((current) => [...current, result.userMessage, result.assistantMessage])
      await loadConversations(search)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法重试')
    }
  }

  const saveSettings = async (nextSettings: AiSettings) => {
    if (!api) return
    setBusy(true)
    try {
      const saved = await api.saveSettings(nextSettings)
      setSettings(saved)
      setStatus(await api.getStatus())
      window.dispatchEvent(new CustomEvent('ai:enabled-changed', { detail: saved.enabled }))
      if (!saved.enabled) setActiveTab('settings')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法保存 AI 设置')
    } finally {
      setBusy(false)
    }
  }

  const saveCredential = async (providerId: AiProviderId, key: string) => {
    if (!api) return
    setBusy(true)
    try {
      await api.setCredential(providerId, key)
      setStatus(await api.getStatus())
      setConnectionResult({ ok: true, kind: 'success', message: 'API Key 已安全保存' })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法保存 API Key')
    } finally {
      setBusy(false)
    }
  }

  const clearCredential = async (providerId: AiProviderId) => {
    if (!api || !window.confirm('清除当前 Provider 的 API Key？')) return
    setBusy(true)
    try {
      await api.clearCredential(providerId)
      setStatus(await api.getStatus())
      setConnectionResult(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法清除 API Key')
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async (providerId: AiProviderId) => {
    if (!api) return
    setBusy(true)
    try {
      setConnectionResult(await api.testConnection(providerId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '连接测试失败')
    } finally {
      setBusy(false)
    }
  }

  const exportConversation = async () => {
    if (!api || !activeConversation) return
    try {
      const exported = await api.exportConversation(activeConversation.id)
      downloadJson(`见涨-AI对话-${activeConversation.title}.json`, exported)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法导出对话')
    }
  }

  const exportAllConversations = async () => {
    if (!api) return
    try {
      const exported = await api.exportAllConversations()
      downloadJson('见涨-AI全部对话.json', { conversations: exported, exportedAt: new Date().toISOString() })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法导出全部对话')
    }
  }

  if (!open || !api) return null
  return (
    <div className="ai-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="ai-assistant-drawer" role="dialog" aria-modal="true" aria-label="AI 助手" onMouseDown={(event) => event.stopPropagation()}>
        <header className="ai-drawer-header">
          <div><Bot size={19} /><span><strong>AI 助手</strong><small>指标解读、要闻参考与本地对话</small></span></div>
          <nav aria-label="AI 助手页面"><button className={activeTab === 'chat' ? 'is-active' : ''} type="button" onClick={() => setActiveTab('chat')}><MessageSquare size={15} />对话</button><button className={activeTab === 'settings' ? 'is-active' : ''} type="button" onClick={() => setActiveTab('settings')}><Settings2 size={15} />服务设置</button></nav>
          <button className="icon-button ai-drawer-close" type="button" title="关闭 AI 助手" aria-label="关闭 AI 助手" onClick={onClose}><X size={18} /></button>
        </header>
        {error ? <div className="ai-drawer-error"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={() => setError('')}><X size={14} /></button></div> : null}
        {activeTab === 'chat' ? (
          <div className="ai-chat-layout">
            <ConversationList conversations={conversations} activeId={activeConversationId} search={search} onSearchChange={setSearch} onCreate={() => void createConversation()} onSelect={setActiveConversationId} onRename={(conversation) => void renameConversation(conversation)} onDelete={(conversation) => void deleteConversation(conversation)} onClear={() => void clearConversations()} onExportAll={() => void exportAllConversations()} />
            <div className="ai-chat-main">
              <ChatThread conversation={activeConversation} messages={messages} onCancel={() => activeConversation && void api.cancelChat(activeConversation.id)} onRetry={(messageId) => void retryMessage(messageId)} onExport={() => void exportConversation()} />
              {activeConversation ? (
                <footer className="ai-composer">
                  {activeConversation.scope === 'stock' ? (
                    <span className="ai-context-chip">上下文：{activeConversation.quoteName ?? activeConversation.quoteId}<button type="button" title={includeStockContext ? '移除本次消息的股票上下文' : '恢复本次消息的股票上下文'} aria-label={includeStockContext ? '移除本次消息的股票上下文' : '恢复本次消息的股票上下文'} onClick={() => setIncludeStockContext((current) => !current)}>{includeStockContext ? <X size={13} /> : <Plus size={13} />}</button></span>
                  ) : null}
                  <textarea value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} placeholder={activeConversation.scope === 'stock' && includeStockContext ? '围绕当前股票快照提问…' : '输入问题，Enter 发送，Shift + Enter 换行'} />
                  <button className="primary-button" type="button" disabled={!composer.trim()} onClick={() => void sendMessage()}><Send size={15} />发送</button>
                </footer>
              ) : null}
            </div>
          </div>
        ) : status && settings ? <AiSettingsPanel status={status} settings={settings} onSave={(nextSettings) => void saveSettings(nextSettings)} onSaveCredential={(providerId, key) => void saveCredential(providerId, key)} onClearCredential={(providerId) => void clearCredential(providerId)} onTestConnection={(providerId) => void testConnection(providerId)} busy={busy} connectionResult={connectionResult} /> : <div className="ai-loading-panel"><LoaderCircle size={20} className="is-spinning" />正在读取服务设置…</div>}
      </section>
    </div>
  )
}
