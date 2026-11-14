import { useState } from 'react'
import { useAppStore } from '../lib/store'
import HotkeyField from '../components/HotkeyField'
import type { HotkeySlot, Provider } from '../lib/types'

type Props = {
  onClose: () => void
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const HOTKEY_ROWS: { slot: HotkeySlot; label: string; hint: string }[] = [
  { slot: 'hotkey', label: '全局唤起', hint: '在任何软件里按下即可唤出窗口，并读取剪贴板' },
  { slot: 'hotkeyEnhance', label: '开始增强', hint: '在输入框里直接生成，不用点按钮' },
  { slot: 'hotkeyCopy', label: '复制结果', hint: '把当前输入框里的内容复制走' },
  { slot: 'hotkeyClear', label: '清空输入', hint: '一键清掉输入框，重新开始' }
]

export default function SettingsPage({ onClose }: Props) {
  const config = useAppStore((s) => s.config)
  const providers = useAppStore((s) => s.providers)
  const info = useAppStore((s) => s.info)
  const boot = useAppStore((s) => s.boot)
  const patch = useAppStore((s) => s.patch)
  const applyConfig = useAppStore((s) => s.applyConfig)
  const reloadProviders = useAppStore((s) => s.reloadProviders)

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState<string>('')
  const [loadingModels, setLoadingModels] = useState<string>('')
  const [moving, setMoving] = useState(false)
  const [dirMessage, setDirMessage] = useState('')
  const [dirError, setDirError] = useState(false)

  if (!config) return null

  const platform = info?.platform ?? 'win32'
  const selected = providers.find((p) => p.id === config.providerId) ?? null

  function setStatusFor(id: string, text: string) {
    setStatus((prev) => ({ ...prev, [id]: text }))
  }

  /** 该服务商可选的模型名；正在用的那个若不在列表里也要列出来，否则下拉会显示空白 */
  function modelsFor(target: Provider) {
    const names = target.models.slice()
    if (target.id === 'custom') {
      if (config!.customModel && !names.includes(config!.customModel)) names.unshift(config!.customModel)
      return names
    }
    if (target.id === config!.providerId && config!.model && !names.includes(config!.model)) {
      names.unshift(config!.model)
    }
    return names
  }

  /** 下拉里应该高亮的那个：正在用的服务商用配置里的模型，其余用它的第一个 */
  function modelFor(target: Provider) {
    const names = modelsFor(target)
    if (target.id === 'custom') return config!.customModel || names[0] || ''
    if (target.id === config!.providerId && names.includes(config!.model)) return config!.model
    return names[0] || ''
  }

  function pickModel(target: Provider, name: string) {
    if (!name) return
    if (target.id === 'custom') void patch({ providerId: 'custom', customModel: name })
    else void patch({ providerId: target.id, model: name })
  }

  async function saveKey(id: string) {
    const value = (drafts[id] ?? '').trim()
    if (!value) {
      setStatusFor(id, '请先粘贴 Key')
      return
    }
    try {
      const result = await window.api.setKey(id, value)
      setDrafts((prev) => ({ ...prev, [id]: '' }))
      if (result.config) applyConfig(result.config)
      await reloadProviders()
      setStatusFor(id, '已保存到系统加密存储')
    } catch (error) {
      setStatusFor(id, error instanceof Error ? error.message : '保存失败')
    }
  }

  async function testKey(id: string) {
    setTesting(id)
    setStatusFor(id, '正在测试…')
    try {
      const result = await window.api.testKey(id)
      setStatusFor(id, result.ok ? `连接正常（${result.model}）` : `失败：${result.error}`)
    } finally {
      setTesting('')
    }
  }

  async function fetchModels(id: string) {
    setLoadingModels(id)
    setStatusFor(id, '正在拉取模型列表…')
    try {
      const result = await window.api.listModels(id)
      if (!result.ok) {
        setStatusFor(id, `拉取失败：${result.error ?? '未知错误'}`)
        return
      }
      const list = result.models ?? []
      if (result.config) applyConfig(result.config)
      await reloadProviders()
      setStatusFor(
        id,
        `已获取 ${list.length} 个模型，可在${
          id === 'custom' ? '下方胶囊里' : '左侧下拉里'
        }选一个`
      )
    } catch (error) {
      setStatusFor(id, error instanceof Error ? error.message : '拉取失败')
    } finally {
      setLoadingModels('')
    }
  }

  async function changeDataDir() {
    setMoving(true)
    setDirMessage('')
    setDirError(false)
    try {
      const result = await window.api.chooseDataDir()
      if (result.canceled) return
      if (!result.ok) {
        setDirError(true)
        setDirMessage(result.error || '迁移失败')
        return
      }
      await boot()
      setDirMessage(
        result.changed
          ? `已迁移 ${result.files} 个文件（${formatBytes(result.bytes ?? 0)}）到新位置`
          : '目录未变化'
      )
    } catch (error) {
      setDirError(true)
      setDirMessage(error instanceof Error ? error.message : '迁移失败')
    } finally {
      setMoving(false)
    }
  }

  async function setHotkey(slot: HotkeySlot, accelerator: string) {
    try {
      const result = await window.api.setHotkey(slot, accelerator)
      if (result.config) applyConfig(result.config)
      return { ok: result.ok, error: result.error }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '保存失败' }
    }
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <button type="button" className="back-btn" onClick={onClose} title="返回">
          ←
        </button>
        <span className="panel-title">设置</span>
        <span className="muted">密钥经系统加密后存在本机，只用于调用你所选的模型</span>
      </header>

      <div className="panel-body">
        <div className="panel-inner">
          <section className="card">
            <h2 className="card-title">模型服务</h2>
            <p className="card-desc">
              按需填一个即可，不必全部配置。保存 Key 后点「拉取模型」能拿到该接口真实支持的模型名，
              再用下拉选一个；没配 Key 的服务商不会出现在主界面的下拉里。
            </p>

            {providers.map((provider) => (
              <div key={provider.id} className="provider-row">
                <div className="provider-name">
                  <div className="provider-title">{provider.name}</div>
                  <div className="provider-note">{provider.note}</div>
                  {provider.maskedKey ? (
                    <div className="provider-key">已配置 {provider.maskedKey}</div>
                  ) : (
                    <div className="provider-key is-empty">未配置</div>
                  )}
                </div>

                <div className="provider-input">
                  <input
                    type="password"
                    className="control wide"
                    placeholder={provider.maskedKey ? '粘贴新 Key 可覆盖' : '粘贴 API Key'}
                    value={drafts[provider.id] ?? ''}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [provider.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveKey(provider.id)
                    }}
                  />

                  {provider.id === 'custom' && (
                    <input
                      type="text"
                      className="control wide"
                      placeholder="接口地址，例如 https://api.example.com/v1"
                      value={config.customBaseUrl}
                      onChange={(e) => void patch({ customBaseUrl: e.target.value })}
                    />
                  )}

                  <div className="inline-field">
                    {provider.id === 'custom' ? (
                      <input
                        type="text"
                        className="control"
                        placeholder="模型名，例如 deepseek-chat"
                        value={config.customModel}
                        onChange={(e) => void patch({ customModel: e.target.value })}
                      />
                    ) : (
                      <select
                        className="control"
                        value={modelFor(provider)}
                        disabled={!provider.hasKey}
                        title={provider.hasKey ? '选择该服务商要用的模型' : '保存 Key 之后才能选择'}
                        onChange={(e) => pickModel(provider, e.target.value)}
                      >
                        {modelsFor(provider).map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      className="btn-ghost sm"
                      disabled={loadingModels === provider.id || !provider.maskedKey}
                      title={
                        provider.maskedKey
                          ? '从接口拉取当前可用的模型名'
                          : '先保存 API Key 再拉取'
                      }
                      onClick={() => void fetchModels(provider.id)}
                    >
                      {loadingModels === provider.id ? '拉取中…' : '拉取模型'}
                    </button>
                  </div>

                  {provider.id === 'custom' && provider.models.length > 1 && (
                    <div className="model-chips">
                      {provider.models.map((name) => (
                        <button
                          key={name}
                          type="button"
                          className={`model-chip${
                            config.customModel === name ? ' is-active' : ''
                          }`}
                          onClick={() => pickModel(provider, name)}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}

                  {provider.id === 'custom' && !config.customModel && (
                    <span className="provider-status">
                      模型名必须填该接口支持的名称，点「拉取模型」可以自动列出来
                    </span>
                  )}

                  {status[provider.id] && (
                    <span className="provider-status">{status[provider.id]}</span>
                  )}
                </div>

                <div className="provider-actions">
                  <button
                    type="button"
                    className="btn-ghost sm"
                    onClick={() => void saveKey(provider.id)}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    className="btn-ghost sm"
                    disabled={!provider.maskedKey || testing === provider.id}
                    onClick={() => void testKey(provider.id)}
                  >
                    测试
                  </button>
                  {provider.maskedKey && (
                    <button
                      type="button"
                      className="btn-ghost sm"
                      onClick={async () => {
                        const result = await window.api.clearKey(provider.id)
                        if (result.config) applyConfig(result.config)
                        await reloadProviders()
                        setStatusFor(provider.id, '已清除')
                      }}
                    >
                      清除
                    </button>
                  )}
                  {provider.keyUrl && (
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => void window.api.openExternal(provider.keyUrl)}
                    >
                      获取 Key ↗
                    </button>
                  )}
                </div>
              </div>
            ))}
          </section>

          <section className="card">
            <h2 className="card-title">生成参数</h2>

            <div className="field-row">
              <label className="field-label">当前模型</label>
              <div className="field-control">
                <span className="field-value">
                  {selected?.name ?? '—'} /{' '}
                  {config.providerId === 'custom' ? config.customModel || '未填写' : config.model}
                </span>
                <span className="field-hint">在主界面输入框右下角切换</span>
              </div>
            </div>

            <div className="field-row">
              <label className="field-label">发挥程度</label>
              <div className="field-control">
                <input
                  type="range"
                  min={0}
                  max={1.2}
                  step={0.1}
                  value={config.temperature}
                  onChange={(e) => void patch({ temperature: Number(e.target.value) })}
                />
                <span className="field-value">{config.temperature.toFixed(1)}</span>
                <span className="field-hint">
                  越低越收敛稳定；增强任务建议 0.2–0.4，过高容易跑题
                </span>
              </div>
            </div>

            <div className="field-row">
              <label className="field-label">生成后自动复制</label>
              <div className="field-control">
                <button
                  type="button"
                  className={`switch${config.autoCopy ? ' on' : ''}`}
                  onClick={() => void patch({ autoCopy: !config.autoCopy })}
                />
                <span className="field-hint">完成后直接进剪贴板，省一次点击</span>
              </div>
            </div>

            <div className="field-row">
              <label className="field-label">开机自启</label>
              <div className="field-control">
                <button
                  type="button"
                  className={`switch${config.openAtLogin ? ' on' : ''}`}
                  onClick={() => void patch({ openAtLogin: !config.openAtLogin })}
                />
                <span className="field-hint">常驻后台后，全局快捷键随时可用</span>
              </div>
            </div>
          </section>

          <section className="card">
            <h2 className="card-title">快捷键</h2>
            <p className="card-desc">
              点一下组合键位置，然后直接按下新的组合；Esc 取消。全局唤起若被其他软件占用会提示并保留原设置。
            </p>

            {HOTKEY_ROWS.map((row) => (
              <div key={row.slot} className="field-row">
                <label className="field-label">{row.label}</label>
                <div className="field-control">
                  <HotkeyField
                    slot={row.slot}
                    value={config[row.slot]}
                    platform={platform}
                    onChange={(accelerator) => setHotkey(row.slot, accelerator)}
                  />
                </div>
                <span className="field-hint" style={{ gridColumn: '2' }}>
                  {row.hint}
                </span>
              </div>
            ))}
          </section>

          <section className="card">
            <h2 className="card-title">数据存储</h2>
            <p className="card-desc">
              设置、密钥、历史都存在下面这个目录里。换位置时会把现有文件一起搬过去，搬完才切换，失败不会丢数据。
            </p>

            <div className="field-row">
              <label className="field-label">当前位置</label>
              <div className="field-control">
                <span className="field-value mono">{info?.dataDir ?? '—'}</span>
                {info?.isCustomDataDir ? (
                  <span className="tag">自定义</span>
                ) : (
                  <span className="tag">默认</span>
                )}
              </div>
            </div>

            <div className="field-row">
              <label className="field-label">更改位置</label>
              <div className="field-control">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={moving}
                  onClick={() => void changeDataDir()}
                >
                  {moving ? '正在迁移…' : '选择文件夹并迁移'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => void window.api.openDataDir()}
                >
                  打开目录
                </button>
              </div>
            </div>

            {dirMessage && (
              <div className={`banner${dirError ? ' error' : ' ok'}`}>{dirMessage}</div>
            )}
          </section>

          <section className="card">
            <h2 className="card-title">关于</h2>
            <div className="field-row">
              <label className="field-label">版本</label>
              <div className="field-control">
                <span className="field-value">
                  {info?.version} · {platform === 'darwin' ? 'macOS' : 'Windows'}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}
