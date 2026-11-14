'use strict'

/**
 * 提示词增强的「编译层」：把用户的一句话 + 模板要求，编译成发给模型的 messages。
 * 纯函数，无 IO，方便单独调试和以后换壳复用。
 *
 * 设计要点（都是踩过坑之后写死的）：
 * 1. 模型天生爱「先解释再交付」，必须用禁止清单把元话语钉死；
 * 2. 模型天生爱用 markdown 标题分节，必须明确禁止小节名与分隔线；
 * 3. 模型天生爱「替用户把事情做一遍」——这是最隐蔽的坑：一旦允许它补内容维度，
 *    它就列出病名、方法清单、章节大纲，输出变成「答案套了个请字」，用户看到的就是啰嗦。
 *    所以必须显式禁止展开内容范围。
 * 4. 只靠文字约束不稳，所以再配一层输出清洗（sanitize / 流式头部拦截）兜底。
 */

/** 篇幅带：粗需求改完的合理区间，以及相对原文的放大上限 */
const LIMITS = { min: 60, max: 180, ratio: 3 }

const BASE_SYSTEM_BODY = `你是一个提示词改写器。用户给你一句粗糙的需求，你把它改写成一段可以直接复制给另一个 AI 执行的提示词。

# 你交付什么
一段提示词正文。它会被原样粘贴到另一个对话框，交给一个看不到本次对话、不知道用户是谁的 AI 执行，所以必须自包含。

# 改写幅度（最容易做错的地方，先读这一节）
增强 = 补上用户没说、但会影响结果的那几个执行维度。
增强 ≠ 替用户把事情做一遍。
- 用户写了他要覆盖什么内容，就直接沿用他的范围，不要往下细化。他说“病因和治疗”，你就写“病因和治疗”，不要列出具体病名、方法清单、章节大纲。你一旦开始列具体内容，这段文字就变成了答案本身，而不是提示词。
- 只补用户没提到的维度，最多补 3–5 条。把每个维度都填满是错的，那会写成长篇需求文档。
- 用户已经说清楚的部分不要推翻、不要加码。可以只改一两处，但也不许一字不动地退回原文——至少要让人看出你动了哪里。

# 输出形态
1. 只有正文。第一句就是任务本身，以“请……”开头。不要任何铺垫、点评、猜测意图、确认或承诺。
2. 绝对禁止出现：
   - 对用户说的话：需求点评（“信息不够具体”“描述较为模糊”）、猜测（“我理解你是想……”“若你的真实意图是别的”）、确认（“好的”“明白了”）、承诺（“我会帮你……”）；
   - 客套：“以下是”“下面是”“希望对你有帮助”；
   - 分隔线（---、***）、代码块包裹整体、任何形式的标题（# 标题或 **加粗小节名**）；
   - 小节名：不要出现“任务目标”“角色设定”“背景与上下文”“输出格式”“约束条件”这类标签式小标题。
3. 用一段话写完。需要并列要求时，用分号串进同一个句子里，不要项目符号、不要一行一条。
4. 篇幅：原输入是一两句话的粗需求，改完 ${LIMITS.min}–${LIMITS.max} 字；原输入本身已经比较具体，就保持与之相当的长度、只做局部修补。任何情况下不超过原输入字数的 ${LIMITS.ratio} 倍。宁可短，不要长。

# 可以补的维度（按需取，不要全用）
- 交付形态：最终要什么（文档、代码、表格），什么格式（Markdown、PDF、docx）；
- 面向谁、要做到什么深度：读者水平决定用词与详略；
- 硬约束：篇幅、语言、明确不做的事；
- 质量标准：一句话说明怎样算合格，不要写成验收清单。

只有工程类任务（写代码、改程序、搭系统）才额外补：技术栈与运行环境、异常与边界情况的处理、代码组织形态、可验收的完成标准。写作、文档、翻译、分析类任务不要提验收标准和错误处理，那只是在凑字数。

# 分寸
- 用户没说但能合理推断的，直接按最主流做法定下来，不要反问、不要留空、不要写〈待补充〉这类占位符。
- 只有某个选择会显著改变结果、又确实无法推断时，才在句子里内嵌一句括注（“若未指定则默认 X”），不要为此单写一段前言。
- 不编造具体事实：不虚构数字、人名、机构名、链接。
- 使用与用户输入相同的语言。`

/**
 * 少样本范例。第一条故意选「内容型任务」，因为这是模型最容易跑偏成
 * 「先替用户写一份大纲、再给大纲套上请字」的场景，必须有个正例钉住：
 * 保留用户的范围（病因与治疗），只补读者、语气、篇幅、格式。
 */
