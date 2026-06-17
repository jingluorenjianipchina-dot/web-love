import { useRef, useState } from 'react'
import { exportData, importData, resetData } from '../services/storage'
import type { AppData } from '../types'

interface SettingsPageProps {
  data: AppData
  onChange: (data: AppData) => void
  onLogout: () => void
}

export function SettingsPage({ data, onChange, onLogout }: SettingsPageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [message, setMessage] = useState('')

  function downloadBackup() {
    const blob = new Blob([exportData(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `love-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    setMessage('备份文件已导出')
  }

  async function handleImport(file: File | undefined) {
    if (!file) return

    try {
      const text = await file.text()
      const nextData = importData(text)
      onChange(nextData)
      setMessage('导入成功')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败')
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  function handleReset() {
    if (!window.confirm('确定清空本地数据并恢复示例数据吗？')) return
    onChange(resetData())
    setMessage('已恢复示例数据')
  }

  return (
    <div className="page-stack">
      <section className="card">
        <h3>数据备份</h3>
        <p className="subtitle">
          当前版本数据保存在本浏览器。换手机或分享给对方时，可以导出 JSON，再在另一台设备导入。
        </p>
        <div className="settings-actions">
          <button className="primary-btn" onClick={downloadBackup}>导出备份</button>
          <button className="ghost-btn" onClick={() => fileInputRef.current?.click()}>导入备份</button>
          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            accept="application/json"
            onChange={(event) => handleImport(event.target.files?.[0])}
          />
        </div>
        {message && <p className="success-text">{message}</p>}
      </section>

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
      </section>

      <section className="card">
        <h3>后续在线同步</h3>
        <p className="subtitle">
          项目已经把数据读写集中在 storage 服务里。后面接 Supabase 时，可以保留页面，只替换数据同步层。
        </p>
      </section>
    </div>
  )
}
