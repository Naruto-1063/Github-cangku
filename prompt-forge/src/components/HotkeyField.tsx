import { useEffect, useRef, useState } from 'react'
import {
  eventToAccelerator,
  formatAccelerator,
  hasModifier
} from '../lib/hotkeys'
import type { HotkeySlot } from '../lib/types'

type Props = {
  slot: HotkeySlot
  value: string
  platform: string
  onChange: (accelerator: string) => Promise<{ ok: boolean; error?: string }>
}

export default function HotkeyField({ slot, value, platform, onChange }: Props) {
  const [recording, setRecording] = useState(false)
  const [message, setMessage] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setMessage('')
  }, [value])

  useEffect(() => {
    if (!recording) return

    const onKey = async (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setRecording(false)
        setMessage('已取消')
        return
      }

      const accelerator = eventToAccelerator(event)
      if (!accelerator) {
        setMessage('再按一个字母、数字或功能键')
        return
      }
      if (!hasModifier(accelerator)) {
        setMessage('需要带 Ctrl / Alt 这类修饰键')
        return
      }

      setRecording(false)
      const result = await onChange(accelerator)
      setMessage(result.ok ? '已保存' : result.error || '保存失败')
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onChange])

  return (
    <div className="hotkey-field">
      <button
        ref={buttonRef}
        type="button"
        className={`hotkey-capture${recording ? ' recording' : ''}`}
        onClick={() => {
          setRecording((prev) => !prev)
          setMessage(recording ? '' : '请按下新的组合键，Esc 取消')
        }}
      >
        {recording ? '请按下组合键…' : formatAccelerator(value, platform)}
      </button>
      {message && <span className="field-hint">{message}</span>}
      {!recording && value && (
        <button
          type="button"
          className="text-btn"
          onClick={async () => {
            const result = await onChange('')
            setMessage(result.ok ? '' : result.error || '恢复失败')
          }}
          title="清空这项快捷键"
        >
          清除
        </button>
      )}
    </div>
  )
}
