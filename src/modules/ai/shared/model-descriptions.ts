import type { AiModelOption, AiProviderId } from './types'

// 说明文字仅取自厂商官方模型页或官方模型接口；新型号未核对前不自行推断。
// 官方资料入口：
// OpenAI: https://platform.openai.com/docs/models
// DeepSeek: https://api-docs.deepseek.com/updates/
// 智谱: https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash
// Kimi: https://platform.kimi.ai/docs/models
// MiniMax: https://platform.minimax.io/docs/guides/models-intro
// 腾讯混元: https://cloud.tencent.com/document/product/1823/130051
// 文心: https://cloud.baidu.com/doc/qianfan/s/rmh4stp0j
// 千问: https://help.aliyun.com/en/model-studio/what-is-model-studio
// MiMo: https://platform.xiaomimimo.com/docs/en-US/news/v2.5-tts-release
// Grok: https://docs.x.ai/developers/models
// Gemini: https://ai.google.dev/gemini-api/docs/models
// Anthropic: https://platform.claude.com/docs/en/models/overview
const NO_OFFICIAL_DESCRIPTION = '官方模型列表未提供描述'

function normalizeModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^models\//, '')
}

function describeOpenAi(id: string): string | undefined {
  if (/^gpt-5\.6-terra(?:-|$)/.test(id)) return '兼顾智能水平与成本的 GPT-5.6 模型。'
  if (/^gpt-5\.6-luna(?:-|$)/.test(id)) return '面向成本敏感型工作负载优化的 GPT-5.6 模型。'
  if (/^gpt-5(?:\.\d+)?-pro(?:-|$)/.test(id))
    return '使用更多计算生成更智能、更精确回答的 GPT-5 模型。'
  if (/^gpt-5\.6(?:-sol)?(?:-|$)/.test(id)) return '面向复杂专业工作的前沿模型。'
  if (/^(?:gpt-5(?:\.\d+)?|chatgpt-5)(?:-|$)/.test(id))
    return '面向编码和智能体任务、支持可配置推理强度的智能推理模型。'
  if (/^o3-pro(?:-|$)/.test(id)) return '使用更多计算的 o3 推理模型。'
  if (/^o3(?:-|$)/.test(id)) return '面向复杂任务的推理模型。'
  if (/^o4-mini(?:-|$)/.test(id)) return '快速、经济的推理模型。'
  if (/^gpt-4\.1-nano(?:-|$)/.test(id)) return 'GPT-4.1 系列中速度最快、成本最低的模型。'
  if (/^gpt-4\.1-mini(?:-|$)/.test(id)) return 'GPT-4.1 的更小、更快版本。'
  if (/^gpt-4\.1(?:-|$)/.test(id)) return '高智能非推理模型。'
  if (/^gpt-4o-mini(?:-|$)/.test(id)) return '面向专注型任务的快速、经济小型模型。'
  if (/^(?:gpt-4o|chatgpt-4o)(?:-|$)/.test(id)) return '快速、智能、灵活的 GPT 模型。'
  return undefined
}

function describeDeepSeek(id: string): string | undefined {
  if (/^deepseek-(?:v4(?:\.1)?-)?flash(?:-|$)/.test(id))
    return '最新前沿智能体编程模型，支持图片输入。'
  if (/^deepseek-v4-pro(?:-|$)/.test(id)) return '能力最强的前沿智能体编程模型。'
  return undefined
}

function describeZhipu(id: string): string | undefined {
  if (/^glm-5\.3-flash(?:-|$)/.test(id))
    return 'GLM-5 系列首个原生多模态模型，以低成本架构提供更强智能。'
  if (/^glm-5\.3(?:-|$)/.test(id))
    return '支持深度思考、结构化输出、函数调用和上下文缓存的旗舰模型。'
  if (/^glm-5\.2(?:-|$)/.test(id)) return '面向智能体与复杂任务的旗舰推理模型。'
  if (/^glm-(?:5v|4(?:\.\d+)?v)(?:-|$)/.test(id)) return '面向视觉理解与推理的多模态模型。'
  return undefined
}

