'use strict'

/**
 * 模型服务商注册表。
 * 全部走 OpenAI 兼容协议（POST /chat/completions + Bearer 鉴权），
 * 因此只有一份调用代码，新增厂商只需加一条配置。
 */
const PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    // deepseek-chat 是官方接口的默认档；后面两个是部分中转站用的名字，
    // 实际以「拉取模型」拿到的列表为准
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-flash', 'deepseek-v4-pro'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: '性价比高，中文表现好'
  },
  {
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'],
    keyUrl: 'https://bailian.console.aliyun.com/',
    note: '阿里云百炼，免费额度较多'
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    note: 'glm-4-flash 有免费档'
  },
  {
    id: 'moonshot',
    name: 'Kimi 月之暗面',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-latest', 'moonshot-v1-32k', 'moonshot-v1-8k'],
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    note: '长文本处理见长'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
    note: '需外网环境'
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    models: [],
    keyUrl: '',
    note: '自建服务、中转站或 Ollama 均可'
  }
]

function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || null
}

function joinUrl(baseUrl, suffix) {
  return baseUrl.replace(/\/+$/, '') + suffix
}

/**
 * 流式调用 /chat/completions。
 * 返回 Promise，增量通过 onDelta 回调吐出，避免在主进程里攒大字符串。
 */
async function streamChat(options) {
  const {
    baseUrl,
    apiKey,
    model,
    messages,
    temperature = 0.7,
    maxTokens,
    signal,
    onDelta
  } = options

  if (!baseUrl) throw new Error('未配置接口地址')
  if (!apiKey) throw new Error('未配置 API Key')
  if (!model) throw new Error('未选择模型')

  const res = await fetch(joinUrl(baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      stream: true,
      ...(maxTokens ? { max_tokens: maxTokens } : {})
    }),
    signal
  })

  if (!res.ok) {
    const raw = await res.text()
    throw new Error(explainError(res.status, raw))
  }

  if (!res.body) throw new Error('服务端未返回数据流')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let finished = false

  while (!finished) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newlineIndex
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (!line || !line.startsWith('data:')) continue

      const payload = line.slice(5).trim()
      if (payload === '[DONE]') {
        finished = true
        break
      }

      let json
      try {
        json = JSON.parse(payload)
      } catch {
        continue
      }

      if (json.error) throw new Error(json.error.message || '模型返回错误')

      const delta = json.choices && json.choices[0] && json.choices[0].delta
      const piece = delta && (delta.content || '')
      if (piece) {
        full += piece
        onDelta(piece)
      }
    }
  }

  return full
}

/**
 * 拉取服务端支持的模型名（GET /models，OpenAI 兼容接口普遍支持）。
 * 自定义接口最常见的失败原因就是模型名写错，让用户自己猜不如直接列出来。
 */
async function listModels({ baseUrl, apiKey }) {
  if (!baseUrl) throw new Error('未填写接口地址')
  if (!apiKey) throw new Error('未保存 API Key')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)

  try {
    const res = await fetch(joinUrl(baseUrl, '/models'), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    })

    if (!res.ok) {
      const raw = await res.text()
      throw new Error(explainError(res.status, raw))
    }

    const json = await res.json()
    const raw = json.data || json.models || []
    const list = raw
      .map((item) => (typeof item === 'string' ? item : item && (item.id || item.name)))
      .filter((name) => typeof name === 'string' && name.trim())
      .map((name) => name.trim())

    return Array.from(new Set(list)).sort()
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('拉取模型列表超时，请检查接口地址')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function explainError(status, raw) {
  let detail = ''
  try {
    const parsed = JSON.parse(raw)
    detail =
      (parsed.error && (parsed.error.message || parsed.error.code)) ||
      parsed.message ||
      ''
  } catch {
    detail = raw.slice(0, 300)
  }

  // 400 里绝大多数情况是模型名不被支持，单独给一条能照着做的提示
  if (status === 400 && /model/i.test(detail)) {
    return `模型名不被支持。请在设置的「模型名」里改成该接口支持的名称（可点「拉取模型」查看）：${detail}`
  }

  const hints = {
    401: 'API Key 无效或已过期，请到设置里重新填写',
    402: '账户余额不足，请到厂商后台充值',
    403: '没有访问该模型的权限，可能需要在后台开通',
    404: '接口地址或模型名不正确；若地址没有 /v1 结尾，试着补上',
    429: '请求太频繁或额度用尽，稍后再试',
    500: '模型服务端异常，稍后重试',
    503: '模型服务繁忙，稍后重试'
  }

  const hint = hints[status] || `请求失败（HTTP ${status}）`
  return detail ? `${hint}：${detail}` : hint
}

module.exports = { PROVIDERS, getProvider, streamChat, listModels }
