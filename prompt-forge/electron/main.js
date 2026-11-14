'use strict'

const path = require('node:path')
const { randomUUID } = require('node:crypto')
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  clipboard,
  shell,
  nativeImage,
  Notification,
  dialog
} = require('electron')

const store = require('./store')
const { PROVIDERS, getProvider, streamChat, listModels } = require('./providers')
const { LIMITS, TEMPLATES, buildMessages, sanitizeOutput, createStreamGuard } = require('./prompt')

const isDev = process.env.NODE_ENV === 'development'
const activeRequests = new Map()
let mainWindow = null
let tray = null
let trayNoticeShown = false

// ---------------- 窗口 ----------------

function resolveIcon(name) {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(__dirname, '..', 'build', name)
  try {
    const img = nativeImage.createFromPath(base)
    return img.isEmpty() ? null : img
  } catch {
    return null
  }
}

function createWindow() {
  const icon = resolveIcon('icon.png')

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#fbfbf9',
    title: '提示词工坊',
    icon: icon || undefined,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.on('close', (event) => {
    if (app.isQuitting) return
    event.preventDefault()
    mainWindow.hide()
    if (!trayNoticeShown) {
      trayNoticeShown = true
      new Notification({
        title: '提示词工坊仍在后台运行',
        body: `按 ${formatHotkey(store.getSettings().hotkey)} 随时唤起，右键托盘图标可退出。`
      }).show()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
}

function formatHotkey(accelerator) {
  return accelerator
    .replace('CommandOrControl', process.platform === 'darwin' ? 'Cmd' : 'Ctrl')
    .replace(/\+/g, ' + ')
}

function summonWindow(prefill) {
  if (!mainWindow) createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()

  const text = prefill !== undefined ? prefill : clipboard.readText()
  const clean = (text || '').trim()
  if (clean && clean.length <= 8000) {
    mainWindow.webContents.send('shortcut:prefill', clean)
  }
}

// ---------------- 托盘与快捷键 ----------------

function buildTray() {
  const icon = resolveIcon('tray.png')
  if (!icon) return

  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('提示词工坊')

  const menu = Menu.buildFromTemplate([
    { label: '打开主窗口', click: () => summonWindow('') },
    { label: '增强剪贴板内容', click: () => summonWindow() },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: store.getSettings().openAtLogin,
      click: (item) => {
        store.updateSettings({ openAtLogin: item.checked })
        app.setLoginItemSettings({ openAtLogin: item.checked })
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(menu)
  tray.on('click', () => summonWindow(''))
}

function registerHotkey() {
  globalShortcut.unregisterAll()
  const { hotkey } = store.getSettings()
  if (!hotkey) return { ok: false, error: '未设置全局快捷键' }
  try {
    const ok = globalShortcut.register(hotkey, () => summonWindow())
    return ok ? { ok: true } : { ok: false, error: `${formatHotkey(hotkey)} 已被其他程序占用` }
  } catch (error) {
    return { ok: false, error: error.message || '快捷键无效' }
  }
}

// ---------------- IPC：配置与密钥 ----------------

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  dataDir: store.getDataDir(),
  defaultDataDir: store.userDataDir,
  isCustomDataDir: store.isCustomDataDir(),
  hotkey: store.getSettings().hotkey,
  hotkeyLabel: formatHotkey(store.getSettings().hotkey)
}))

ipcMain.handle('app:choose-data-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择数据存储位置',
    buttonLabel: '用这个文件夹',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || !result.filePaths.length) {
    return { ok: true, canceled: true }
  }
  try {
    const migrated = store.migrateDataDir(result.filePaths[0])
    return { ok: true, canceled: false, ...migrated }
  } catch (error) {
    return { ok: false, canceled: false, error: error.message }
  }
})

ipcMain.handle('app:open-data-dir', async () => {
  const error = await shell.openPath(store.getDataDir())
  return error ? { ok: false, error } : { ok: true }
})

ipcMain.handle('hotkey:set', (_event, { slot, accelerator }) => {
  const allowed = ['hotkey', 'hotkeyEnhance', 'hotkeyCopy', 'hotkeyClear']
  if (!allowed.includes(slot)) throw new Error('未知的快捷键位置')

  const value = typeof accelerator === 'string' ? accelerator.trim() : ''
  const previous = store.getSettings()[slot]

  // 允许清空：全局热键清空后就不再注册，应用内快捷键清空即停用
  if (!value) {
    const next = store.updateSettings({ [slot]: '' })
    if (slot === 'hotkey') globalShortcut.unregisterAll()
    return { ok: true, config: next }
  }

  if (slot === 'hotkey') {
    const next = store.updateSettings({ hotkey: value })
    const registered = registerHotkey()
    if (!registered.ok) {
      // 注册失败就回滚，避免设置里显示一个其实没生效的组合
      store.updateSettings({ hotkey: previous })
      registerHotkey()
      return { ok: false, error: registered.error, config: store.getSettings() }
    }
    return { ok: true, config: next }
  }

  const next = store.updateSettings({ [slot]: value })
  return { ok: true, config: next }
})

ipcMain.handle('config:get', () => store.getSettings())

ipcMain.handle('config:set', (_event, patch) => {
  const next = store.updateSettings(patch)
  if (patch && patch.hotkey) registerHotkey()
  if (patch && typeof patch.openAtLogin === 'boolean') {
    app.setLoginItemSettings({ openAtLogin: patch.openAtLogin })
  }
  return next
})

/**
 * 某个服务商当前可用的模型名。
 * 拉取过就用拉取结果（存在 settings.providerModels），否则用注册表里的默认值。
 * 自定义接口没有默认列表，没拉取过时只认用户手填的那一个。
 */
function resolveModels(provider, settings) {
  const stored = settings.providerModels && settings.providerModels[provider.id]
  const list = Array.isArray(stored)
    ? stored.filter((name) => typeof name === 'string' && name.trim())
    : []
  if (list.length) return list
  if (provider.id === 'custom') return settings.customModel ? [settings.customModel] : []
  return provider.models.slice()
}

ipcMain.handle('providers:list', () => {
  const settings = store.getSettings()
  return PROVIDERS.map((provider) => {
    const maskedKey = store.maskKey(provider.id)
    return {
      ...provider,
      models: resolveModels(provider, settings),
      maskedKey,
      // 没配 Key 的服务商在主界面下拉里直接不出现，避免点了才发现调不通
      hasKey: Boolean(maskedKey)
    }
  })
})

ipcMain.handle('templates:list', () => TEMPLATES)

// 拉取接口支持的模型名：模型名写错是最常见的失败原因，与其让人猜，不如列出来
ipcMain.handle('models:list', async (_event, { providerId } = {}) => {
  const provider = getProvider(providerId)
  if (!provider) return { ok: false, error: '未知的服务商' }

  const settings = store.getSettings()
  const baseUrl = provider.id === 'custom' ? settings.customBaseUrl : provider.baseUrl
  const apiKey = store.getKey(provider.id)

  try {
    const models = await listModels({ baseUrl, apiKey })
    if (!models.length) return { ok: false, error: '接口没有返回任何模型名' }

    // 拉到的列表写回配置：主界面下拉与设置页都以它为准，重启后依然有效
    const next = {
      ...settings,
      providerModels: { ...(settings.providerModels || {}), [provider.id]: models }
    }

    // 当前选中的模型不在新列表里就顺位到第一个，免得留下一个调不通的名字
    if (next.providerId === provider.id) {
      const active = provider.id === 'custom' ? next.customModel : next.model
      if (!models.includes(active)) {
        if (provider.id === 'custom') next.customModel = models[0]
        else next.model = models[0]
      }
    }

    return { ok: true, models, config: store.updateSettings(next) }
  } catch (error) {
    return { ok: false, error: error.message || '拉取失败' }
  }
})

ipcMain.handle('key:set', (_event, { providerId, key }) => {
  if (!providerId) throw new Error('缺少服务商标识')
  if (!key || !key.trim()) throw new Error('密钥不能为空')
  const provider = getProvider(providerId)
  if (!provider) throw new Error('未知的服务商')

  store.setKey(providerId, key.trim())

  const settings = store.getSettings()
  let config = settings

  // 当前选中的那家还没有 Key 时，保存完直接切过去，省掉一次手动选择
  if (!store.maskKey(settings.providerId)) {
    const models = resolveModels(provider, settings)
    const patch = { providerId }
    if (providerId === 'custom') {
      if (!settings.customModel && models[0]) patch.customModel = models[0]
    } else if (models.length) {
      patch.model = models[0]
    }
    config = store.updateSettings(patch)
  }

  return { ok: true, maskedKey: store.maskKey(providerId), config }
})

ipcMain.handle('key:clear', (_event, { providerId }) => {
  store.clearKey(providerId)

  let config = store.getSettings()
  // 清掉的正好是正在用的那家，就切到另一个还有 Key 的服务商
  if (config.providerId === providerId) {
    const fallback = PROVIDERS.find((item) => item.id !== providerId && store.maskKey(item.id))
    if (fallback) {
      const models = resolveModels(fallback, config)
      config = store.updateSettings(
        fallback.id === 'custom'
          ? { providerId: fallback.id, customModel: config.customModel || models[0] || '' }
          : { providerId: fallback.id, model: models[0] || config.model }
      )
    }
  }

  return { ok: true, config }
})

ipcMain.handle('key:test', async (_event, { providerId }) => {
  const settings = store.getSettings()
  const provider = getProvider(providerId)
  if (!provider) throw new Error('未知的服务商')

  const baseUrl =
    providerId === 'custom' ? settings.customBaseUrl : provider.baseUrl
  const available = resolveModels(provider, settings)
  // 优先测当前正在用的那个模型，没选中这家就用它的第一个可用模型
  const preferred = providerId === 'custom' ? settings.customModel : settings.model
  const model = preferred && available.includes(preferred) ? preferred : available[0] || ''
  const apiKey = store.getKey(providerId)

  if (!baseUrl) throw new Error('请先填写接口地址')
  if (!apiKey) throw new Error('请先保存 API Key')

  // 一个模型名都没有时改测 /models，至少能确认地址与 Key 是否可用
  if (!model) {
    const models = await listModels({ baseUrl, apiKey })
    return { ok: true, model: `地址与 Key 可用，该接口共 ${models.length} 个模型` }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)

  try {
    await streamChat({
      baseUrl,
      apiKey,
      model,
      messages: [{ role: 'user', content: '回复"ok"两个字符即可' }],
      temperature: 0,
      signal: controller.signal,
      onDelta: () => {}
    })
    return { ok: true, model }
  } catch (error) {
    return { ok: false, error: error.message }
  } finally {
    clearTimeout(timer)
  }
})

// ---------------- IPC：增强 ----------------

ipcMain.handle('enhance:start', async (event, payload) => {
  const { input, templateId, requestId: incomingId } = payload || {}
  if (!input || !input.trim()) return { ok: false, error: '请先输入内容' }

  const settings = store.getSettings()
  const provider = getProvider(settings.providerId)
  if (!provider) return { ok: false, error: '未选择模型服务' }

  const baseUrl =
    provider.id === 'custom' ? settings.customBaseUrl : provider.baseUrl
  const available = resolveModels(provider, settings)
  const configured = provider.id === 'custom' ? settings.customModel : settings.model
  // 配置里可能留着已经失效的模型名（比如接口改了名），优先用仍然可用的那个
  const model = configured && available.includes(configured) ? configured : available[0] || ''
  const apiKey = store.getKey(provider.id)

  if (!apiKey) {
    return { ok: false, error: `尚未配置 ${provider.name} 的 API Key` }
  }
  if (!baseUrl) {
    return { ok: false, error: '请先在设置里填写自定义接口的地址' }
  }
  if (!model) {
    return {
      ok: false,
      error: `${provider.name} 还没有可用的模型名，请在设置里点「拉取模型」选一个`
    }
  }

  const requestId = incomingId || randomUUID()
  const controller = new AbortController()
  activeRequests.set(requestId, controller)

  const timeout = setTimeout(() => controller.abort(), 90000)
  const sender = event.sender

  const finish = (channel, data) => {
    if (!sender.isDestroyed()) sender.send(channel, { requestId, ...data })
  }

  // 头部拦截：模型若在开头写“你的需求信息量偏少……”这类话，先扣住不显示
  const headFilter = createStreamGuard()

  streamChat({
    baseUrl,
    apiKey,
    model,
    messages: buildMessages(input, templateId),
    // 改写是收敛型任务，温度高了模型就会自作主张加前言、加小标题
    temperature: Math.min(settings.temperature ?? 0.3, 0.4),
    // 预算跟着输入长度走：短输入给 500 足够写 180 字，
    // 长输入放宽到 1200，免得把本来合适的长度截断成半句
    maxTokens: Math.min(1200, Math.max(500, Math.round(input.length * LIMITS.ratio * 2.5) + 200)),
    signal: controller.signal,
    onDelta: (delta) => {
      const visible = headFilter.push(delta)
      if (visible) finish('enhance:chunk', { delta: visible })
    }
  })
    .then((raw) => {
      const tail = headFilter.flush()
      if (tail) finish('enhance:chunk', { delta: tail })

      const text = sanitizeOutput(raw)
      if (!text) throw new Error('模型返回了空内容，请重试或更换模型')

      const record = store.addHistory({
        templateId,
        providerId: provider.id,
        model,
        input: input.trim(),
        output: text
      })

      if (settings.autoCopy) {
        clipboard.writeText(text)
      }

      finish('enhance:done', {
        text,
        record,
        copied: Boolean(settings.autoCopy)
      })
    })
    .catch((error) => {
      const message = controller.signal.aborted
        ? '已取消或超时'
        : error.message || '调用失败'
      finish('enhance:error', { error: message })
    })
    .finally(() => {
      clearTimeout(timeout)
      activeRequests.delete(requestId)
    })

  return { ok: true, requestId }
})

ipcMain.handle('enhance:cancel', (_event, requestId) => {
  const controller = activeRequests.get(requestId)
  if (controller) controller.abort()
  return { ok: true }
})

// ---------------- IPC：历史与杂项 ----------------

ipcMain.handle('history:list', () => store.listHistory())
ipcMain.handle('history:remove', (_event, id) => store.removeHistory(id))
ipcMain.handle('history:clear', () => store.clearHistory())

ipcMain.handle('clipboard:read', () => clipboard.readText())
ipcMain.handle('clipboard:write', (_event, text) => {
  clipboard.writeText(text || '')
  return true
})

ipcMain.handle('shell:open', (_event, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  return true
})

// ---------------- 生命周期 ----------------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => summonWindow(''))

  app.whenReady().then(() => {
    createWindow()
    buildTray()
    registerHotkey()

    app.on('activate', () => {
      if (!mainWindow) createWindow()
      else summonWindow('')
    })
  })

  app.on('window-all-closed', () => {
    // 常驻托盘，不退出
  })

  app.on('before-quit', () => {
    app.isQuitting = true
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })
}
