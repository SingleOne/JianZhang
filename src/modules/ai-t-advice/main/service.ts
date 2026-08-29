import type { MarketInsightSnapshot } from '../../market-insight/shared/types'
import type { AiStructuredTaskRequest, AiStructuredTaskResult } from '../../ai/shared/types'
import { calculateTBatchMetrics } from '../../../lib/t-trading'
import { getBatchTrades } from '../../../lib/trade-records'
import type { ChipDistributionCacheEntry } from '../../../shared/types'
import { AI_T_ADVICE_PROMPT_VERSION, T_ADVICE_PROMPT } from '../prompts/t-advice'
import type {
  AiTAdvice,
  AiTAdviceGenerationResult,
  AiTAdviceProgressEvent,
  AiTAdviceSettings,
  AiTAdviceStatus,
  AiTAdviceTradingContext
} from '../shared/types'
import { buildAiTAdviceObjectiveEvents } from './objective-events'
import { AiTAdviceStorage } from './storage'
import { parseAiTAdvice } from './validator'

const ORDER_BOOK_RETRY_DELAY_MS = 3_000

export interface AiTAdviceDependencies {
  refreshMarketInsightSnapshot: (quoteId: string) => Promise<MarketInsightSnapshot | null> | null
  getChipDistributionCache: (quoteId: string) => ChipDistributionCacheEntry | null
  getTradingContext: (quoteId: string) => AiTAdviceTradingContext | null
  runStructuredTask: (
    request: AiStructuredTaskRequest,
    signal: AbortSignal
  ) => Promise<AiStructuredTaskResult>
}

function now(): string {
  return new Date().toISOString()
}

function snapshotId(snapshot: MarketInsightSnapshot): string {
  return `${snapshot.quoteId}:${snapshot.generatedAt}`
}

function waitForRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('已停止生成做 T 参考'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('已停止生成做 T 参考'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ORDER_BOOK_RETRY_DELAY_MS)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function hasLiveOrderBook(snapshot: MarketInsightSnapshot): boolean {
  return (
    snapshot.sourceStates?.some((source) => source.id === 'orderBook' && source.state === 'live') ??
    false
  )
}

function buildPromptContext(
  snapshot: MarketInsightSnapshot,
  context: AiTAdviceTradingContext,
  chipDistribution: ChipDistributionCacheEntry | null
) {
  const batch = context.account?.activeBatch
  const batchTrades = getBatchTrades(context.account, batch)
  const metrics = batch ? calculateTBatchMetrics(batch, batchTrades, context.quote?.latest) : null
  const positionQuantity = context.position?.quantity ?? 0
  const sourceStates = snapshot.sourceStates ?? []
  const staleSources = sourceStates
    .filter((source) => source.state === 'stale')
    .map((source) => source.label)
  return {
    promptVersion: AI_T_ADVICE_PROMPT_VERSION,
    snapshot: {
      id: snapshotId(snapshot),
      generatedAt: snapshot.generatedAt,
      dataCutoffAt: snapshot.dataCutoffAt,
      dataState: snapshot.dataState,
      ageSeconds: Math.max(
        0,
        Math.round((Date.now() - new Date(snapshot.generatedAt).getTime()) / 1000)
      ),
      sourceStates,
      staleSources,
      objectiveEvents: buildAiTAdviceObjectiveEvents(snapshot, context),
      indicators: snapshot.indicators,
      events: snapshot.events,
      news: snapshot.news.slice(0, 8).map((item) => ({
        id: item.id,
        title: item.title,
        source: item.source,
        publishedAt: item.publishedAt,
        category: item.category
      })),
      existingTPlanDistances: snapshot.existingTPlanDistances
    },
    stock: {
      quoteId: context.stock.quoteId,
      code: context.stock.code,
      name: context.stock.name,
      marketLabel: context.stock.marketLabel
    },
    quote: context.quote
      ? {
          latest: context.quote.latest,
          previousClose: context.quote.previousClose,
          open: context.quote.open,
          high: context.quote.high,
          low: context.quote.low,
          changePercent: context.quote.changePercent,
          updatedAt: context.quote.updatedAt
        }
      : null,
    chipDistribution,
    position: context.position
      ? {
          quantity: context.position.quantity,
          cost: context.position.cost,
          openedToday: context.position.openedToday
        }
      : null,
    activeTBatch:
      batch && metrics
        ? {
            id: batch.id,
            direction: batch.direction ?? 'forward',
            openedAt: batch.openedAt,
            remainingQuantity: metrics.remainingQuantity,
            averageCost: metrics.averageCost,
            realizedProfit: metrics.realizedProfit,
            floatingProfit: metrics.floatingProfit
          }
        : null,
    maxTradableQuantity: Math.floor(positionQuantity / 100) * 100
  }
}

export class AiTAdviceService {
  private readonly activeGenerations = new Map<string, AbortController>()

  constructor(
    private readonly storage: AiTAdviceStorage,
    private readonly dependencies: AiTAdviceDependencies
  ) {}

  getStatus(): AiTAdviceStatus {
    const settings = this.storage.getSettings()
    return {
      enabled: settings.enabled,
      generatingQuoteIds: [...this.activeGenerations.keys()],
      message: settings.enabled
        ? '私用做 T 参考已启用；只会在你主动生成时调用当前 AI Provider。'
        : '私用做 T 参考已关闭，不会调用模型或显示建议。'
    }
  }

  getSettings(): AiTAdviceSettings {
    return this.storage.getSettings()
  }

  saveSettings(settings: AiTAdviceSettings): AiTAdviceSettings {
    const saved = this.storage.saveSettings({ enabled: Boolean(settings.enabled) })
    if (!saved.enabled) {
      for (const controller of this.activeGenerations.values()) controller.abort()
      this.activeGenerations.clear()
    }
    return saved
  }

  async generate(
    quoteId: string,
    onProgress: (progress: AiTAdviceProgressEvent) => void = () => undefined
  ): Promise<AiTAdviceGenerationResult> {
    if (!this.storage.getSettings().enabled) throw new Error('做 T 参考当前已关闭')
    if (this.activeGenerations.has(quoteId)) throw new Error('当前股票正在生成做 T 参考')
    const controller = new AbortController()
    this.activeGenerations.set(quoteId, controller)
    const report = (
      phase: AiTAdviceProgressEvent['phase'],
      message: string,
      detail: string,
      attempt?: number
    ) => onProgress({ quoteId, phase, message, detail, attempt, updatedAt: now() })
    try {
      report('preparing', '正在准备做 T 分析', '检查当前股票、持仓与活动 T 计划。')
      if (!this.dependencies.getTradingContext(quoteId))
        throw new Error('未找到当前股票或持仓上下文')

      let snapshot: MarketInsightSnapshot | null = null
      let attempt = 0
      while (!snapshot || !hasLiveOrderBook(snapshot)) {
        attempt += 1
        report(
          'refreshing-snapshot',
          attempt === 1 ? '正在刷新市场快照' : `正在第 ${attempt} 次刷新市场快照`,
          '同步分时、日线、资金流与最新五档盘口。',
          attempt
        )
        snapshot = await this.dependencies.refreshMarketInsightSnapshot(quoteId)
        if (!snapshot) throw new Error('当前还没有市场观察快照，请先打开市场观察并刷新')
        if (!hasLiveOrderBook(snapshot)) {
          report(
            'waiting-order-book',
            '尚未取得最新盘口，正在等待重试',
            `${Math.round(ORDER_BOOK_RETRY_DELAY_MS / 1_000)} 秒后自动重试；取得实时盘口前不会开始 AI 分析。`,
            attempt
          )
          await waitForRetry(controller.signal)
        }
      }

      const tradingContext = this.dependencies.getTradingContext(quoteId)
      if (!tradingContext) throw new Error('未找到当前股票或持仓上下文')
      if (tradingContext.quote?.latest === null || tradingContext.quote?.latest === undefined) {
        throw new Error('当前最新价不可用，暂时不能生成做 T 参考')
      }

      const promptContext = buildPromptContext(
        snapshot,
        tradingContext,
        this.dependencies.getChipDistributionCache(quoteId)
      )
      report(
        'analyzing',
        '最新盘口已获取，AI 正在分析',
        '结合市场快照、筹码分布、持仓和 T 计划生成操作参考。',
        attempt
      )
      const result = await this.dependencies.runStructuredTask(
        {
          systemPrompt: T_ADVICE_PROMPT,
          userContent: JSON.stringify(promptContext)
        },
        controller.signal
      )
      report(
        'validating',
        'AI 已返回，正在校验建议',
        '核对价格区间、股票数量、持仓约束与输出格式。',
        attempt
      )
      const generatedAt = now()
      const advice = parseAiTAdvice(result.content, {
        quoteId,
        quoteName: tradingContext.stock.name,
        snapshotId: snapshotId(snapshot),
        snapshotGeneratedAt: snapshot.generatedAt,
        snapshotDataState: snapshot.dataState,
        snapshotStaleSources: promptContext.snapshot.staleSources,
        maxTradableQuantity: promptContext.maxTradableQuantity,
        providerId: result.providerId,
        model: result.model,
        generatedAt
      })
      this.storage.saveAdvice(advice)
      return { advice }
    } finally {
      if (this.activeGenerations.get(quoteId) === controller) this.activeGenerations.delete(quoteId)
    }
  }

  cancel(quoteId: string): void {
    this.activeGenerations.get(quoteId)?.abort()
  }

  listHistory(quoteId: string): AiTAdvice[] {
    return this.storage.listHistory(quoteId)
  }

  dismiss(adviceId: string): AiTAdvice {
    const advice = this.requireAdvice(adviceId)
    const dismissed = { ...advice, status: 'dismissed' as const, resolvedAt: now() }
    return this.storage.saveAdvice(dismissed)
  }

  dispose(): void {
    for (const controller of this.activeGenerations.values()) controller.abort()
    this.activeGenerations.clear()
  }

  private requireAdvice(adviceId: string): AiTAdvice {
    const advice = this.storage.getAdvice(adviceId)
    if (!advice) throw new Error('未找到做 T 参考记录')
    return advice
  }
}
