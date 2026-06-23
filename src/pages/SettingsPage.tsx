import { useEffect, useRef, useState } from 'react'
import { resetData, updateUserProfile } from '../services/storage'
import type { AppData, User } from '../types'

interface SettingsPageProps {
  data: AppData
  currentUser: User
  onChange: (data: AppData) => void
  onLogout: () => void
}

function avatarText(user: User) {
  const name = user.nickName || user.displayName
  return name.slice(1, 2) || name.slice(0, 1) || '?'
}

function readImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('头像读取失败'))
    reader.readAsDataURL(file)
  })
}

async function compressAvatar(file: File) {
  const dataUrl = await readImageFile(file)
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new Image()
    nextImage.onload = () => resolve(nextImage)
    nextImage.onerror = () => reject(new Error('头像读取失败'))
    nextImage.src = dataUrl
  })
  const size = 256
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器不支持头像压缩')

  canvas.width = size
  canvas.height = size
  const sourceSize = Math.min(image.width, image.height)
  const sourceX = (image.width - sourceSize) / 2
  const sourceY = (image.height - sourceSize) / 2
  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size)
  return canvas.toDataURL('image/jpeg', 0.78)
}

function withUpdatedCurrentUser(data: AppData, openid: string, profile: Pick<User, 'nickName' | 'avatarUrl'>) {
  return {
    ...data,
    users: data.users.map((user) => (
      user.openid === openid
        ? { ...user, ...profile }
        : user
    ))
  }
}

