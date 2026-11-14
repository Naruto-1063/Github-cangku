import { useEffect, useState } from 'react'
import { useAppStore } from './lib/store'
import HomePage from './pages/Home'
import HistoryPage from './pages/History'
import SettingsPage from './pages/Settings'

type View = 'home' | 'history' | 'settings'

export default function App() {
  const boot = useAppStore((s) => s.boot)
  const booted = useAppStore((s) => s.booted)

  const [view, setView] = useState<View>('home')

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    return window.api.onPrefill(() => setView('home'))
  }, [])

  if (!booted) {
    return <div className="boot">正在启动…</div>
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          提示词工坊
        </div>

        <div className="spacer" />

        <div className="top-actions">
          <button
            type="button"
            className={`icon-btn${view === 'history' ? ' active' : ''}`}
            onClick={() => setView(view === 'history' ? 'home' : 'history')}
          >
            历史
          </button>
          <button
            type="button"
            className={`icon-btn${view === 'settings' ? ' active' : ''}`}
            onClick={() => setView(view === 'settings' ? 'home' : 'settings')}
          >
            设置
          </button>
        </div>
      </header>

      <div className="stage">
        <HomePage active={view === 'home'} onNavigate={setView} />
      </div>

      {view === 'history' && <HistoryPage onClose={() => setView('home')} />}
      {view === 'settings' && <SettingsPage onClose={() => setView('home')} />}
    </div>
  )
}
