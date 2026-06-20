import { useEffect, useMemo, useState } from 'react'
import { formatTime } from '../services/date'
import {
  addMessage,
  deleteMessage,
  markMessagesRead,
  setMessagePinned,
  updateMessage
} from '../services/storage'
import type { AppData, Message, Session } from '../types'

interface MessagesPageProps {
  data: AppData
  session: Session
  onChange: (data: AppData) => void
}

function readText(message: Message) {
  return message.readBy.length > 1 || (message.readBy.length === 1 && message.senderOpenid !== message.readBy[0])
    ? '已读'
    : '未读'
}

export function MessagesPage({ data, session, onChange }: MessagesPageProps) {
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [activeMessage, setActiveMessage] = useState<Message | null>(null)
  const [editing, setEditing] = useState(false)
  const [editingContent, setEditingContent] = useState('')
  const [acting, setActing] = useState(false)

  const messages = useMemo(
    () => [...data.messages].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.createdAt.localeCompare(a.createdAt)
    }),
    [data.messages]
  )

  useEffect(() => {
    markMessagesRead(data, session).then((nextData) => {
      if (JSON.stringify(nextData.messages) !== JSON.stringify(data.messages)) {
        onChange(nextData)
      }
    })
  }, [data, onChange, session])

  async function submit() {
    const trimmedContent = content.trim()
    if (!trimmedContent) return

    try {
      setSending(true)
      onChange(await addMessage(data, trimmedContent, session))
      setContent('')
    } finally {
      setSending(false)
    }
  }

  function openActions(message: Message) {
    setActiveMessage(message)
    setEditing(false)
    setEditingContent(message.content)
  }

  function closeActions() {
    setActiveMessage(null)
    setEditing(false)
    setEditingContent('')
  }

  async function unpinCurrent() {
    if (!activeMessage || !activeMessage.pinned) return
    try {
      setActing(true)
      onChange(await setMessagePinned(data, activeMessage.id, false))
      closeActions()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '取消置顶失败')
    } finally {
      setActing(false)
    }
  }

  async function removeCurrent() {
    if (!activeMessage) return
    if (!window.confirm('确定删除这条留言吗？')) return
    try {
      setActing(true)
      onChange(await deleteMessage(data, activeMessage.id))
      closeActions()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '删除失败')
    } finally {
      setActing(false)
    }
  }

  async function saveEdit() {
    if (!activeMessage) return
    const nextContent = editingContent.trim()
    if (!nextContent) return
    try {
      setActing(true)
      onChange(await updateMessage(data, activeMessage.id, nextContent))
      closeActions()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '修改失败')
    } finally {
      setActing(false)
    }
  }

  async function pinCurrent(message: Message) {
    try {
      onChange(await setMessagePinned(data, message.id, true))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '置顶失败')
    }
  }

  function renderMessageStatus(message: Message) {
    if (message.pinned) {
      return <span className="message-tag">已置顶</span>
    }

    if (readText(message) === '未读') {
      return <span className="message-tag">未读</span>
    }

    return (
      <button className="message-tag message-tag-btn" onClick={() => pinCurrent(message)}>
        置顶
      </button>
    )
  }

  return (
    <div className="page-stack">
      <section className="card">
        <h3>写留言</h3>
        <textarea
          className="textarea"
          value={content}
          placeholder="写点想说的话"
          maxLength={200}
          onChange={(event) => setContent(event.target.value)}
        />
        <button className="primary-btn" disabled={sending} onClick={submit}>
          {sending ? '发送中...' : '发送留言'}
        </button>
      </section>

      <section className="card">
        <h3>我想对你说</h3>
        <div className="list">
          {messages.map((message) => (
            <article className="message-card" key={message.id}>
              <div className="message-head">
                <strong>{message.senderName}</strong>
                {renderMessageStatus(message)}
              </div>
              <p>{message.content}</p>
              <div className="message-foot">
                <small>{formatTime(message.createdAt)}</small>
                <button className="message-more-btn" onClick={() => openActions(message)}>更多</button>
              </div>
            </article>
          ))}
          {!messages.length && <p className="empty">还没有留言。</p>}
        </div>
      </section>

      {activeMessage && (
        <div className="dialog-mask" onClick={closeActions}>
          <div className="dialog-card" onClick={(event) => event.stopPropagation()}>
            {editing ? (
              <>
                <h3>修改留言</h3>
                <textarea
                  className="textarea"
                  value={editingContent}
                  maxLength={200}
                  onChange={(event) => setEditingContent(event.target.value)}
                />
                <div className="dialog-actions">
                  <button className="ghost-btn" onClick={() => setEditing(false)}>取消</button>
                  <button className="primary-btn small" disabled={acting} onClick={saveEdit}>
                    {acting ? '保存中...' : '保存'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>留言操作</h3>
                <div className="dialog-actions vertical">
                  {activeMessage.pinned && (
                    <button
                      className="ghost-btn"
                      disabled={acting}
                      onClick={unpinCurrent}
                    >
                      取消置顶
                    </button>
                  )}
                  <button className="ghost-btn" disabled={acting} onClick={() => setEditing(true)}>修改</button>
                  <button className="ghost-btn danger" disabled={acting} onClick={removeCurrent}>删除</button>
                  <button className="text-btn block" onClick={closeActions}>关闭</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
