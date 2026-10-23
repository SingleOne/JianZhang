import { net } from 'electron'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pdfParse from 'pdf-parse'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfDocumentReader, officialPdfUrl } from './pdf-reader'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))
vi.mock('pdf-parse', () => ({ default: vi.fn() }))

const url = 'https://static.cninfo.com.cn/finalpage/2026-10-23/announcement.PDF'
let directory: string

function parsedPages(texts: Array<string | null>) {
  vi.mocked(pdfParse).mockImplementation(async (_buffer, options) => {
    for (const [index, text] of texts.entries()) {
      if (text === null) continue // pdf-parse also continues when a page fails before pagerender.
      await options!.pagerender!({
        pageNumber: index + 1,
        getTextContent: async () => ({
          items: text.split('\n').map((str, line) => ({
            str,
            transform: [1, 0, 0, 1, 10, 100 - line * 14],
            width: str.length * 7
          }))
        })
      })
    }
    return {
      numpages: texts.length,
      numrender: texts.length,
      info: { Title: '公司公告' },
      metadata: null,
      version: 'default',
      text: texts.join('\n')
    }
  })
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'jianzhang-pdf-reader-'))
  vi.mocked(net.fetch).mockReset()
  vi.mocked(pdfParse).mockReset()
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('official PDF document reader', () => {
  it('keeps physical page numbers and reuses the disk cache across readers', async () => {
    parsedPages(['公告正文\n金额单位：万元 [资料1]', null, '风险提示'])
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response('%PDF-1.7 mock'))
    const signal = new AbortController().signal
    const first = await new PdfDocumentReader(directory).read(url, signal)
    const cached = await new PdfDocumentReader(directory).read(`${url}#page=3`, signal)

    expect(first.pages.map((page) => page.pageNumber)).toEqual([1, 2, 3])
    expect(first.unreadablePages).toEqual([2])
    expect(first.markdown).toContain('## 第 3 页\n\n风险提示')
    expect(first.markdown).toContain('金额单位：万元 资料1（旧轮来源）')
    expect(cached).toEqual(first)
    expect(net.fetch).toHaveBeenCalledTimes(1)
    expect(pdfParse).toHaveBeenCalledTimes(1)
    expect(net.fetch).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'manual' }))
  })

  it.each([
    'https://example.com/report.pdf',
    'http://static.cninfo.com.cn/report.pdf',
    'https://www.cninfo.com.cn.evil.example/report.pdf',
    'https://user:secret@static.cninfo.com.cn/report.pdf',
    'file:///C:/report.pdf'
  ])('rejects an unsupported URL before downloading: %s', async (value) => {
    await expect(
      new PdfDocumentReader(directory).read(value, new AbortController().signal)
    ).rejects.toThrow()
    expect(net.fetch).not.toHaveBeenCalled()
  })

  it('checks redirect targets before sending another request', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/report.pdf' } })
    )
    await expect(
      new PdfDocumentReader(directory).read(url, new AbortController().signal)
    ).rejects.toThrow('官方 HTTPS')
    expect(net.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not pass HTML error pages or oversized responses to the parser', async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(new Response('<html>请登录</html>'))
      .mockResolvedValueOnce(
        new Response('%PDF-', { headers: { 'content-length': String(33 * 1024 * 1024) } })
      )
    const reader = new PdfDocumentReader(directory)
    const signal = new AbortController().signal
    await expect(reader.read(url, signal)).rejects.toThrow('不是 PDF')
    await expect(reader.read(url, signal)).rejects.toThrow('32 MB')
    expect(pdfParse).not.toHaveBeenCalled()
  })

  it('reports scanned documents without claiming OCR succeeded', async () => {
    parsedPages(['', null])
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response('%PDF-1.7 mock'))
    await expect(
      new PdfDocumentReader(directory).read(url, new AbortController().signal)
    ).rejects.toThrow('不支持 OCR')
  })

  it('stops before network access when the chat was cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      new PdfDocumentReader(directory).read(url, controller.signal)
    ).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(net.fetch).not.toHaveBeenCalled()
    expect(officialPdfUrl(`${url}#page=3`).href).toBe(url)
  })
})
