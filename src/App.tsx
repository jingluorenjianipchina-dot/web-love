import { useEffect, useMemo, useState } from 'react'
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
  login
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
  const [data, setDataState] = useState<AppData | null>(null)
  const [session, setSession] = useState<Session | null>(() => getSession())
  const [page, setPage] = useState<PageKey>('home')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const currentUser = useMemo(
    () => data?.users.find((user) => user.openid === session?.openid) || null,
    [data, session]
  )

  useEffect(() => {
    loadData()
      .then((nextData) => {
        setDataState(nextData)
        setError('')
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '数据加载失败')
      })
      .finally(() => setLoading(false))
  }, [])

  function setData(nextData: AppData) {
    setDataState(nextData)
  }

  async function handleLogin(roleKey: RoleKey, inviteCode: string) {
    const result = await login(roleKey, inviteCode)
    setSession(result.session)
    setDataState(result.data)
    setPage('home')
  }

  function handleLogout() {
    clearSession()
    setSession(null)
  }

  if (loading) {
    return (
      <main className="login-page">
        <section className="login-card">
          <p className="subtitle">正在连接服务器...</p>
        </section>
      </main>
    )
  }

  if (error) {
    return (
      <main className="login-page">
        <section className="login-card">
          <h1>服务器连接失败</h1>
          <p className="subtitle">{error}</p>
          <p className="subtitle">请确认后端服务已经启动。</p>
        </section>
      </main>
    )
  }

  if (!session || !currentUser || !data) {
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
          <SettingsPage data={data} currentUser={currentUser} onChange={setData} onLogout={handleLogout} />
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