function describeKimi(id: string): string | undefined {
  if (/^kimi-k3(?:-|$)/.test(id)) return 'Kimi 迄今能力最强的模型，具备原生视觉理解与 1M 上下文。'
  if (/^kimi-k2\.7-code-highspeed(?:-|$)/.test(id))
    return 'Kimi K2.7 Code 的高速版本，面向更快的编程体验。'
  if (/^kimi-k2\.7-code(?:-|$)/.test(id))
    return 'Kimi 专用编程模型，提升长上下文指令遵循与编程任务成功率。'
  if (/^kimi-k2\.6(?:-|$)/.test(id))
    return '支持视觉和文本输入、思考与非思考模式，以及对话和智能体任务。'
  if (/^(?:kimi-k2\.5|moonshot-v1-)/.test(id)) return '官方已停止维护和支持的旧版模型。'
  return undefined
}

function describeMiniMax(id: string): string | undefined {
  if (/^minimax-m3(?:-|$)/.test(id)) return '具备 1M 上下文窗口的前沿多模态编程模型。'
  if (/^minimax-m2\.7-highspeed(?:-|$)/.test(id)) return '保持 M2.7 能力并显著提升推理速度。'
  if (/^minimax-m2\.7(?:-|$)/.test(id)) return '开启递归式自我改进之旅的模型。'
  if (/^minimax-m2\.5-highspeed(?:-|$)/.test(id)) return '保持 M2.5 能力并显著提升推理速度。'
  if (/^minimax-m2\.5(?:-|$)/.test(id)) return '针对代码生成与重构优化的模型。'
  if (/^minimax-m2(?:-|$)/.test(id)) return '具备智能体、函数调用与高级推理能力的模型。'
  return undefined
}

function describeHunyuan(id: string): string | undefined {
  if (/^hy4-preview(?:-|$)/.test(id)) return '新一代生产力模型，全面升级智能体与复杂任务执行能力。'
  if (/^hy3(?:-|$)/.test(id)) return '兼具效果和性价比，强化编程、长文、推理和智能体能力。'
  if (/^hy-mt2-pro(?:-|$)/.test(id)) return '混元翻译旗舰模型，适合对译文质量要求高的专业场景。'
  if (/^hy-mt2-plus(?:-|$)/.test(id)) return '具备优秀指令遵循能力的混元翻译模型。'
  if (/^hy-mt2-lite(?:-|$)/.test(id)) return '适合高时效场景的混元轻量级翻译模型。'
  if (/^(?:hy-role|hunyuan-role)(?:-|$)/.test(id))
    return '针对聊天体验与剧情互动深度优化的角色扮演模型。'
  if (/^(?:hy-vision|hunyuan-(?:vision|t1-vision))(?:-|$)/.test(id))
    return '面向图像内容理解与推理的混元多模态模型。'
  return undefined
}

function describeErnie(id: string): string | undefined {
  if (/^ernie-5\.1(?:-|$)/.test(id))
    return '文心系列最新模型，显著提升智能体、知识、推理与深度搜索能力。'
  if (/^ernie-5\.0(?:-|$)/.test(id)) return '采用文本、图像、音频和视频统一建模的原生全模态模型。'
  if (/^ernie-4\.5-(?:turbo-)?vl(?:-|$)/.test(id)) return '面向多模态理解任务的文心模型。'
  if (/^ernie-4\.5-turbo(?:-|$)/.test(id)) return '面向多轮长对话和长文档理解问答的模型。'
  return undefined
}

function describeQwen(id: string): string | undefined {
  if (/^qwen3\.8-max(?:-|$)/.test(id))
    return '2.4 万亿参数 MoE 旗舰模型，强化编程与办公能力并原生支持视觉理解。'
  if (/^qwen[\d.]*-max(?:-|$)/.test(id)) return '千问系列性能最高的模型，适合复杂多步骤任务。'
  if (/^qwen[\d.]*-plus(?:-|$)/.test(id)) return '兼顾性能、速度与成本，适合大多数使用场景。'
  if (/^qwen[\d.]*-flash(?:-|$)/.test(id)) return '低成本、低延迟，适合需要快速响应的简单任务。'
  if (/^qwen(?:2\.5|3)-vl(?:-|$)/.test(id) || /^qwen-vl(?:-|$)/.test(id))
    return '面向图像与文本理解的千问视觉语言模型。'
  if (/^qwen(?:3)?-omni(?:-|$)/.test(id) || /^qwen3\.[5-8]-omni(?:-|$)/.test(id))
    return '支持多种输入模态的千问全模态模型。'
  if (/^qwen3\.[5-8]-(?:\d+b|\d+(?:\.\d+)?t)(?:-|$)/.test(id))
    return '千问新一代原生多模态开源模型。'
  return undefined
}

