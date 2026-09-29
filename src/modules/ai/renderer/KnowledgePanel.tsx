import { useCallback, useEffect, useRef, useState } from 'react'
import { AppButton } from '../../../components/AppButton'
import { AppSelect, type AppSelectOption } from '../../../components/AppSelect'
import { useConfirmDialog } from '../../../components/ConfirmDialog'
import type { AiApi, AiConversation } from '../shared/types'
import type {
  MemoryCapabilities,
  MemoryDocument,
  MemoryDocumentProcessingJob,
  MemoryLibrary,
  MemoryStatus
} from '../shared/memory-types'

interface Props {
  api: AiApi
  conversation: AiConversation | null
  capabilities?: MemoryCapabilities
  binding?: MemoryStatus['bindings'][string]
  onBindingChange: () => Promise<void>
  onSourcesChange: () => void
}

function versionStatus(document: MemoryDocument): string {
  const latest = document.latestVersion
  if (!latest) return '尚未处理'
  if (latest.status === 'ready') return '全文与语义就绪'
  if (latest.status === 'keyword_ready') return '关键词可检索'
  if (latest.status === 'needs_ocr') return '需要 OCR，暂不可检索'
  return '向量化失败，未发布此版本'
}

const ACTIVE_JOB_STATES = new Set(['queued', 'running', 'retry_wait'])
const TERMINAL_JOB_STATES = new Set([
  'succeeded',
  'failed',
  'needs_action',
  'cancelled',
  'superseded'
])

function jobStatus(job: MemoryDocumentProcessingJob): string {
  if (job.state === 'queued') return '等待处理'
  if (job.state === 'retry_wait') return '等待自动重试'
  if (job.state === 'needs_action') return job.error?.actionHint ?? '等待处理条件恢复'
  if (job.state === 'failed') return job.error?.message ?? '处理失败'
  if (job.state === 'succeeded') return '处理完成'
  if (job.state === 'cancelled') return '处理已取消'
  if (job.state === 'superseded') return '处理结果已被更新替代'
  if (job.stage === 'parsing') return '正在解析文件'
  if (job.stage === 'embedding') return '正在生成语义索引'
  if (job.stage === 'publishing') return '正在发布处理结果'
  if (job.progress.completed !== null && job.progress.total !== null && job.progress.total > 0)
    return `正在建立索引 ${job.progress.completed} / ${job.progress.total}`
  return '正在处理'
}

