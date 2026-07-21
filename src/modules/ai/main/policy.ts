const PERSONAL_T_ADVICE_PATTERN = /(做\s*T|正\s*T|反\s*T|加仓|减仓|建仓|清仓|满仓|仓位|多少股|买入|卖出).{0,24}(建议|应该|应当|现在|何时|价格|元|股|仓位|比例|多少)/i
const PERSONAL_T_ADVICE_REVERSE_PATTERN = /(建议|应该|应当|现在|何时|价格|元|股|仓位|比例|多少).{0,24}(做\s*T|正\s*T|反\s*T|加仓|减仓|建仓|清仓|满仓|仓位|买入|卖出)/i
const T_ADVICE_REQUEST_PATTERN = /(做\s*T|正\s*T|反\s*T).{0,24}(方案|操作|计划|建议|怎么|如何|可以)/i

export const GENERAL_CHAT_POLICY = `你是见涨桌面应用的 AI 助手。你可以解释指标含义、新闻背景、公开快照中的事实、计算方法和一般性知识。\n\n你不能基于用户的持仓输出具体交易动作、买卖或做 T 方向、价格、价格区间、数量、仓位、止盈、止损或现在应操作的时间点。不能把回答写入任何交易计划。遇到这类请求时，说明本模块不提供个性化做 T 参考，并转而解释可用的客观指标、新闻和不确定性。\n\n对股票快照只能说明提供的数据及其不确定性；不得编造指标、新闻、来源或实时行情。`

export function isPersonalizedTAdviceRequest(content: string): boolean {
  return PERSONAL_T_ADVICE_PATTERN.test(content)
    || PERSONAL_T_ADVICE_REVERSE_PATTERN.test(content)
    || T_ADVICE_REQUEST_PATTERN.test(content)
}

export function containsPersonalizedTAdvice(content: string): boolean {
  return isPersonalizedTAdviceRequest(content)
}

export const BLOCKED_T_ADVICE_REPLY = '当前 AI 基础模块不提供个性化做 T 方案、交易方向、价格或数量建议。你可以继续询问当前快照中的指标含义、新闻背景和客观观察事件。'
