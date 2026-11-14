export type Provider = {
  id: string
  name: string
  baseUrl: string
  models: string[]
  keyUrl: string
  note: string
  maskedKey: string
  hasKey: boolean
}

export type Template = {
  id: string
  name: string
  hint: string
  extra: string
}

export type AppConfig = {
  providerId: string
  model: string
  temperature: number
  templateId: string
  autoCopy: boolean
  hotkey: string
  hotkeyEnhance: string
  hotkeyCopy: string
  hotkeyClear: string
  openAtLogin: boolean
  customBaseUrl: string
  customModel: string
  providerModels: Record<string, string[]>
}

export type HistoryRecord = {
  id: string
  createdAt: string
  templateId: string
  providerId: string
  model: string
  input: string
  output: string
}

export type AppInfo = {
  version: string
  platform: string
  dataDir: string
  defaultDataDir: string
  isCustomDataDir: boolean
  hotkey: string
  hotkeyLabel: string
}

export type DataDirResult = {
  ok: boolean
  canceled?: boolean
  changed?: boolean
  dir?: string
  files?: number
  bytes?: number
  error?: string
}

export type HotkeySlot = 'hotkey' | 'hotkeyEnhance' | 'hotkeyCopy' | 'hotkeyClear'

export type HotkeyResult = {
  ok: boolean
  error?: string
  config?: AppConfig
}

export type EnhanceStartResult = {
  ok: boolean
  requestId?: string
  error?: string
}

export type ChunkPayload = { requestId: string; delta: string }
export type DonePayload = {
  requestId: string
  text: string
  record: HistoryRecord
  copied: boolean
}
export type ErrorPayload = { requestId: string; error: string }

type Api = {
  getAppInfo: () => Promise<AppInfo>
  chooseDataDir: () => Promise<DataDirResult>
  openDataDir: () => Promise<{ ok: boolean; error?: string }>
  setHotkey: (slot: HotkeySlot, accelerator: string) => Promise<HotkeyResult>
  getConfig: () => Promise<AppConfig>
  setConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>
  listProviders: () => Promise<Provider[]>
  listTemplates: () => Promise<Template[]>
  listModels: (
    providerId: string
  ) => Promise<{ ok: boolean; models?: string[]; config?: AppConfig; error?: string }>
  setKey: (
    providerId: string,
    key: string
  ) => Promise<{ ok: boolean; maskedKey: string; config?: AppConfig }>
  clearKey: (providerId: string) => Promise<{ ok: boolean; config?: AppConfig }>
  testKey: (providerId: string) => Promise<{ ok: boolean; model?: string; error?: string }>
  enhance: (payload: {
    input: string
    templateId: string
    requestId?: string
  }) => Promise<EnhanceStartResult>
  cancelEnhance: (requestId: string) => Promise<{ ok: boolean }>
  onChunk: (cb: (payload: ChunkPayload) => void) => () => void
  onDone: (cb: (payload: DonePayload) => void) => () => void
  onError: (cb: (payload: ErrorPayload) => void) => () => void
  onPrefill: (cb: (text: string) => void) => () => void
  history: {
    list: () => Promise<HistoryRecord[]>
    remove: (id: string) => Promise<boolean>
    clear: () => Promise<boolean>
  }
  clipboard: {
    read: () => Promise<string>
    write: (text: string) => Promise<boolean>
  }
  openExternal: (url: string) => Promise<boolean>
}

declare global {
  interface Window {
    api: Api
  }
}

export {}
