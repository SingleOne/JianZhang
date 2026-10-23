import { net } from 'electron'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import pdfParse from 'pdf-parse'
import { atomicWriteJsonSync } from '../../../../../electron/main/file-storage'
import { BROWSER_USER_AGENT } from '../../../../../electron/main/http-user-agent'
import { SEC_DOCUMENT_HEADERS } from '../../../../../electron/main/sec-edgar-client'
import { neutralizeHistoricalCitationMarkers } from '../citations/markers'
import { isOfficialStockSourceUrl } from '../official-source'
import { webPageUrl } from '../web-search/sources'

const MAX_PDF_BYTES = 32 * 1024 * 1024
const MAX_TEXT_LENGTH = 2_000_000
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000

export interface PdfDocument {
  version: 1
  url: string
  title: string
  retrievedAt: string
  markdown: string
  pages: Array<{ pageNumber: number; start: number; end: number }>
  unreadablePages: number[]
}

interface PdfTextPage {
  pageNumber: number
  getTextContent: (options: object) => Promise<{
    items: Array<{ str: string; transform: number[]; width: number }>
  }>
}

export function officialPdfUrl(value: string): URL {
  const url = webPageUrl(value)
  if (!isOfficialStockSourceUrl(url.href))
    throw new Error('PDF 读取仅支持巨潮资讯、交易所和监管机构的官方 HTTPS 链接')
  url.hash = ''
  return url
}

function cleanText(text: string): string {
  return neutralizeHistoricalCitationMarkers(text)
    .replaceAll('\u0000', '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export class PdfDocumentReader {
  private readonly cacheDirectory: string

  constructor(cacheDirectory: string) {
    this.cacheDirectory = join(cacheDirectory, 'pdf-documents')
  }

  async read(value: string, signal: AbortSignal): Promise<PdfDocument> {
    signal.throwIfAborted()
    const url = officialPdfUrl(value)
    const cachePath = join(
      this.cacheDirectory,
      `${createHash('sha256').update(url.href).digest('hex')}.json`
    )
    let cached: PdfDocument | undefined
    try {
      cached = JSON.parse(await readFile(cachePath, 'utf8')) as PdfDocument
    } catch {
      // Missing or unreadable cache entries are regenerated from the official document.
    }
    signal.throwIfAborted()
    if (
      cached?.version === 1 &&
      cached.url === url.href &&
      typeof cached.markdown === 'string' &&
      Array.isArray(cached.pages) &&
      Array.isArray(cached.unreadablePages) &&
      Date.now() - Date.parse(cached.retrievedAt) < CACHE_MAX_AGE
    )
      return cached

    const buffer = await this.download(url, signal)
    signal.throwIfAborted()
    const pageTexts = new Map<number, string>()
    const result = await pdfParse(buffer, {
      pagerender: async (page: PdfTextPage) => {
        signal.throwIfAborted()
        const { items } = await page.getTextContent({
          normalizeWhitespace: false,
          disableCombineTextItems: false
        })
        signal.throwIfAborted()
        let text = ''
        let lastY: number | undefined
        let lastEndX = 0
        for (const item of items) {
          const x = item.transform[4]
          const y = item.transform[5]
          if (lastY !== undefined) {
            if (Math.abs(y - lastY) > 2) text += '\n'
            else if (x - lastEndX > 2) text += ' '
          }
          text += item.str
          lastY = y
          lastEndX = x + item.width
        }
        const cleaned = cleanText(text)
        pageTexts.set(page.pageNumber, cleaned)
        return cleaned
      }
    })
    signal.throwIfAborted()
    if (![...pageTexts.values()].some((text) => text.length > 0))
      throw new Error('PDF 未提取到可读文字，可能为扫描件或加密文件；当前轻量解析不支持 OCR')

    const title = cleanText(
      typeof result.info?.Title === 'string' && result.info.Title.trim()
        ? result.info.Title
        : decodeURIComponent(url.pathname.split('/').at(-1) || '公告文档')
    )
      .replace(/\n/g, ' ')
      .slice(0, 300)
    const document: PdfDocument = {
      version: 1,
      url: url.href,
      title,
      retrievedAt: new Date().toISOString(),
      markdown: `# ${title}\n\n`,
      pages: [],
      unreadablePages: []
    }
    for (let pageNumber = 1; pageNumber <= result.numpages; pageNumber++) {
      const text = pageTexts.get(pageNumber) || '（本页未提取到文字，可能为扫描页或解析失败。）'
      if (!pageTexts.get(pageNumber)) document.unreadablePages.push(pageNumber)
      const start = document.markdown.length
      document.markdown += `## 第 ${pageNumber} 页\n\n${text}\n\n`
      document.pages.push({ pageNumber, start, end: document.markdown.length })
      if (document.markdown.length > MAX_TEXT_LENGTH)
        throw new Error('PDF 提取文本超过 200 万字符，请使用较小的公告文件')
    }
    signal.throwIfAborted()
    atomicWriteJsonSync(cachePath, document)
    return document
  }

  private async download(initialUrl: URL, signal: AbortSignal): Promise<Buffer> {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)])
    let url = initialUrl
    for (let redirect = 0; redirect <= 3; redirect++) {
      requestSignal.throwIfAborted()
      const sec = url.hostname === 'www.sec.gov' || url.hostname === 'sec.gov'
      const response = await net.fetch(url.href, {
        redirect: 'manual',
        signal: requestSignal,
        headers: {
          ...(sec ? SEC_DOCUMENT_HEADERS : { 'User-Agent': BROWSER_USER_AGENT }),
          Referer: url.hostname.endsWith('cninfo.com.cn')
            ? 'https://www.cninfo.com.cn/'
            : `${url.origin}/`
        }
      })
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        await response.body?.cancel()
        url = officialPdfUrl(new URL(response.headers.get('location')!, url).href)
        continue
      }
      if (!response.ok) throw new Error(`公告 PDF 下载失败（HTTP ${response.status}）`)
      if (Number(response.headers.get('content-length')) > MAX_PDF_BYTES) {
        await response.body?.cancel()
        throw new Error('公告 PDF 超过 32 MB，无法进行轻量解析')
      }
      if (!response.body) throw new Error('公告 PDF 下载内容为空')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > MAX_PDF_BYTES) {
            await reader.cancel()
            throw new Error('公告 PDF 超过 32 MB，无法进行轻量解析')
          }
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }
      const buffer = Buffer.concat(chunks)
      if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-')))
        throw new Error('链接返回的不是 PDF 文件，请使用公告的 PDF 原文链接')
      return buffer
    }
    throw new Error('公告 PDF 重定向次数过多，请使用原文直链')
  }
}
