/**
 * 快捷键的小工具：把键盘事件转成 Electron accelerator 字符串，
 * 以及判断某个按键事件是否命中了配置里的组合。
 * 渲染进程和录制组件共用这一份规则。
 */

const MOD_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Dead'])

const KEY_ALIAS: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  Esc: 'Escape',
  Left: 'Left',
  Right: 'Right',
  Up: 'Up',
  Down: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote'
}

function normalizeKey(key: string): string {
  if (!key) return ''
  if (KEY_ALIAS[key]) return KEY_ALIAS[key]
  if (key.length === 1) return key.toUpperCase()
  return key
}

/** 把键盘事件转成 accelerator；只按了修饰键时返回空串 */
export function eventToAccelerator(event: KeyboardEvent): string {
  if (MOD_KEYS.has(event.key)) return ''
  const key = normalizeKey(event.key)
  if (!key || key === 'Escape') return ''

  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (!parts.length) return ''
  parts.push(key)
  return parts.join('+')
}

export function hasModifier(accelerator: string): boolean {
  return /(CommandOrControl|Command|Control|Alt|Shift)/.test(accelerator)
}

/** 展示用：CommandOrControl → Ctrl / Cmd */
export function formatAccelerator(accelerator: string, platform = 'win32'): string {
  if (!accelerator) return '未设置'
  const mod = platform === 'darwin' ? 'Cmd' : 'Ctrl'
  return accelerator
    .replace(/CommandOrControl/g, mod)
    .replace(/\bCommand\b/g, 'Cmd')
    .replace(/\bControl\b/g, 'Ctrl')
    .split('+')
    .map((part) => (part.length === 1 ? part.toUpperCase() : part))
    .join(' + ')
}

/** 判断事件是否命中配置的组合 */
export function matchAccelerator(event: KeyboardEvent, accelerator: string): boolean {
  if (!accelerator) return false
  const parts = accelerator.split('+').map((p) => p.trim())
  const key = parts[parts.length - 1]
  const needCtrl = parts.some((p) => /^(CommandOrControl|Command|Control)$/.test(p))
  const needAlt = parts.some((p) => p === 'Alt')
  const needShift = parts.some((p) => p === 'Shift')

  const hasCtrl = event.ctrlKey || event.metaKey
  if (needCtrl !== hasCtrl) return false
  if (needAlt !== event.altKey) return false
  if (needShift !== event.shiftKey) return false
  return normalizeKey(event.key) === key
}
