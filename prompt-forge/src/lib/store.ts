import { create } from 'zustand'
import type { AppConfig, AppInfo, Provider, Template } from './types'

type AppState = {
  booted: boolean
  info: AppInfo | null
  config: AppConfig | null
  providers: Provider[]
  templates: Template[]
  boot: () => Promise<void>
  patch: (patch: Partial<AppConfig>) => Promise<void>
  applyConfig: (config: AppConfig) => void
  reloadProviders: () => Promise<void>
}

export const useAppStore = create<AppState>((set) => ({
  booted: false,
  info: null,
  config: null,
  providers: [],
  templates: [],

  boot: async () => {
    const [info, config, providers, templates] = await Promise.all([
      window.api.getAppInfo(),
      window.api.getConfig(),
      window.api.listProviders(),
      window.api.listTemplates()
    ])
    set({ info, config, providers, templates, booted: true })
  },

  patch: async (next) => {
    const config = await window.api.setConfig(next)
    set({ config })
  },

  applyConfig: (config) => set({ config }),

  reloadProviders: async () => {
    const providers = await window.api.listProviders()
    set({ providers })
  }
}))

export function activeProvider(state: AppState): Provider | null {
  if (!state.config) return null
  return state.providers.find((p) => p.id === state.config!.providerId) ?? null
}
