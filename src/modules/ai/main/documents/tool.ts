import { createHash } from 'node:crypto'
import type { AiProviderTool, AiProviderToolCall, WebCitation } from '../../shared/types'
import { PdfDocumentReader, officialPdfUrl, type PdfDocument } from './pdf-reader'

const CHUNK_LENGTH = 12_000

export const PDF_DOCUMENT_TOOL: AiProviderTool = {
  name: 'read_pdf_document',
  description:
    '读取巨潮资讯、交易所或监管机构官方链接中的公告 PDF 原文，在本地提取文字并返回带页码的轻量 Markdown 和 citationId。无需 DeepSeek Key。仅使用用户或本轮工具已提供的链接，不得猜测公告地址。支持关键词定位和 cursor 分段续读；不支持扫描件 OCR，也不保证复杂表格的行列结构。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: {
      url: { type: 'string', maxLength: 8192, description: '官方 HTTPS 公告 PDF 原文链接。' },
      cursor: { type: 'integer', minimum: 0, description: '首次省略，续读使用返回的 nextCursor。' },
      keyword: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
        description: '可选关键词，从 cursor 起定位第一次命中，并提供附近原文。'
      }
    }
  }
}

export class PdfDocumentSession {
  private readonly documents = new Map<string, Promise<PdfDocument>>()
  private readonly citationsByUrl = new Map<string, WebCitation>()
  private activeReads = 0

  constructor(
    private readonly turnId: string,
    private readonly reader: PdfDocumentReader,
    private readonly onActivity: (activity: 'fetching' | 'thinking') => void
  ) {}

  citations(): WebCitation[] {
    return [...this.citationsByUrl.values()]
  }

  async execute(call: AiProviderToolCall, signal: AbortSignal): Promise<string> {
    if (call.name !== PDF_DOCUMENT_TOOL.name) throw new Error('不支持的文档工具')
    this.activeReads++
    this.onActivity('fetching')
    try {
      signal.throwIfAborted()
      const args = JSON.parse(call.arguments) as { url?: string; cursor?: number; keyword?: string }
      if (typeof args.url !== 'string') throw new Error('请提供公告 PDF 原文链接')
      const url = officialPdfUrl(args.url)
      let offset = args.cursor ?? 0
      if (!Number.isInteger(offset) || offset < 0) throw new Error('文档续读位置必须为非负整数')
      if (
        args.keyword !== undefined &&
        (typeof args.keyword !== 'string' || !args.keyword.trim() || args.keyword.length > 100)
      )
        throw new Error('关键词必须为 1～100 个字符')
      let pending = this.documents.get(url.href)
      if (!pending) {
        pending = this.reader.read(url.href, signal)
        this.documents.set(url.href, pending)
        void pending.catch(() => this.documents.delete(url.href))
      }
      const document = await pending
      signal.throwIfAborted()
      if (offset >= document.markdown.length) throw new Error('续读位置已超出文档范围')
      if (args.keyword) {
        const match = document.markdown.indexOf(args.keyword.trim(), offset)
        if (match === -1)
          return JSON.stringify({
            ok: true,
            found: false,
            title: document.title,
            url: document.url,
            totalPages: document.pages.length,
            partial: document.unreadablePages.length > 0,
            unreadablePages: document.unreadablePages,
            message: '已提取文字中未找到该关键词；未提取到文字的页面无法检索。'
          })
        offset = Math.max(offset, match - 400)
      }
      const content = document.markdown.slice(offset, offset + CHUNK_LENGTH)
      const end = offset + content.length
      const pages = document.pages.filter((page) => page.end > offset && page.start < end)
      const existing = this.citationsByUrl.get(url.href)
      const evidence = {
        hash: createHash('sha256').update(content).digest('hex'),
        start: offset,
        end,
        length: content.length
      }
      const citation: WebCitation = {
        id: existing?.id ?? `Spdf${this.turnId.slice(0, 8)}-${this.citationsByUrl.size + 1}`,
        kind: 'web',
        sourceRef: `pdf:${url.href}`,
        title: document.title,
        source: url.hostname,
        url: url.href,
        publishedAt: null,
        retrievedAt: document.retrievedAt,
        evidenceType: 'pdf',
        providedExcerpts: existing?.providedExcerpts ?? []
      }
      if (
        !citation.providedExcerpts.some(
          (item) =>
            item.hash === evidence.hash &&
            item.start === evidence.start &&
            item.end === evidence.end
        )
      )
        citation.providedExcerpts.push(evidence)
      this.citationsByUrl.set(url.href, citation)
      return JSON.stringify({
        ok: true,
        citationId: citation.id,
        title: citation.title,
        url: citation.url,
        retrievedAt: citation.retrievedAt,
        content,
        pageStart: pages[0]?.pageNumber ?? 1,
        pageEnd: pages.at(-1)?.pageNumber ?? 1,
        totalPages: document.pages.length,
        totalCharacters: document.markdown.length,
        cursor: offset,
        nextCursor: end < document.markdown.length ? end : null,
        truncated: offset > 0 || end < document.markdown.length,
        partial: document.unreadablePages.length > 0,
        unreadablePages: document.unreadablePages,
        warning: '文字提取未使用 OCR；复杂表格行列可能丢失，涉及数值、单位和年份时应核对原 PDF。'
      })
    } catch (error) {
      if (signal.aborted) throw error
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : '公告 PDF 读取失败'
      })
    } finally {
      this.activeReads--
      this.onActivity(this.activeReads > 0 ? 'fetching' : 'thinking')
    }
  }
}
