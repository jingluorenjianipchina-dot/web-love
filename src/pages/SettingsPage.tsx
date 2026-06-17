import { useState } from 'react'
import { resetData } from '../services/storage'
import type { AppData } from '../types'

interface SettingsPageProps {
  data: AppData
  onChange: (data: AppData) => void
  onLogout: () => void
}

export function SettingsPage({ data, onChange, onLogout }: SettingsPageProps) {
  const [message, setMessage] = useState('')

  async function handleReset() {
    if (!window.confirm('确定清空本地数据并恢复示例数据吗？')) return
    onChange(await resetData())
    setMessage('已恢复示例数据')
  }

  return (
    <div className="page-stack">
      <section className="card">
        <h3>本地数据</h3>
        <div className="data-summary">
          <span>用户：{data.users.length}</span>
          <span>纪念日：{data.anniversaries.length}</span>
          <span>留言：{data.messages.length}</span>
          <span>卡券：{data.coupons.length}</span>
        </div>
        <button className="ghost-btn danger" onClick={handleReset}>清空并恢复示例数据</button>
        <button className="text-btn block" onClick={onLogout}>退出当前身份</button>
        {message && <p className="success-text">{message}</p>}
      </section>
    </div>
  )
}