export function KnowledgePanel({
  api,
  conversation,
  capabilities,
  binding,
  onBindingChange,
  onSourcesChange
}: Props) {
  const confirm = useConfirmDialog()
  const fileRef = useRef<HTMLInputElement>(null)
  const [libraries, setLibraries] = useState<MemoryLibrary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [documents, setDocuments] = useState<MemoryDocument[]>([])
  const [jobs, setJobs] = useState<MemoryDocumentProcessingJob[]>([])
  const [newName, setNewName] = useState('')
  const [rename, setRename] = useState('')
  const uploadTarget = useRef<MemoryDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const loadGeneration = useRef(0)
  const jobsRef = useRef<MemoryDocumentProcessingJob[]>([])
  const supportsJobs = capabilities?.documentJobs === true
  const loadJobsForDocuments = useCallback(
    async (items: MemoryDocument[]) => {
      if (!supportsJobs) return []
      const results = await Promise.allSettled(
        items.map((item) => api.listMemoryDocumentJobs(item.id))
      )
      return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    },
    [api, supportsJobs]
  )

  const refreshLibraries = useCallback(async () => {
    const next = await api.listMemoryLibraries()
    setLibraries(next)
    setSelectedId((current) =>
      next.some((item) => item.id === current) ? current : (next[0]?.id ?? '')
    )
  }, [api])

  useEffect(() => {
    let alive = true
    void api.listMemoryLibraries().then(
      (next) => {
        if (!alive) return
        setLibraries(next)
        setSelectedId(next[0]?.id ?? '')
      },
      (reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : '无法读取资料库')
      }
    )
    return () => {
      alive = false
    }
  }, [api])

  useEffect(() => {
    let alive = true
    const generation = ++loadGeneration.current
    setDocuments([])
    setJobs([])
    if (!selectedId) return
    void api
      .listMemoryDocuments(selectedId)
      .then(async (nextDocuments) => {
        const nextJobs = await loadJobsForDocuments(nextDocuments)
        if (!alive || generation !== loadGeneration.current) return
        setDocuments(nextDocuments)
        setJobs(nextJobs)
      })
      .catch((reason: unknown) => {
        if (alive && generation === loadGeneration.current)
          setError(reason instanceof Error ? reason.message : '无法读取资料文件')
      })
    return () => {
      alive = false
    }
  }, [api, loadJobsForDocuments, selectedId])

  useEffect(() => {
    jobsRef.current = jobs
  }, [jobs])

  const hasActiveJobs = jobs.some((item) => ACTIVE_JOB_STATES.has(item.state))
  useEffect(() => {
    if (!supportsJobs || !selectedId || !hasActiveJobs) return
    let alive = true
    let polling = false
    const generation = loadGeneration.current
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const activeJobs = jobsRef.current.filter((item) => ACTIVE_JOB_STATES.has(item.state))
        const updates = await Promise.all(
          activeJobs.map((item) => api.getMemoryDocumentJob(item.id))
        )
        if (!alive || generation !== loadGeneration.current) return
        const previous = new Map(jobsRef.current.map((item) => [item.id, item]))
        const updateIds = new Set(updates.map((item) => item.id))
        const nextJobs = [...updates, ...jobsRef.current.filter((item) => !updateIds.has(item.id))]
        const becameTerminal = updates.some((item) => {
          const old = previous.get(item.id)
          return old && !TERMINAL_JOB_STATES.has(old.state) && TERMINAL_JOB_STATES.has(item.state)
        })
        setJobs(nextJobs)
        if (becameTerminal) {
          const nextDocuments = await api.listMemoryDocuments(selectedId)
          if (!alive || generation !== loadGeneration.current) return
          setDocuments(nextDocuments)
          await refreshLibraries()
          onSourcesChange()
        }
      } catch (reason) {
        if (alive && generation === loadGeneration.current)
          setError(reason instanceof Error ? reason.message : '无法刷新资料处理任务')
      } finally {
        polling = false
      }
    }
    const timer = window.setInterval(() => void poll(), 1500)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [api, hasActiveJobs, onSourcesChange, refreshLibraries, selectedId, supportsJobs])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '资料库操作失败')
    } finally {
      setBusy(false)
    }
  }

  const selected = libraries.find((item) => item.id === selectedId)
  const options: AppSelectOption<string>[] = libraries.map((item) => ({
    value: item.id,
    label: item.name,
    description: `${item.documentCount} 份文件`
  }))
  const jobsByDocument = new Map<string, MemoryDocumentProcessingJob>()
  for (const item of jobs)
    if (!jobsByDocument.has(item.documentId)) jobsByDocument.set(item.documentId, item)
  const rememberJob = (next: MemoryDocumentProcessingJob) =>
    setJobs((current) => [next, ...current.filter((item) => item.id !== next.id)])

  const create = () =>
    void run(async () => {
      const created = await api.createMemoryLibrary(newName)
      setNewName('')
      await refreshLibraries()
      setSelectedId(created.id)
      setMessage('资料库已创建。')
    })
  const renameSelected = () =>
    void run(async () => {
      if (!selected) return
      await api.renameMemoryLibrary(selected.id, rename, selected.revision)
      setRename('')
      await refreshLibraries()
      setMessage('资料库已重命名。')
    })
  const deleteSelected = async () => {
    if (!selected) return
    if (
      !(await confirm({
        title: '删除资料库',
        message: `确定删除“${selected.name}”及其中全部文件和检索索引吗？此操作不可撤销。`,
        confirmLabel: '删除资料库',
        tone: 'danger'
      }))
    )
      return
    await run(async () => {
      await api.deleteMemoryLibrary(selected.id, selected.revision)
      setDocuments([])
      setJobs([])
      onSourcesChange()
      await Promise.all([refreshLibraries(), onBindingChange()])
      setMessage('资料库已删除。')
    })
  }
  const chooseFile = (target: MemoryDocument | null) => {
    uploadTarget.current = target
    fileRef.current?.click()
  }
  const upload = (file: File) =>
    void run(async () => {
      if (!selected) return
      if (file.size > 12 * 1024 * 1024) throw new Error('文件不能超过 12 MB')
      const bytes = await file.arrayBuffer()
      const target = uploadTarget.current
      const result = await api.uploadMemoryDocument(
        file.name,
        bytes,
        selected.id,
        target ? { id: target.id, revision: target.revision } : undefined
      )
      uploadTarget.current = null
      const nextDocuments = await api.listMemoryDocuments(selected.id)
      const nextJobs = await loadJobsForDocuments(nextDocuments)
      setDocuments(nextDocuments)
      setJobs(nextJobs)
      await refreshLibraries()
      setMessage(
        result.latestVersion?.status === 'needs_ocr'
          ? '文件已保存，但扫描 PDF 需要 OCR，暂不可检索。'
          : result.latestVersion?.status === 'embedding_failed'
            ? '文件已保存，向量化失败。可稍后按关键词模式发布此版本。'
            : '文件已导入并可检索。'
      )
    })
  const publishKeyword = (item: MemoryDocument) =>
    void run(async () => {
      if (!item.latestVersion) return
      await api.publishMemoryDocumentKeyword(item.id, item.latestVersion.id, item.revision)
      const nextDocuments = await api.listMemoryDocuments(item.libraryId)
      const nextJobs = await loadJobsForDocuments(nextDocuments)
      setDocuments(nextDocuments)
      setJobs(nextJobs)
      setMessage('已按关键词模式发布。')
    })
  const startReindex = (item: MemoryDocument) =>
    void run(async () => {
      if (!item.latestVersion) return
      const next = await api.createMemoryDocumentJob(
        item.id,
        item.latestVersion.id,
        item.revision,
        'reindex'
      )
      rememberJob(next)
      setMessage('已开始重新建立索引。关闭面板不会中止处理。')
    })
  const retryJob = (item: MemoryDocumentProcessingJob) =>
    void run(async () => {
      rememberJob(await api.retryMemoryDocumentJob(item))
      setMessage('处理任务已重新排队。')
    })
  const cancelJob = (item: MemoryDocumentProcessingJob) =>
    void run(async () => {
      rememberJob(await api.cancelMemoryDocumentJob(item))
      setMessage('处理任务已取消。')
    })
  const deleteDocument = async (item: MemoryDocument) => {
    if (
      !(await confirm({
        title: '删除资料文件',
        message: `确定删除“${item.name}”的所有版本、原文件和检索索引吗？`,
        confirmLabel: '删除文件',
        tone: 'danger'
      }))
    )
      return
    await run(async () => {
      await api.deleteMemoryDocument(item.id, item.revision)
      onSourcesChange()
      const nextDocuments = await api.listMemoryDocuments(item.libraryId)
      const nextJobs = await loadJobsForDocuments(nextDocuments)
      setDocuments(nextDocuments)
      setJobs(nextJobs)
      await refreshLibraries()
      setMessage('文件已删除。')
    })
  }
  const toggleSelected = (libraryId: string, checked: boolean) =>
    void run(async () => {
      if (!conversation) return
      const next = checked
        ? [...(binding?.libraryIds ?? []), libraryId]
        : (binding?.libraryIds ?? []).filter((item) => item !== libraryId)
      await api.setConversationMemoryLibraries(conversation.id, next)
      await onBindingChange()
    })

  return (
    <section className="ai-memory-card ai-knowledge-panel">
      <h4>资料库</h4>
      <p>文件会独立保存到记忆服务；未配置向量模型时仍可按关键词检索。</p>
      {error ? <p className="ai-memory-error">{error}</p> : null}
      {message ? <p className="ai-memory-success">{message}</p> : null}
      <div className="ai-knowledge-create">
        <input
          aria-label="新资料库名称"
          placeholder="新资料库名称"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <AppButton variant="primary" disabled={busy || !newName.trim()} onClick={create}>
          新建资料库
        </AppButton>
      </div>
      {libraries.length ? (
        <>
          <div className="ai-knowledge-toolbar">
            <AppSelect
              className="ai-settings-select ai-knowledge-select"
              value={selectedId}
              options={options}
              label="资料库"
              disabled={busy}
              onChange={setSelectedId}
            />
            <input
              aria-label="重命名资料库"
              placeholder="新名称"
              value={rename}
              onChange={(event) => setRename(event.target.value)}
            />
            <AppButton disabled={busy || !rename.trim()} onClick={renameSelected}>
              重命名
            </AppButton>
            <AppButton variant="danger" disabled={busy} onClick={() => void deleteSelected()}>
              删除库
            </AppButton>
          </div>
          {conversation && binding ? (
            <label className="ai-knowledge-session-control">
              <input
                type="checkbox"
                checked={binding.libraryIds.includes(selectedId)}
                disabled={busy || binding.pendingDelete}
                onChange={(event) => toggleSelected(selectedId, event.target.checked)}
              />
              当前会话可使用此资料库
            </label>
          ) : (
            <p>选择并启用会话记忆后，可指定该会话使用哪些资料库。</p>
          )}
          <div className="ai-knowledge-upload">
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.markdown,.pdf,.docx"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) upload(file)
              }}
            />
            <AppButton disabled={busy} onClick={() => chooseFile(null)}>
              导入文件
            </AppButton>
            <span>TXT、Markdown、文字型 PDF、DOCX；单文件不超过 12 MB。</span>
          </div>
          <ul className="ai-knowledge-documents">
            {documents.map((item) => {
              const processingJob = jobsByDocument.get(item.id)
              const processing = processingJob && ACTIVE_JOB_STATES.has(processingJob.state)
              const failedJob =
                processingJob && ['failed', 'needs_action'].includes(processingJob.state)
              return (
                <li key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <p>
                      {versionStatus(item)} · 最新版本 {item.latestVersion?.versionNo ?? 0}
                    </p>
                    <p className="ai-knowledge-active-version">
                      {item.activeVersion
                        ? `当前可检索：版本 ${item.activeVersion.versionNo}（${item.activeVersion.status === 'ready' ? '全文与语义' : '关键词'}）`
                        : '当前尚无可检索版本'}
                    </p>
                    {item.latestVersion?.error ? <p>{item.latestVersion.error}</p> : null}
                    {processingJob ? (
                      <div className="ai-knowledge-job-status">
                        <p>最新处理：{jobStatus(processingJob)}</p>
                        {processingJob.error?.message ? <p>{processingJob.error.message}</p> : null}
                        {failedJob && item.activeVersion ? (
                          <p>旧的可检索版本仍可继续使用。</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="ai-memory-item-actions">
                    {processingJob && ACTIVE_JOB_STATES.has(processingJob.state) ? (
                      <AppButton disabled={busy} onClick={() => cancelJob(processingJob)}>
                        取消处理
                      </AppButton>
                    ) : null}
                    {processingJob && ['failed', 'needs_action'].includes(processingJob.state) ? (
                      <AppButton disabled={busy} onClick={() => retryJob(processingJob)}>
                        重试
                      </AppButton>
                    ) : null}
                    {supportsJobs && item.latestVersion?.status !== 'needs_ocr' && !processing ? (
                      <AppButton disabled={busy} onClick={() => startReindex(item)}>
                        重新建立索引
                      </AppButton>
                    ) : null}
                    {item.latestVersion?.status === 'embedding_failed' ? (
                      <AppButton
                        disabled={busy || Boolean(processing)}
                        onClick={() => publishKeyword(item)}
                      >
                        按关键词发布
                      </AppButton>
                    ) : null}
                    <AppButton disabled={busy} onClick={() => chooseFile(item)}>
                      替换版本
                    </AppButton>
                    <AppButton
                      variant="danger"
                      disabled={busy}
                      onClick={() => void deleteDocument(item)}
                    >
                      删除
                    </AppButton>
                  </div>
                </li>
              )
            })}
          </ul>
          {!documents.length ? <p>此资料库暂无文件。</p> : null}
        </>
      ) : (
        <p>新建资料库后即可导入文件。</p>
      )}
    </section>
  )
}
