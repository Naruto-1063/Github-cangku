import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../lib/store'
import type { HistoryRecord } from '../lib/types'

type Props = {
  onClose: () => void
}

function formatTime(iso: string) {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`
}

export default function HistoryPage({ onClose }: Props) {
  const templates = useAppStore((s) => s.templates)
  const [records, setRecords] = useState<HistoryRecord[]>([])
  const [keyword, setKeyword] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    const list = await window.api.history.list()
    setRecords(list)
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase()
    if (!key) return records
    return records.filter(
      (item) =>
        item.input.toLowerCase().includes(key) ||
        item.output.toLowerCase().includes(key)
    )
  }, [records, keyword])

  const templateName = (id: string) =>
    templates.find((t) => t.id === id)?.name ?? '通用增强'

  async function copy(item: HistoryRecord) {
    await window.api.clipboard.write(item.output)
    setNotice('已复制到剪贴板')
    setTimeout(() => setNotice(''), 1600)
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <button type="button" className="back-btn" onClick={onClose} title="返回">
          ←
        </button>
        <span className="panel-title">历史记录</span>
        <span className="muted">共 {records.length} 条，全部存在本机</span>
        <div className="spacer" />
        <input
          className="control"
          style={{ width: 180 }}
          placeholder="搜索内容"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <button
          type="button"
          className="btn-ghost sm"
          onClick={async () => {
            if (!records.length) return
            if (!window.confirm('确定清空全部历史记录？此操作不可撤销。')) return
            await window.api.history.clear()
            await load()
          }}
        >
          清空
        </button>
      </header>

      <div className="panel-body">
        <div className="panel-inner">
          {notice && <div className="banner ok">{notice}</div>}

          {!filtered.length && (
            <div className="empty-state">
              {records.length ? '没有匹配的记录' : '还没有生成过内容'}
              <button type="button" className="btn-ghost sm" onClick={onClose}>
                去写一条
              </button>
            </div>
          )}

          {filtered.map((item) => (
            <article key={item.id} className="history-card">
              <div className="history-meta">
                <span className="tag">{templateName(item.templateId)}</span>
                <span className="muted">{item.model}</span>
                <span className="muted">{formatTime(item.createdAt)}</span>
                <div className="spacer" />
                <button type="button" className="text-btn" onClick={() => void copy(item)}>
                  复制结果
                </button>
                <button
                  type="button"
                  className="text-btn danger"
                  onClick={async () => {
                    await window.api.history.remove(item.id)
                    await load()
                  }}
                >
                  删除
                </button>
              </div>
              <p className="history-input">{item.input}</p>
              <pre className="history-output">{item.output}</pre>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
