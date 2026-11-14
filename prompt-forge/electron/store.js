'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app, safeStorage } = require('electron')

/**
 * 数据目录可以是用户自定义的（设置页可改）。
 * userData 下放一个指针文件记录当前指向，指针本身固定在 userData，不跟着搬家，
 * 否则改了目录之后下次启动就找不到“当前数据在哪”了。
 *
 * 注意：密钥密文由 safeStorage 加密，其密钥材料存在 userData 里，
 * 所以只能搬我们自己这三个 json，不能搬整个 userData。
 */
const userDataDir = app.getPath('userData')
const pointerFile = path.join(userDataDir, 'location.json')
const DATA_FILES = ['settings.json', 'keys.json', 'history.json']

const HISTORY_LIMIT = 500

const DEFAULT_SETTINGS = {
  providerId: 'deepseek',
  model: 'deepseek-chat',
  temperature: 0.3,
  templateId: 'general',
  autoCopy: false,
  hotkey: 'CommandOrControl+Shift+P',
  hotkeyEnhance: 'CommandOrControl+Enter',
  hotkeyCopy: 'CommandOrControl+Shift+C',
  hotkeyClear: 'CommandOrControl+Shift+K',
  openAtLogin: false,
  customBaseUrl: '',
  customModel: '',
  // 从各家接口实际拉到的模型名，形如 { deepseek: ['deepseek-flash', ...] }
  // 有值时优先于注册表里的默认列表，这样换模型不用改代码也不用发版
  providerModels: {}
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback
    const text = fs.readFileSync(file, 'utf8')
    if (!text.trim()) return fallback
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

// ---------------- 数据目录 ----------------

function readPointer() {
  const saved = readJSON(pointerFile, null)
  const dir = saved && typeof saved.dir === 'string' ? saved.dir : ''
  // 目录被删掉或拔了移动硬盘时回落到默认位置，避免应用直接起不来
  if (dir && fs.existsSync(dir)) return dir
  return ''
}

let dataDir = readPointer() || userDataDir

function getDataDir() {
  return dataDir
}

function isCustomDataDir() {
  return path.resolve(dataDir) !== path.resolve(userDataDir)
}

/**
 * 把数据搬到新目录：先复制并校验，再写指针，最后清理旧文件。
 * 任何一步失败都保持原状，不会出现“指针指过去但数据没过去”的半截状态。
 */
function migrateDataDir(targetRaw) {
  const target = path.resolve(targetRaw || '')
  if (!targetRaw) throw new Error('未选择目录')
  if (target === path.resolve(dataDir)) {
    return { changed: false, dir: dataDir, files: 0, bytes: 0 }
  }

  fs.mkdirSync(target, { recursive: true })

  const conflicts = DATA_FILES.filter((name) => fs.existsSync(path.join(target, name)))
  if (conflicts.length) {
    throw new Error(`目标目录里已有 ${conflicts.join('、')}，请换一个空文件夹`)
  }

  // 先探一次可写，免得复制到一半才发现没权限
  const probe = path.join(target, '.prompt-forge-write-test')
  try {
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
  } catch {
    throw new Error('目标目录不可写，请换一个位置')
  }

  const copied = []
  let bytes = 0
  for (const name of DATA_FILES) {
    const src = path.join(dataDir, name)
    if (!fs.existsSync(src)) continue
    const dst = path.join(target, name)
    fs.copyFileSync(src, dst)
    const srcSize = fs.statSync(src).size
    if (fs.statSync(dst).size !== srcSize) throw new Error(`复制 ${name} 校验失败`)
    copied.push(name)
    bytes += srcSize
  }

  fs.writeFileSync(
    pointerFile,
    JSON.stringify({ dir: target, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  )

  // 旧文件改名留底，误操作还能捞回来
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const name of copied) {
    const src = path.join(dataDir, name)
    try {
      fs.renameSync(src, `${src}.bak-${stamp}`)
    } catch {
      // 备份失败不影响主流程，新目录已有完整副本
    }
  }

  dataDir = target
  return { changed: true, dir: dataDir, files: copied.length, bytes }
}

// ---------------- 设置 ----------------

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJSON(path.join(dataDir, 'settings.json'), {}) }
}

function updateSettings(patch) {
  const next = { ...getSettings(), ...patch }
  writeJSON(path.join(dataDir, 'settings.json'), next)
  return next
}

// ---------------- 密钥（系统级加密存储） ----------------

function readKeyVault() {
  return readJSON(path.join(dataDir, 'keys.json'), {})
}

function setKey(providerId, plain) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统加密服务不可用，无法安全保存密钥')
  }
  const vault = readKeyVault()
  vault[providerId] = safeStorage.encryptString(plain).toString('base64')
  writeJSON(path.join(dataDir, 'keys.json'), vault)
}

function getKey(providerId) {
  const vault = readKeyVault()
  const encoded = vault[providerId]
  if (!encoded) return ''
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  } catch {
    return ''
  }
}

function clearKey(providerId) {
  const vault = readKeyVault()
  delete vault[providerId]
  writeJSON(path.join(dataDir, 'keys.json'), vault)
}

/** 只回传掩码，密钥本身永不进渲染进程 */
function maskKey(providerId) {
  const key = getKey(providerId)
  if (!key) return ''
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}****${key.slice(-4)}`
}

// ---------------- 历史记录 ----------------

function listHistory() {
  const list = readJSON(path.join(dataDir, 'history.json'), [])
  return Array.isArray(list) ? list : []
}

function addHistory(item) {
  const list = listHistory()
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...item
  }
  list.unshift(record)
  writeJSON(path.join(dataDir, 'history.json'), list.slice(0, HISTORY_LIMIT))
  return record
}

function removeHistory(id) {
  writeJSON(
    path.join(dataDir, 'history.json'),
    listHistory().filter((item) => item.id !== id)
  )
  return true
}

function clearHistory() {
  writeJSON(path.join(dataDir, 'history.json'), [])
  return true
}

module.exports = {
  userDataDir,
  DEFAULT_SETTINGS,
  getDataDir,
  isCustomDataDir,
  migrateDataDir,
  getSettings,
  updateSettings,
  setKey,
  getKey,
  clearKey,
  maskKey,
  listHistory,
  addHistory,
  removeHistory,
  clearHistory
}
