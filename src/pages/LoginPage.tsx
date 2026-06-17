import { useState } from 'react'
import { APP_NAME, ROLE_OPTIONS } from '../config'
import type { RoleKey } from '../types'

interface LoginPageProps {
  onLogin: (roleKey: RoleKey) => void
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [selectedRole, setSelectedRole] = useState<RoleKey | ''>('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')

  function submit() {
    const role = ROLE_OPTIONS.find((item) => item.key === selectedRole)
    if (!role) {
      setError('请选择身份')
      return
    }

    if (inviteCode.trim().toUpperCase() !== role.inviteCode) {
      setError('邀请码不正确')
      return
    }

    setError('')
    onLogin(role.key)
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <p className="eyebrow">双人专属空间</p>
        <h1>{APP_NAME}</h1>
        <p className="subtitle">选择你的身份，输入专属邀请码后进入。</p>

        <div className="role-grid">
          {ROLE_OPTIONS.map((role) => (
            <button
              key={role.key}
              className={selectedRole === role.key ? 'role active' : 'role'}
              onClick={() => setSelectedRole(role.key)}
            >
              {role.label}
            </button>
          ))}
        </div>

        <input
          className="input"
          value={inviteCode}
          placeholder="请输入邀请码"
          onChange={(event) => setInviteCode(event.target.value)}
        />
        {error && <p className="form-error">{error}</p>}
        <button className="primary-btn" onClick={submit}>进入专属空间</button>
      </section>
    </main>
  )
}
