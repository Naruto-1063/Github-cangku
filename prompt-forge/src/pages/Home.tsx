import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../lib/store'
import { matchAccelerator } from '../lib/hotkeys'

type Props = {
  active: boolean
  onNavigate: (view: 'home' | 'history' | 'settings') => void
}

const SAMPLES = [
  { label: '做一个提示词增强应用', text: '帮我写一个提示词增强的应用，参考 workbuddy 的增强提示词。' },
  { label: '技术文档英译', text: '把这段技术文档翻译成英文，术语保留原文。' },
  { label: '入职欢迎邮件', text: '给新员工写一封入职欢迎邮件，语气轻松但有分寸。' },
  { label: '两个方案怎么选', text: '分析这两个方案的成本与风险，给出推荐顺序。' }
]

export default function HomePage({ active, onNavigate }: Props) {
  const config = useAppStore((s) => s.config)
  const providers = useAppStore((s) => s.providers)
  const templates = useAppStore((s) => s.templates)
  const patch = useAppStore((s) => s.patch)

  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const requestRef = useRef<string | null>(null)
  const originalRef = useRef('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const provider = providers.find((p) => p.id === config?.providerId) ?? null
  // 没配 Key 的服务商不进下拉：选了也调不通，不如等用户填完 Key 再出现
  const available = providers.filter((p) => p.hasKey)
  const needsKey = available.length === 0 || !provider?.hasKey

  const currentModel = config
    ? config.providerId === 'custom'
      ? config.customModel
      : config.model
    : ''
  const modelValue = config ? `${config.providerId}::${currentModel}` : ''

  // 当前选中的服务商被清空了 Key 时，自动切到一个还能用的，避免停在调不通的状态
  useEffect(() => {
    if (!config || !available.length) return
    if (provider?.hasKey) return
    const first = available[0]
    if (first.id === 'custom') {
      void patch({ providerId: first.id, customModel: config.customModel || first.models[0] || '' })
    } else {
      void patch({
        providerId: first.id,
        model: first.models.includes(config.model) ? config.model : first.models[0] || ''
      })
    }
  }, [config?.providerId, providers])

  useEffect(() => {
    const offChunk = window.api.onChunk(({ requestId, delta }) => {
      if (requestId !== requestRef.current) return
      setValue((prev) => prev + delta)
    })

    const offDone = window.api.onDone(({ requestId, text }) => {
      if (requestId !== requestRef.current) return
      requestRef.current = null
      setValue(text)
      setBusy(false)
      setNotice('已增强')
    })

    const offError = window.api.onError(({ requestId, error: message }) => {
      if (requestId !== requestRef.current) return
      requestRef.current = null
      setValue(originalRef.current)
      setBusy(false)
      setError(message)
    })

    return () => {
      offChunk()
      offDone()
      offError()
    }
  }, [])

  useEffect(() => {
    return window.api.onPrefill((text) => {
      setValue(text)
      setError('')
      setNotice('')
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.setSelectionRange(text.length, text.length)
      })
    })
  }, [])

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (busy || !config) return
      if (matchAccelerator(event, config.hotkeyEnhance)) {
        event.preventDefault()
        void run()
      } else if (matchAccelerator(event, config.hotkeyCopy) && value.trim()) {
        event.preventDefault()
        void copy()
      } else if (matchAccelerator(event, config.hotkeyClear) && value) {
        event.preventDefault()
        setValue('')
        setNotice('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function run() {
    if (!value.trim() || busy || !config) return

    const snapshot = value
    originalRef.current = snapshot
    setError('')
    setNotice('')
    setBusy(true)
    setValue('')

    const requestId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    requestRef.current = requestId

    const result = await window.api.enhance({
      input: snapshot,
      templateId: config.templateId,
      requestId
    })

    if (!result.ok) {
      requestRef.current = null
      setValue(snapshot)
      setBusy(false)
      setError(result.error ?? '调用失败')
    }
  }

  async function cancel() {
    if (requestRef.current) await window.api.cancelEnhance(requestRef.current)
  }

  async function copy() {
    if (!value.trim()) return
    await window.api.clipboard.write(value)
    setNotice('已复制')
    setTimeout(() => setNotice(''), 1600)
  }

  function restore() {
    if (!originalRef.current) return
    setValue(originalRef.current)
    setNotice('已还原为原始输入')
  }

  function readClipboard() {
    void window.api.clipboard.read().then((text) => {
      if (text.trim()) {
        setValue(text.slice(0, 8000))
        inputRef.current?.focus()
      }
    })
  }

  function chooseModel(raw: string) {
    if (raw === '__manage__') {
      onNavigate('settings')
      return
    }
    const [providerId, model] = raw.split('::')
    if (providerId === 'custom') {
      if (!model) {
        onNavigate('settings')
        return
      }
      void patch({ providerId, customModel: model })
      return
    }
    void patch({ providerId, model })
  }

  // 输入框随内容长高，最多到窗口的 42%，超出后内部滚动
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = Math.max(120, window.innerHeight * 0.42)
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
  }, [value])

  return (
    <div className="home">
      <div className="hero">
        <h1>提示词工坊，我帮你</h1>
        <p className="hero-sub">
          写一句粗糙的需求，我把它补全成可以直接使用的高质量提示词
        </p>
      </div>

      <div className="pill-row">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            className={`pill${config?.templateId === template.id ? ' active' : ''}`}
            title={template.hint}
            onClick={() => void patch({ templateId: template.id })}
          >
            {template.name}
          </button>
        ))}
      </div>

      {needsKey && (
        <div className="banner">
          <span>
            {available.length === 0
              ? '还没有可用的模型：到设置里填一个 API Key，填完就会出现在下面的下拉里'
              : `${provider?.name ?? '当前服务商'} 还没有配置 API Key`}
          </span>
          <button type="button" className="btn-mini" onClick={() => onNavigate('settings')}>
            去配置
          </button>
        </div>
      )}

      {error && <div className="banner error">{error}</div>}

      <div className="composer">
        <textarea
          ref={inputRef}
          className="composer-input"
          value={value}
          placeholder="例如：帮我写个 python 脚本，把这个目录下的图片批量压到 200KB 以内"
          onChange={(e) => {
            setValue(e.target.value)
            if (notice) setNotice('')
          }}
        />

        <div className="composer-bar">
          <button
            type="button"
            className="tool-btn"
            title="读取剪贴板"
            onClick={readClipboard}
          >
            +
          </button>
          <button
            type="button"
            className="tool-btn wide"
            disabled={!value}
            onClick={() => {
              setValue('')
              setNotice('')
            }}
          >
            清空
          </button>

          <div className="spacer" />

          <div className="composer-meta">{value.length} 字</div>

          <select className="model-select" value={modelValue} onChange={(e) => chooseModel(e.target.value)}>
            {available.length === 0 ? (
              <option value="">尚未添加模型</option>
            ) : (
              available.map((item) => {
                const names = item.models.length ? item.models : ['']
                // 配置里可能留着一个不在列表里的名字（比如手填过），补一条，避免下拉显示空白
                const extra =
                  config && config.providerId === item.id && !names.includes(currentModel)
                    ? [currentModel]
                    : []
                return (
                  <optgroup key={item.id} label={item.name}>
                    {[...extra, ...names].map((name) => (
                      <option key={name || '__empty__'} value={`${item.id}::${name}`}>
                        {name || '未填写模型'}
                      </option>
                    ))}
                  </optgroup>
                )
              })
            )}
            <option value="__manage__">＋ 添加或切换模型…</option>
          </select>

          {busy ? (
            <button type="button" className="send-btn stop" title="停止" onClick={() => void cancel()}>
              <span style={{ width: 10, height: 10, background: '#fff', borderRadius: 2 }} />
            </button>
          ) : (
            <button
              type="button"
              className="send-btn"
              title="增强提示词"
              disabled={!value.trim() || needsKey}
              onClick={() => void run()}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 3.6l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.6l5.1-1.9L12 3.6z"
                  fill="currentColor"
                />
                <path d="M18.6 15.4l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3z" fill="currentColor" opacity=".7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="status-strip">
        {busy ? (
          <>
            <span className="spinner" />
            <span>正在增强…</span>
            <div className="grow" />
            <button type="button" className="ghost-link" onClick={() => void cancel()}>
              停止
            </button>
          </>
        ) : (
          <>
            <span>
              {needsKey
                ? '先在设置里添加一个模型，回来就能用'
                : '结果会直接回填到输入框，可继续编辑或复制走'}
            </span>
            <div className="grow" />
            {notice && <span>{notice}</span>}
            {value && originalRef.current && value !== originalRef.current && (
              <>
                <button type="button" className="ghost-link" onClick={restore}>
                  还原原文
                </button>
                <button type="button" className="ghost-link" onClick={() => void copy()}>
                  复制结果
                </button>
              </>
            )}
          </>
        )}
      </div>

      {!value && (
        <div className="suggest">
          <span className="suggest-label">为你推荐</span>
          {SAMPLES.map((sample) => (
            <button
              key={sample.label}
              type="button"
              className="suggest-chip"
              title={sample.text}
              onClick={() => {
                setValue(sample.text)
                inputRef.current?.focus()
              }}
            >
              {sample.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
