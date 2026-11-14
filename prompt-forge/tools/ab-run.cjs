'use strict'

/**
 * A/B 对照脚本：同一句输入、同一个模型、同一个 Key，只换增强指令，
 * 用来验证「改指令」带来的输出长度与形态变化。不写历史、不改配置。
 *
 * 运行：
 *   electron tools/ab-run.cjs --user-data-dir=<真实 userData>
 * 参数里的 userData 必须指向正式应用目录，否则读不到已保存的 Key。
 */
const { app } = require('electron')
const path = require('node:path')

const INPUT = process.argv.find((a) => a.startsWith('--input='))?.slice(8)
  || '帮我写一份关于腰痛的病因、治疗的文档，输出为pdf文档。'

let failed = 0
function line(name, value) {
  console.log(`\n${'='.repeat(64)}\n${name}\n${'='.repeat(64)}`)
  console.log(value)
}

app.whenReady().then(async () => {
  try {
    const store = require('../electron/store')
    const { streamChat } = require('../electron/providers')
    const { getProvider } = require('../electron/providers')
    const next = require('../electron/prompt')
    const prev = require('./prompt-baseline.cjs')

    const settings = store.getSettings()
    const provider = getProvider(settings.providerId)
    const baseUrl = provider.id === 'custom' ? settings.customBaseUrl : provider.baseUrl
    const model = provider.id === 'custom' ? settings.customModel : settings.model
    const apiKey = store.getKey(provider.id)

    console.log('[ab] dataDir =', store.getDataDir())
    console.log('[ab] provider =', settings.providerId, '/', model)
    console.log('[ab] baseUrl =', baseUrl || '(空)')
    console.log('[ab] key =', apiKey ? `${apiKey.slice(0, 3)}***${apiKey.slice(-3)}（${apiKey.length} 位）` : '空')

    if (!apiKey) {
      console.error('[ab] 没有可用的 Key，无法做真实对照')
      app.exit(2)
      return
    }

    const TEMPLATE = process.argv.find((a) => a.startsWith('--template='))?.slice(11)

    const cases = TEMPLATE
      ? [
          { label: `旧指令 · ${TEMPLATE}`, mod: prev, templateId: TEMPLATE },
          { label: `新指令 · ${TEMPLATE}`, mod: next, templateId: TEMPLATE }
        ]
      : [
          { label: '旧指令 · 通用模板', mod: prev, templateId: 'general' },
          { label: '新指令 · 通用模板', mod: next, templateId: 'general' },
          { label: '新指令 · 文案写作模板', mod: next, templateId: 'writing' }
        ]

    for (const item of cases) {
      const messages = item.mod.buildMessages(INPUT, item.templateId)
      const started = Date.now()
      try {
        const text = await streamChat({
          baseUrl,
          apiKey,
          model,
          messages,
          temperature: 0.3,
          maxTokens: 1200,
          onDelta: () => {}
        })
        const body = next.sanitizeOutput(text)
        const seconds = ((Date.now() - started) / 1000).toFixed(1)
        line(`${item.label} ｜ ${body.length} 字 ｜ ${seconds}s`, body)
        if (body.length > next.LIMITS.max * 1.5) {
          console.log(`[ab] ⚠ 超出目标区间上界 ${next.LIMITS.max} 字`)
        }
      } catch (error) {
        failed += 1
        line(`${item.label} ｜ 调用失败`, error.message)
      }
    }

    console.log(`\n[ab] 完成，失败 ${failed} 项`)
    app.exit(failed ? 1 : 0)
  } catch (error) {
    console.error('[ab] 异常：', error && error.stack ? error.stack : error)
    app.exit(3)
  }
})
