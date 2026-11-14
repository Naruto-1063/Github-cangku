import http from 'node:http'

const PORT = 8787

// 故意返回“图1 那种跑偏输出”：前言 + 分隔线 + 加粗小节名
const BAD = `你的需求信息量偏少，我按“开发一个提示词增强应用”来理解并改写；若你的真实意图是别的（比如只写增强功能的提示词、或做竞品分析），请以你的实际目标为准。

---

**任务目标**
开发一个提示词增强（Prompt Enhancement）应用：用户输入一句粗糙需求，应用输出一份可直接投喂给大模型的高质量提示词。

**角色设定**
你是一名资深提示词工程师兼全栈开发者，能把模糊需求拆解为结构化、可执行的提示词。

**背景与上下文**
目标用户是不擅长写提示词的普通用户，输入往往只有一句话，缺少角色、上下文、约束、输出格式等要素。`

const GOOD = `请开发一个提示词增强应用。该应用接收用户输入的原始提示词，参考 WorkBuddy 的增强提示词方式，将其改写为更清晰、具体、可执行的版本。需实现：输入框与提交增强功能；增强结果输出区，支持一键复制；增强规则须包含明确任务目标、补充必要上下文、设定约束条件、规范输出格式；保持与用户输入相同的语言；对已清晰的提示词做轻度润色而非返回原文；避免输出未完成的列表或多余说明。界面简洁直观、适配桌面端，并给出加载与错误状态的反馈。`

const TEXT = process.env.MOCK_REPLY === 'good' ? GOOD : BAD

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404).end()
    return
  }

  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    if (req.url.includes('/bad')) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Invalid API key provided' } }))
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    // 按小块吐，模拟真实流式；每块 20ms
    const pieces = TEXT.match(/[\s\S]{1,6}/g) || []
    let i = 0
    const timer = setInterval(() => {
      if (i < pieces.length) {
        const payload = `data: ${JSON.stringify({
          choices: [{ delta: { content: pieces[i] } }]
        })}\n\n`
        // 偶尔把一个事件拆两段写出，顺带验证分片缓冲
        if (i === 3) {
          res.write(payload.slice(0, 15))
          setTimeout(() => res.write(payload.slice(15)), 8)
        } else {
          res.write(payload)
        }
        i++
      } else {
        clearInterval(timer)
        res.write('data: [DONE]\n\n')
        res.end()
      }
    }, 8)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock listening on ${PORT} (reply=${process.env.MOCK_REPLY || 'bad'})`)
})

setTimeout(() => {
  server.close()
  process.exit(0)
}, 20000)
