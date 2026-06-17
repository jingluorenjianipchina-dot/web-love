import { useMemo, useState } from 'react'
import { APP_NAME } from './config'
import { AnniversariesPage } from './pages/AnniversariesPage'
import { CouponsPage } from './pages/CouponsPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { MessagesPage } from './pages/MessagesPage'
import { SettingsPage } from './pages/SettingsPage'
import {
  clearSession,
  getSession,
  loadData,
  login,
  saveData
} from './services/storage'
import type { AppData, PageKey, RoleKey, Session } from './types'

const tabs: Array<{ key: PageKey; label: string }> = [
  { key: 'home', label: '首页' },
  { key: 'anniversaries', label: '纪念日' },
  { key: 'messages', label: '留言' },
  { key: 'coupons', label: '卡券' },
  { key: 'settings', label: '设置' }
]

export default function App() {
  const [data, setDataState] = useState<AppData>(() => loadData())
  const [session, setSession] = useState<Session | null>(() => getSession())
  const [page, setPage] = useState<PageKey>('home')

  const currentUser = useMemo(
    () => data.users.find((user) => user.openid === session?.openid) || null,
    [data.users, session]
  )

  function setData(nextData: AppData) {
    saveData(nextData)
    setDataState(nextData)
  }

  function handleLogin(roleKey: RoleKey) {
    const nextSession = login(roleKey)
    setSession(nextSession)
    setPage('home')
  }

  function handleLogout() {
    clearSession()
    setSession(null)
  }

  if (!session || !currentUser) {
    return <LoginPage onLogin={handleLogin} />
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">网页版</p>
          <h1>{APP_NAME}</h1>
        </div>
        <button className="text-btn" onClick={handleLogout}>退出</button>
      </header>

      <main className="content">
        {page === 'home' && <HomePage data={data} currentUser={currentUser} />}
        {page === 'anniversaries' && (
          <AnniversariesPage data={data} session={session} onChange={setData} />
        )}
        {page === 'messages' && (
          <MessagesPage data={data} session={session} onChange={setData} />
        )}
        {page === 'coupons' && (
          <CouponsPage data={data} session={session} onChange={setData} />
        )}
        {page === 'settings' && (
          <SettingsPage data={data} onChange={setData} onLogout={handleLogout} />
        )}
      </main>

      <nav className="tabbar" aria-label="主导航">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={page === tab.key ? 'active' : ''}
            onClick={() => setPage(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