const SAMPLES = [
  {
    input: '帮我写一份关于腰痛的病因、治疗的文档，输出为pdf文档。',
    output:
      '请撰写一份关于腰痛病因与治疗的文档，面向没有医学背景的普通读者，语言通俗、少用专业术语，篇幅精炼、重点突出、条理清晰，便于快速理解。最终输出为 PDF 文件。'
  },
  {
    input: '把这个目录下的 png 批量转成 webp，文件名不变。',
    output:
      '请把指定目录下的 PNG 图片批量转换为 WebP 格式，文件名保持不变。转换结果写回同目录、只替换扩展名；体积未下降的文件保留原图并汇总数量，遇到同名文件跳过而不是覆盖。用单个 Node 脚本实现，附一条使用命令。'
  },
  {
    input: '把下面这段话翻译成英文，术语保留原文：<原文>',
    output:
      '请把下面这段话翻译成英文，技术术语保留原文不译。保持原有的段落与编号结构，语气与原文一致。原文：<原文>'
  }
]

const CN_NUM = ['一', '二', '三', '四', '五', '六']

const SAMPLE_SECTION = SAMPLES.map(
  (s, i) => `样例${CN_NUM[i]}\n用户输入：${s.input}\n你的输出：${s.output}`
).join('\n\n')

const BASE_SYSTEM = `${BASE_SYSTEM_BODY}

# 风格样例（只示范长度与句式，不要照抄内容）
${SAMPLE_SECTION}`

const TEMPLATES = [
  {
    id: 'general',
    name: '通用增强',
    hint: '不确定选什么时就用这个',
    extra: ''
  },
  {
    id: 'coding',
    name: '写代码',
    hint: '技术实现类需求',
    extra: `若这是编程任务，用句子点到这些点（不要分节、不要列成清单）：技术栈与运行环境；必须实现的功能与明确不做的边界；异常与边界情况怎么处理；交付形态（单文件还是分模块、是否附测试）；可验收的完成标准。`
  },
  {
    id: 'writing',
    name: '文案写作',
    hint: '公众号、汇报、宣传等',
    extra: `若这是写作或文档任务，用句子点到这几点（不要分节、不要列成清单）：读者是谁、要讲到什么深度；篇幅与发布形态；语气与风格；必须回避的表达。特别提醒：不要替用户写出内容要点、章节标题或素材清单——范围由用户给，你只补执行要求。`
  },
  {
    id: 'analysis',
    name: '分析研究',
    hint: '拆解问题、做判断',
    extra: `若这是分析任务，用句子点到这几点（不要分节、不要列成清单）：要回答的核心问题及其边界；结论要什么形态（排序、对比、决策建议、风险清单）；对不确定信息如何处理。不要替用户预写分析结论、数据或论点。`
  },
  {
    id: 'translate',
    name: '翻译润色',
    hint: '中英互译、文字打磨',
    extra: `若这是语言处理任务，用句子点到这几点（不要分节、不要列成清单）：源语言与目标语言；文体与语域；术语处理原则（专有名词是否保留原文）；格式是否原样保留（段落、编号、代码块）。不要替用户翻译或改写正文。`
  },
  {
    id: 'role',
    name: '角色设定',
    hint: '让模型扮演特定角色',
    extra: `若这是角色设定任务，用句子点到这几点（不要分节、不要列成清单）：角色身份与专业背景；知识边界（不懂时如何回应）；说话风格（句长、用词、是否反问）；绝对不做的行为。注意：角色设定是正文内容的一部分，不要把它写成小节标题，也不要替角色写台词。`
  }
]

function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0]
}

function buildMessages(input, templateId) {
  const template = getTemplate(templateId)
  const system = template.extra
    ? `${BASE_SYSTEM}\n\n# 本次任务的侧重\n${template.extra}`
    : BASE_SYSTEM

  return [
    { role: 'system', content: system },
    { role: 'user', content: input.trim() }
  ]
}

// ---------------- 输出清洗（兜底，不保证命中，但能救回绝大多数跑偏） ----------------

/** 独立成行的分隔线 */
const RULE_RE = /^[ \t]*(-{3,}|\*{3,}|_{3,})[ \t]*$/gm
/** 行首的 markdown 标题 */
const HEADING_RE = /^[ \t]*#{1,6}[ \t]*(.+?)[ \t]*$/gm
/** 独立成行的加粗小节名，如 **任务目标** / **角色设定：** */
const BOLD_LABEL_RE = /^[ \t]*\*{1,2}([^*\n]{1,16})\*{1,2}[ \t]*[:：]?[ \t]*$/gm
/** 已知的小节名白名单——只删这些，避免误删正常内容 */
const LABEL_WORDS =
  /^(任务目标|任务|目标|角色设定|角色|背景与上下文|背景|上下文|输入材料|输入|具体要求|要求|约束条件|约束|输出格式|输出|质量标准|标准|注意事项|注意|执行步骤|步骤|核心要求|补充说明|小结|总结|前言|说明)$/
/** 对话式元话语（出现在开头时应当被剥掉） */
const META_HEAD_RE =
  /^(你(的|说)|这段|这句话|这个需求|该需求|用户(的|输入)|我(理解|按|们|会|先|来|建议)|好的|当然|明白|收到|以下是|下面是|需要(先)?说明|不过|首先|根据你的|从你的|稍等|注意：)/
/** 含这些词的前缀段落，几乎必然是模型在跟用户说话 */
const META_HINT_RE = /(信息量|不够具体|较为模糊|真实意图|我理解|若你的|需求描述|希望这|如需|可以帮助|我将|我会|为你|给你)/

