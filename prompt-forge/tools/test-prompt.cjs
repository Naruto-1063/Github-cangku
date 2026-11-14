'use strict'

/**
 * 增强指令的自检脚本。
 * 两组回归：
 *   A. 形态：跑偏输出（前言 / 分隔线 / 小节名）必须被清洗掉；
 *   B. 幅度：指令本身必须带住「不许替用户展开内容」「有字数上限」这两条，
 *      并且 few-shot 示例不能反向教坏模型（示例里不许出现内容大纲）。
 * 运行：npm run test:prompt
 */
const {
  LIMITS,
  SAMPLES,
  TEMPLATES,
  buildMessages,
  sanitizeOutput,
  createStreamGuard
} = require('../electron/prompt.js')

const BAD = `你的需求信息量偏少，我按“开发一个提示词增强应用”来理解并改写；若你的真实意图是别的（比如只写增强功能的提示词、或做竞品分析），请以你的实际目标为准。

---

**任务目标**
开发一个提示词增强（Prompt Enhancement）应用：用户输入一句粗糙需求，应用输出一份可直接投喂给大模型的高质量提示词。

**角色设定**
你是一名资深提示词工程师兼全栈开发者，能把模糊需求拆解为结构化、可执行的提示词。

**背景与上下文**
目标用户是不擅长写提示词的普通用户，输入往往只有一句话，缺少角色、上下文、约束、输出格式等要素。`

const GOOD =
  '请撰写一份关于腰痛病因与治疗的文档，面向没有医学背景的普通读者，语言通俗、少用专业术语，篇幅精炼、重点突出、条理清晰。最终输出为 PDF 文件。'

let failed = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`)
  if (!ok) failed += 1
}

console.log('=== A. 输出清洗 ===')
const clean = sanitizeOutput(BAD)
check('去掉“你的需求信息量偏少”前言', !clean.includes('信息量'))
check('去掉 --- 分隔线', !/^\s*-{3,}\s*$/m.test(clean))
check('去掉 **任务目标** 类小节名', !clean.includes('**'))
check(
  '保留全部正文段落',
  clean.includes('开发一个提示词增强') &&
    clean.includes('资深提示词工程师') &&
    clean.includes('目标用户是不擅长')
)
console.log('\n--- 清洗后 ---\n' + clean + '\n')

check('合规输出不被改动', sanitizeOutput(GOOD) === GOOD)

const guard = createStreamGuard()
let streamed = ''
for (const ch of BAD) streamed += guard.push(ch)
streamed += guard.flush()
check('流式过程中不出现前言', !streamed.includes('信息量'))
check('流式过程不出现分隔线', !/^\s*-{3,}\s*$/m.test(streamed))
check('流式过程不出现小节名', !streamed.includes('**任务目标**'))
check(
  '流式结果与最终清洗一致',
  streamed.trim() === clean.trim(),
  JSON.stringify(streamed.slice(0, 40))
)

const g2 = createStreamGuard()
let s2 = ''
for (const ch of GOOD) s2 += g2.push(ch)
s2 += g2.flush()
check('流式守卫不误伤合规输出', s2.trim() === GOOD.trim())

const NORMAL = '请把下面这段英文翻译成中文，保持技术术语原文。原文：The scheduler retries failed jobs...'
const g3 = createStreamGuard()
let s3 = ''
for (const ch of NORMAL) s3 += g3.push(ch)
s3 += g3.flush()
check('正常指令不被头部拦截吞掉', s3.trim() === NORMAL.trim(), JSON.stringify(s3.slice(0, 20)))

console.log('\n=== B. 指令幅度 ===')
const sys = buildMessages('随便写点什么', 'general')[0].content

for (const kw of [
  '只有正文',
  '分号',
  '相同的语言',
  '最多补 3–5 条',
  '不要列出具体病名',
  '增强 ≠ 替用户把事情做一遍',
  '只改一两处',
  `${LIMITS.min}–${LIMITS.max} 字`,
  `不超过原输入字数的 ${LIMITS.ratio} 倍`
]) {
  check(`系统指令包含「${kw}」`, sys.includes(kw))
}

// 反向检查：上一版把字数放到 400，正是啰嗦的直接原因
check('不再使用 150–400 字的宽区间', !sys.includes('150–400'))
check('不再要求“信息密度优先”', !sys.includes('信息密度优先'))
check('不再无条件要求验收标准', !sys.includes('怎样算合格，出问题怎么反馈'))

console.log('\n=== C. few-shot 不能教坏模型 ===')
check('篇幅带上界收紧到 180', LIMITS.max === 180)
check('存在内容型范例（腰痛文档）', SAMPLES.some((s) => s.input.includes('腰痛')))

const contentSample = SAMPLES.find((s) => s.input.includes('腰痛'))
check(
  '内容型范例没有展开病名/大纲',
  contentSample && !/(腰肌劳损|椎间盘|骨质疏松|危险信号|手术治疗)/.test(contentSample.output)
)
check(
  '内容型范例长度落在篇幅带内',
  contentSample && contentSample.output.length <= LIMITS.max,
  `${contentSample ? contentSample.output.length : '?'} 字`
)
check(
  '内容型范例保留了用户的内容范围',
  contentSample && contentSample.output.includes('病因') && contentSample.output.includes('治疗')
)

for (const s of SAMPLES) {
  check(
    `范例输出不超过原文 ${LIMITS.ratio} 倍（${s.output.length}/${s.input.length}）`,
    s.output.length <= Math.max(LIMITS.max, s.input.length * LIMITS.ratio)
  )
}

console.log('\n=== D. 模板不再诱导内容大纲 ===')
const writing = TEMPLATES.find((t) => t.id === 'writing')
check('写作模板不再要求“必须覆盖的要点”', !writing.extra.includes('必须覆盖的要点'))
check('写作模板明确禁止写内容要点', writing.extra.includes('不要替用户写出内容要点'))
check('写作模板不提验收标准', !writing.extra.includes('验收'))
check('所有模板都不出现“列出清单”式要求', TEMPLATES.every((t) => !/：\s*-\s/.test(t.extra)))

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`)
process.exit(failed === 0 ? 0 : 1)