export function SettingsPage({ data, currentUser, onChange, onLogout }: SettingsPageProps) {
  const [message, setMessage] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [nicknameDialogOpen, setNicknameDialogOpen] = useState(false)
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [avatarPreviewOpen, setAvatarPreviewOpen] = useState(false)
  const [profileView, setProfileView] = useState({
    nickName: currentUser.nickName,
    avatarUrl: currentUser.avatarUrl
  })
  const displayUser = { ...currentUser, ...profileView }
  const longPressTimer = useRef(0)
  const longPressTriggered = useRef(false)

  useEffect(() => {
    setProfileView({
      nickName: currentUser.nickName,
      avatarUrl: currentUser.avatarUrl
    })
  }, [currentUser.openid, currentUser.nickName, currentUser.avatarUrl])

  async function handleReset() {
    if (!window.confirm('确定清空当前数据吗？')) return
    onChange(await resetData())
    setMessage('已清空当前数据')
  }

  async function handleAvatarChange(file: File | undefined) {
    if (!file) return

    try {
      setSavingProfile(true)
      const avatarUrl = await compressAvatar(file)
      const nextData = await updateUserProfile(data, currentUser.openid, {
        nickName: displayUser.nickName || displayUser.displayName,
        avatarUrl
      })
      const savedUser = nextData.users.find((user) => user.openid === currentUser.openid)
      const savedAvatarUrl = savedUser?.avatarUrl || avatarUrl
      setProfileView({
        nickName: displayUser.nickName,
        avatarUrl: savedAvatarUrl
      })
      onChange(withUpdatedCurrentUser(nextData, currentUser.openid, {
        nickName: displayUser.nickName || displayUser.displayName,
        avatarUrl: savedAvatarUrl
      }))
      setMessage('头像已更新')
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '头像上传失败')
    } finally {
      setSavingProfile(false)
    }
  }

  function openNicknameDialog() {
    setNicknameDraft(displayUser.nickName || displayUser.displayName)
    setNicknameDialogOpen(true)
  }

  function closeNicknameDialog() {
    setNicknameDialogOpen(false)
    setNicknameDraft('')
  }

  function openAvatarPicker() {
    document.getElementById('profile-avatar-input')?.click()
  }

  function startAvatarLongPress() {
    window.clearTimeout(longPressTimer.current)
    longPressTriggered.current = false
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true
      openAvatarPicker()
    }, 550)
  }

  function cancelAvatarLongPress() {
    window.clearTimeout(longPressTimer.current)
  }

  function handleAvatarClick() {
    if (longPressTriggered.current) {
      longPressTriggered.current = false
      return
    }

    if (displayUser.avatarUrl) {
      setAvatarPreviewOpen(true)
      return
    }

    openAvatarPicker()
  }

  async function handleNicknameSave() {
    const nextNickName = nicknameDraft.trim()
    if (!nextNickName) return

    try {
      setSavingProfile(true)
      const nextData = await updateUserProfile(data, currentUser.openid, {
        nickName: nextNickName,
        avatarUrl: displayUser.avatarUrl
      })
      setProfileView({
        nickName: nextNickName,
        avatarUrl: displayUser.avatarUrl
      })
      onChange(withUpdatedCurrentUser(nextData, currentUser.openid, {
        nickName: nextNickName,
        avatarUrl: displayUser.avatarUrl
      }))
      setMessage('昵称已更新')
      closeNicknameDialog()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '昵称修改失败')
    } finally {
      setSavingProfile(false)
    }
  }

  return (
    <div className="page-stack">
      <section className="card">
        <h3>我的资料</h3>
        <div className="profile-card">
          <button
            className="profile-avatar"
            type="button"
            aria-label="查看头像，长按更换头像"
            onClick={handleAvatarClick}
            onMouseDown={startAvatarLongPress}
            onMouseUp={cancelAvatarLongPress}
            onMouseLeave={cancelAvatarLongPress}
            onTouchStart={startAvatarLongPress}
            onTouchEnd={cancelAvatarLongPress}
          >
            {displayUser.avatarUrl ? (
              <img src={displayUser.avatarUrl} alt="头像" />
            ) : (
              <span>{avatarText(displayUser)}</span>
            )}
          </button>
          <input
            id="profile-avatar-input"
            className="hidden-input"
            type="file"
            accept="image/*"
            disabled={savingProfile}
            onChange={(event) => handleAvatarChange(event.target.files?.[0])}
          />
          <div className="profile-name">
            <strong>{displayUser.nickName || displayUser.displayName}</strong>
            <button
              className="profile-edit-btn"
              type="button"
              disabled={savingProfile}
              aria-label="修改昵称"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                openNicknameDialog()
              }}
            >
              ✎
            </button>
          </div>
        </div>
      </section>

      {avatarPreviewOpen && displayUser.avatarUrl && (
        <div className="dialog-mask" onClick={() => setAvatarPreviewOpen(false)}>
          <div className="avatar-preview-card" onClick={(event) => event.stopPropagation()}>
            <img src={displayUser.avatarUrl} alt="头像大图" />
            <button className="ghost-btn" type="button" onClick={() => setAvatarPreviewOpen(false)}>关闭</button>
          </div>
        </div>
      )}

      {nicknameDialogOpen && (
        <div className="dialog-mask" onClick={closeNicknameDialog}>
          <div className="dialog-card" onClick={(event) => event.stopPropagation()}>
            <h3>修改昵称</h3>
            <input
              className="input"
              value={nicknameDraft}
              placeholder="请输入新的昵称"
              maxLength={20}
              onChange={(event) => setNicknameDraft(event.target.value)}
            />
            <div className="dialog-actions">
              <button className="ghost-btn" type="button" onClick={closeNicknameDialog}>取消</button>
              <button
                className="primary-btn small"
                type="button"
                disabled={savingProfile}
                onClick={handleNicknameSave}
              >
                {savingProfile ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="card">
        <h3>数据概览</h3>
        <div className="data-summary">
          <span>用户：{data.users.length}</span>
          <span>纪念日：{data.anniversaries.length}</span>
          <span>留言：{data.messages.length}</span>
          <span>卡券：{data.coupons.length}</span>
        </div>
        <button className="ghost-btn danger" onClick={handleReset}>清空当前数据</button>
        <button className="text-btn block" onClick={onLogout}>退出当前身份</button>
        {message && <p className="success-text">{message}</p>}
      </section>
    </div>
  )
}