/**
 * 清掉输出里不该出现的结构性垃圾。保守策略：只处理确定无疑的形态，
 * 不做语义推断，避免把正常的提示词正文改坏。
 */
function sanitizeOutput(raw) {
  if (!raw) return ''
  let text = raw.replace(/\r\n/g, '\n').trim()

  // 整体被代码块包裹时先拆掉
  const fenced = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/)
  if (fenced) text = fenced[1].trim()

  text = text.replace(RULE_RE, '\n')
  text = text.replace(HEADING_RE, '$1')
  text = text.replace(BOLD_LABEL_RE, (match, label) => {
    const clean = label.replace(/[:：]\s*$/, '').trim()
    return LABEL_WORDS.test(clean) ? '' : match
  })

  // 去掉开头的元话语段落
  const paragraphs = text.split(/\n{2,}/)
  while (paragraphs.length > 1) {
    const head = paragraphs[0].trim()
    if (META_HEAD_RE.test(head) && META_HINT_RE.test(head) && head.length < 300) {
      paragraphs.shift()
    } else {
      break
    }
  }
  text = paragraphs.join('\n\n')

  // 把被标题切碎的段落重新按段整理，压缩多余空行
  text = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, arr) => line !== '' || arr[index - 1] !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text
}

/**
 * 流式拦截器：模型常在开头先写一段“你的需求信息量偏少……”，
 * 如果直接推给界面，用户会先看到这段废话再被替换掉。
 * 这里把头部的可疑内容先扣住，判断清楚是不是元话语，再决定丢弃还是放行。
 */
function createHeadFilter() {
  let pending = ''
  let released = false

  // 返回可立即下发的文本；返回 '' 表示还要继续观望
  function decide() {
    // 出现分隔线：前面的基本是前言，连同分隔线一起丢掉
    const ruleIndex = pending.search(/^[ \t]*(-{3,}|\*{3,}|_{3,})[ \t]*$/m)
    if (ruleIndex >= 0) {
      const cut = pending.slice(ruleIndex)
      const after = cut.replace(/^[ \t]*(-{3,}|\*{3,}|_{3,})[ \t]*\n?/, '')
      pending = after
      if (after.trim()) return takeAll()
      return ''
    }

    // 有两个段落了，判断第一段是不是在跟用户说话
    const split = pending.indexOf('\n\n')
    if (split > 0) {
      const head = pending.slice(0, split).trim()
      if (META_HEAD_RE.test(head) && META_HINT_RE.test(head) && head.length < 300) {
        pending = pending.slice(split + 2)
        // 丢完可能还有第二段前言，继续判断
        return decide()
      }
      return takeAll()
    }

    // 观望太久就放弃拦截，避免界面长时间空白
    if (pending.length > 240) return takeAll()
    return ''
  }

  function takeAll() {
    released = true
    const out = pending
    pending = ''
    return out
  }

  return {
    push(piece) {
      if (released) return piece
      pending += piece
      return decide()
    },
    // 流结束时调用，把还扣着的内容交出来
    flush() {
      if (released) return ''
      released = true
      const out = pending
      pending = ''
      return out
    }
  }
}

/** 三秒内判断某一行是否属于结构性垃圾 */
function isJunkLine(line) {
  const t = line.trim()
  if (!t) return false
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) return true
  const label = t.match(/^\*{1,2}([^*\n]{1,16})\*{1,2}[ \t]*[:：]?$/)
  if (label && LABEL_WORDS.test(label[1].replace(/[ \t:：]+$/, '').trim())) return true
  return false
}

/**
 * 流式守卫：负责两件事
 * 1. 头部尚未判定时先扣住不下发，识别出“跟用户说话的前言”就丢掉；
 * 2. 放行之后按整行清洗，避免 --- 和 **任务目标** 这类小节名闪一下再消失。
 */
function createStreamGuard() {
  const head = createHeadFilter()
  let released = false
  let lineBuf = ''

  function feed(text, final) {
    lineBuf += text
    if (final) {
      const rest = isJunkLine(lineBuf) ? '' : lineBuf
      lineBuf = ''
      return rest
    }
    const idx = lineBuf.lastIndexOf('\n')
    if (idx < 0) return ''
    const complete = lineBuf.slice(0, idx)
    lineBuf = lineBuf.slice(idx + 1)
    return complete
      .split('\n')
      .filter((line) => !isJunkLine(line))
      .map((line) => `${line}\n`)
      .join('')
  }

  return {
    push(piece) {
      if (!released) {
        const out = head.push(piece)
        if (!out) return ''
        released = true
        return feed(out, false)
      }
      return feed(piece, false)
    },
    flush() {
      let text = ''
      if (!released) {
        text = head.flush()
        released = true
      }
      return (text ? feed(text, false) : '') + feed('', true)
    }
  }
}

module.exports = {
  LIMITS,
  SAMPLES,
  TEMPLATES,
  getTemplate,
  buildMessages,
  sanitizeOutput,
  createStreamGuard
}
