const FORBIDDEN_ANALYSIS_PATTERNS = [
  /(?:建议|适合|应当|应该|可以|可考虑|宜)(?:立即|现在|当前|逢低|择机|短线)?(?:买入|卖出|持有|观望|建仓|加仓|减仓|清仓|布局|介入|配置|做\s*T|做多|做空|高抛低吸)/u,
  /(?:建议|值得|可重点)(?:关注|留意)/u,
  /(?:逢低|逢高)(?:买入|卖出|布局|减仓)/u,
  /(?:买入|卖出|建仓|加仓|减仓|清仓|入场|离场)(?:时机|机会|信号|建议)/u,
  /(?:当前|入场|买入|卖出)?时机(?:较好|偏差|有利|不利|合适|成熟)/u,
  /(?:未来|后续|后市|预计|预期|可能|有望|或将|将会|将).{0,16}(?:上涨|下跌|走强|走弱|偏强|偏弱|上行|下行|反弹|回落|突破|延续|反转|增长|下降|改善|恶化|修复|看涨|看跌)/u,
  /明日.{0,6}(?:上涨|下跌|反弹|回调|看涨|看跌)/u,
  /(?:短期|近期).{0,6}(?:有|存在).{0,6}(?:上涨|下跌|反弹|回调|走强|走弱)风险/u,
  /(?:上涨|下跌|上行|下行|反弹|回落|突破)(?:空间|概率|可能性)/u,
  /(?:企业质量|公司质量|股票质量|基本面评级|长期价值|投资价值|风险等级)(?:为|属于|处于|表现为|：|\s)*(?:较高|中等|中性|较低|优质|一般|较差|高|低)/u,
  /(?:利好|利空|看多|看空|高估|低估|便宜|昂贵|目标价|止盈|止损|收益承诺|(?:建议|操作|买卖)价格区间)/u,
  /(?:模型估值|模型计算值|每股模型(?:估值|计算值)|DCF(?:模型)?(?:估值|计算结果|每股值)|合理(?:股价|价格|估值)|内在价值|公允价值)\s*(?:为|约为|是|：|:)?\s*-?\d[\d,]*(?:\.\d+)?\s*元(?!\s*(?:至|到|—|-|~|～))/u
]

function collectText(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectText)
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectText)
  return []
}

export function assertObjectiveAnalysisOutput(value: unknown): void {
  const containsForbiddenText = collectText(value).some((text) => {
    const normalized = text.replace(/\s+/gu, ' ')
    return FORBIDDEN_ANALYSIS_PATTERNS.some((pattern) => pattern.test(normalized))
  })
  if (containsForbiddenText) {
    throw new Error('模型输出包含预测、评级或投资建议措辞，请重新生成')
  }
}
