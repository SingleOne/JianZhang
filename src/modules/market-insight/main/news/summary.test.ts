import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pdfParse from 'pdf-parse'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketNewsItem } from '../../shared/types'
import { MarketInsightStorage } from '../storage'
import { requestBytes } from './providers/official-utils'
import { extractNewsHtmlText, MarketNewsSummaryService, type RunNewsSummaryTask } from './summary'

vi.mock('pdf-parse', () => ({ default: vi.fn() }))
vi.mock('./providers/official-utils', async (original) => {
  const actual = await original<typeof import('./providers/official-utils')>()
  return { ...actual, requestBytes: vi.fn() }
})
vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

let directory: string
const news: MarketNewsItem = {
  id: 'csrc:123456',
  title: '关于公开征求意见的通知',
  source: '中国证监会',
  url: 'https://www.csrc.gov.cn/csrc/c100028/c123456/content.shtml',
  publishedAt: '2026-10-23T08:00:00.000Z',
  fetchedAt: '2026-10-25T08:00:00.000Z',
  category: 'policy',
  scope: 'market',
  relatedQuoteIds: []
}

function document(
  text = '<body><nav>其他新闻导航</nav><main>拟修订相关规则，征求意见截止至11月20日，并非已经生效。</main></body>',
  contentType = 'text/html; charset=utf-8'
) {
  vi.mocked(requestBytes).mockResolvedValue({ bytes: new TextEncoder().encode(text), contentType })
}

function runner(content = '该通知就相关规则修订公开征求意见，截止至11月20日，尚未正式生效。') {
  return vi.fn<RunNewsSummaryTask>(async () => ({
    content: JSON.stringify({ content }),
    providerId: 'deepseek',
    model: 'test-model'
  }))
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'jianzhang-news-summary-'))
  vi.mocked(requestBytes).mockReset()
  vi.mocked(pdfParse).mockReset()
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

describe('official news AI summaries', () => {
  it('summarizes original HTML with scope and date, persists model metadata and restores after restart', async () => {
    document()
    const storage = new MarketInsightStorage(directory)
    const service = new MarketNewsSummaryService(storage)
    const run = runner()
    const summary = await service.generate(news, run)
    const context = JSON.parse(run.mock.calls[0][0].userContent)

    expect(context.excerpt).toContain('并非已经生效')
    expect(context.excerpt).not.toContain('其他新闻导航')
    expect(context).toMatchObject({ scope: 'market', publishedAt: news.publishedAt, url: news.url })
    expect(summary).toMatchObject({ newsId: news.id, model: 'test-model', providerId: 'deepseek' })
    const restored = new MarketNewsSummaryService(new MarketInsightStorage(directory))
    expect(
      restored.attach([{ ...news, fetchedAt: '2026-10-26T08:00:00.000Z' }])[0].summary
    ).toEqual(summary)
    storage.clearCache('0.000876')
    expect(storage.loadNewsSummaries()[news.id]).toEqual(summary)
  })

  it('extracts PDF announcements rather than summarizing their title', async () => {
    document('%PDF-example', 'application/pdf')
    vi.mocked(pdfParse).mockResolvedValue({
      text: '公司计划调整经营安排，具体实施仍需相关程序批准。'
    } as Awaited<ReturnType<typeof pdfParse>>)
    const run = runner()
    await new MarketNewsSummaryService(new MarketInsightStorage(directory)).generate(
      { ...news, url: 'https://static.cninfo.com.cn/finalpage/123456.PDF', source: '巨潮资讯' },
      run
    )

    expect(pdfParse).toHaveBeenCalledTimes(1)
    expect(JSON.parse(run.mock.calls[0][0].userContent).excerpt).toContain('仍需相关程序批准')
    expect(vi.mocked(requestBytes).mock.calls[0][1]?.headers).toEqual({
      Referer: 'https://www.cninfo.com.cn/'
    })
  })

  it('deduplicates simultaneous requests for the same article', async () => {
    document()
    const service = new MarketNewsSummaryService(new MarketInsightStorage(directory))
    const run = runner()
    const first = service.generate(news, run)
    const second = service.generate(news, run)

    expect(first).toBe(second)
    await Promise.all([first, second])
    expect(requestBytes).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('keeps both results when separate articles complete concurrently', async () => {
    document()
    const service = new MarketNewsSummaryService(new MarketInsightStorage(directory))
    await Promise.all([
      service.generate(news, runner()),
      service.generate({ ...news, id: 'csrc:654321', title: '另一通知' }, runner())
    ])
    expect(Object.keys(new MarketInsightStorage(directory).loadNewsSummaries()).sort()).toEqual([
      'csrc:123456',
      'csrc:654321'
    ])
  })

  it('preserves a previous summary when regeneration fails and allows retry', async () => {
    document()
    const storage = new MarketInsightStorage(directory)
    const service = new MarketNewsSummaryService(storage)
    const saved = await service.generate(news, runner())
    const fail = vi.fn<RunNewsSummaryTask>(async () => {
      throw new Error('AI 助手当前已关闭')
    })

    await expect(service.generate(news, fail)).rejects.toThrow('AI 助手当前已关闭')
    expect(storage.loadNewsSummaries()[news.id]).toEqual(saved)
    expect(service.attach([news])[0].summary).toEqual(saved)
    expect((await service.generate(news, runner('重新生成的摘要'))).content).toBe('重新生成的摘要')
  })

  it('does not send empty pages or non-official URLs to the AI model', async () => {
    document('<body><script>ignored()</script></body>')
    const service = new MarketNewsSummaryService(new MarketInsightStorage(directory))
    const run = runner()
    await expect(service.generate(news, run)).rejects.toThrow('没有提取到')
    vi.mocked(requestBytes).mockClear()
    await expect(
      service.generate({ ...news, url: 'http://www.csrc.gov.cn/article' }, run)
    ).rejects.toThrow('官方来源')
    await expect(
      service.generate({ ...news, url: 'https://example.com/article' }, run)
    ).rejects.toThrow('官方来源')
    expect(requestBytes).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects malformed AI output without saving it', async () => {
    document()
    const storage = new MarketInsightStorage(directory)
    const run = vi.fn<RunNewsSummaryTask>(async () => ({
      content: '{"content":null}',
      providerId: 'deepseek',
      model: 'test-model'
    }))
    await expect(new MarketNewsSummaryService(storage).generate(news, run)).rejects.toThrow(
      '为空或格式无效'
    )
    expect(storage.loadNewsSummaries()).toEqual({})
  })

  it('extracts complete nested official article containers without surrounding navigation', () => {
    const html =
      '<body>栏目导航<div id="UCAP-CONTENT"><div>正文第一段</div><p>正文第二段&amp;内容</p></div>其他资讯</body>'
    expect(extractNewsHtmlText(html)).toBe('正文第一段 正文第二段&内容')
  })
})