function describeMimo(id: string): string | undefined {
  if (/^mimo-v2\.5-pro(?:-|$)/.test(id)) return '增强长程推理能力、智能体效率与使用体验的旗舰模型。'
  if (/^mimo-v2\.5(?:-|$)/.test(id))
    return '原生支持多模态与 1M 上下文，进一步提升智能体和编程能力。'
  if (/^mimo-v2(?:-|$)/.test(id)) return '官方已停止维护的旧版 MiMo 模型。'
  return undefined
}

function describeGrok(id: string): string | undefined {
  if (/^grok-4\.6(?:-|$)/.test(id)) return '面向编程、智能体任务与知识工作的前沿模型。'
  if (/^grok-4(?:[.-]|$)/.test(id)) return '支持推理、工具调用与视觉输入的 Grok 旗舰模型。'
  return undefined
}

function describeGemini(id: string): string | undefined {
  if (/^gemini-3\.8-flash(?:-|$)/.test(id))
    return '面向长程软件工程、自主智能体和复杂企业工作流的高智能 Flash 模型。'
  if (/^gemini-3\.7-flash(?:-|$)/.test(id))
    return '面向复杂编程、智能体工作流与可靠多步骤执行的模型。'
  if (/^gemini-3\.6-flash(?:-|$)/.test(id)) return '兼顾速度与多模态能力的通用智能体模型。'
  if (/^gemini-3\.5-flash-lite(?:-|$)/.test(id))
    return '面向高吞吐执行、速度最快且最具成本效益的 3.5 模型。'
  if (/^gemini-3\.5-flash(?:-|$)/.test(id)) return '面向持续智能体执行与编程任务的高智能模型。'
  if (/^gemini-2\.5-flash-lite(?:-|$)/.test(id))
    return 'Gemini 2.5 系列中速度最快、最经济的多模态模型。'
  if (/^gemini-2\.5-flash(?:-|$)/.test(id)) return '适合低延迟、高吞吐推理任务的高性价比模型。'
  if (/^gemini-2\.5-pro(?:-|$)/.test(id)) return '面向复杂任务的高智能思考模型。'
  return undefined
}

function describeAnthropic(id: string): string | undefined {
  if (/^claude-fable-5(?:-|$)/.test(id)) return '面向高难度推理与长程智能体工作的模型。'
  if (/^claude-opus-5(?:-|$)/.test(id)) return '面向复杂智能体编程与企业工作的模型。'
  if (/^claude-sonnet-5(?:-|$)/.test(id)) return 'Claude 模型家族中速度与智能的最佳组合。'
  if (/^claude-haiku-4-5(?:-|$)/.test(id)) return '具备接近前沿智能水平的最快模型。'
  if (/^claude-opus-4(?:-|$)/.test(id)) return '面向高难度推理与复杂任务的高智能模型。'
  if (/^claude-sonnet-4(?:-|$)/.test(id)) return '兼顾智能水平与响应速度的高性能模型。'
  return undefined
}

export function getOfficialModelDescription(
  providerId: AiProviderId,
  model: string
): string | undefined {
  const id = normalizeModelId(model).replace(/^(?:deepseek|moonshot|kimi|qwen)\//, '')
  if (providerId === 'openai') return describeOpenAi(id)
  if (providerId === 'deepseek') return describeDeepSeek(id)
  if (providerId === 'zhipu') return describeZhipu(id)
  if (providerId === 'kimi') return describeKimi(id)
  if (providerId === 'minimax') return describeMiniMax(id)
  if (providerId === 'hunyuan') return describeHunyuan(id)
  if (providerId === 'ernie') return describeErnie(id)
  if (providerId === 'qwen') return describeQwen(id)
  if (providerId === 'mimo') return describeMimo(id)
  if (providerId === 'grok') return describeGrok(id)
  if (providerId === 'gemini') return describeGemini(id)
  if (providerId === 'anthropic') return describeAnthropic(id)
  return undefined
}

export function addOfficialModelDescriptions(
  providerId: AiProviderId,
  models: readonly AiModelOption[]
): AiModelOption[] {
  return models.map((model) => ({
    ...model,
    description:
      model.description?.trim() ||
      getOfficialModelDescription(providerId, model.id) ||
      NO_OFFICIAL_DESCRIPTION
  }))
}
