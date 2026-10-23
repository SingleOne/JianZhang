import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { TurnSourceRegistry } from '../citations/registry'
import { validateCitationMarkers } from '../citations/markers'
import { PdfDocumentReader, type PdfDocument } from './pdf-reader'
import { PDF_DOCUMENT_TOOL, PdfDocumentSession } from './tool'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))
vi.mock('pdf-parse', () => ({ default: vi.fn() }))

const url = 'https://static.cninfo.com.cn/finalpage/2026-10-23/report.pdf'

function document(): PdfDocument {
  const pageOne = `## 第 1 页\n\n${'公告原文'.repeat(4000)}\n\n`
  const pageTwo = '## 第 2 页\n\n风险提示：应收账款。\n\n'
  return {
    version: 1,
    url,
    title: '公告',
    retrievedAt: '2026-10-23T00:00:00.000Z',
    markdown: pageOne + pageTwo,
    pages: [
      { pageNumber: 1, start: 0, end: pageOne.length },
      { pageNumber: 2, start: pageOne.length, end: pageOne.length + pageTwo.length }
    ],
    unreadablePages: []
  }
}

function call(args: object) {
  return { id: 'call-1', name: PDF_DOCUMENT_TOOL.name, arguments: JSON.stringify(args) }
}

describe('PDF model tool', () => {
  it('returns bounded chunks, continuation and evidence for exactly the provided text', async () => {
    const reader = new PdfDocumentReader('unused')
    const source = document()
    const read = vi.spyOn(reader, 'read').mockResolvedValue(source)
    const session = new PdfDocumentSession('12345678-turn', reader, vi.fn())
    const signal = new AbortController().signal
    const first = JSON.parse(await session.execute(call({ url }), signal))
    const next = JSON.parse(await session.execute(call({ url, cursor: first.nextCursor }), signal))

    expect(first.content).toHaveLength(12_000)
    expect(first.truncated).toBe(true)
    expect(next.nextCursor).toBeNull()
    expect(first.content + next.content).toBe(source.markdown)
    expect(read).toHaveBeenCalledTimes(1)
    expect(next.citationId).toBe(first.citationId)
    const [citation] = session.citations()
    expect(citation.providedExcerpts[1]).toEqual({
      hash: createHash('sha256').update(next.content).digest('hex'),
      start: first.nextCursor,
      end: source.markdown.length,
      length: next.content.length
    })
    const registry = new TurnSourceRegistry()
    registry.registerWeb(session.citations())
    expect(
      validateCitationMarkers(`原文事实。[${first.citationId}]`, registry.registered()).citations
    ).toEqual([citation])
  })

  it('locates relevant text and reports missing pages with the result', async () => {
    const reader = new PdfDocumentReader('unused')
    vi.spyOn(reader, 'read').mockResolvedValue({ ...document(), unreadablePages: [3] })
    const session = new PdfDocumentSession('turn', reader, vi.fn())
    const result = JSON.parse(
      await session.execute(call({ url, keyword: '风险提示' }), new AbortController().signal)
    )
    expect(result.content).toContain('风险提示：应收账款')
    expect(result.pageEnd).toBe(2)
    expect(result.partial).toBe(true)
    expect(result.unreadablePages).toEqual([3])
    expect(result.warning).toContain('未使用 OCR')
  })

  it('records identical text at different positions while deduplicating the same read', async () => {
    const reader = new PdfDocumentReader('unused')
    vi.spyOn(reader, 'read').mockResolvedValue(document())
    const session = new PdfDocumentSession('turn', reader, vi.fn())
    const signal = new AbortController().signal
    await session.execute(call({ url, cursor: 100 }), signal)
    await session.execute(call({ url, cursor: 104 }), signal)
    await session.execute(call({ url, cursor: 100 }), signal)

    const excerpts = session.citations()[0].providedExcerpts
    expect(excerpts).toHaveLength(2)
    expect(excerpts[0].hash).toBe(excerpts[1].hash)
    expect(excerpts.map((item) => item.start)).toEqual([100, 104])
  })

  it('does not create a source citation for an unsuccessful keyword lookup', async () => {
    const reader = new PdfDocumentReader('unused')
    vi.spyOn(reader, 'read').mockResolvedValue(document())
    const session = new PdfDocumentSession('turn', reader, vi.fn())
    const result = JSON.parse(
      await session.execute(call({ url, keyword: '并不存在的内容' }), new AbortController().signal)
    )
    expect(result.found).toBe(false)
    expect(result.citationId).toBeUndefined()
    expect(session.citations()).toEqual([])
  })

  it('returns download errors to the model and allows a later retry', async () => {
    const reader = new PdfDocumentReader('unused')
    const read = vi
      .spyOn(reader, 'read')
      .mockRejectedValueOnce(new Error('下载失败'))
      .mockResolvedValueOnce(document())
    const activity = vi.fn()
    const session = new PdfDocumentSession('turn', reader, activity)
    const signal = new AbortController().signal
    expect(JSON.parse(await session.execute(call({ url }), signal))).toMatchObject({
      ok: false,
      error: '下载失败'
    })
    expect(JSON.parse(await session.execute(call({ url }), signal)).ok).toBe(true)
    expect(read).toHaveBeenCalledTimes(2)
    expect(activity).toHaveBeenLastCalledWith('thinking')
  })

  it('propagates chat cancellation without reading the document', async () => {
    const reader = new PdfDocumentReader('unused')
    const read = vi.spyOn(reader, 'read')
    const session = new PdfDocumentSession('turn', reader, vi.fn())
    const controller = new AbortController()
    controller.abort()
    await expect(session.execute(call({ url }), controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(read).not.toHaveBeenCalled()
  })
})
