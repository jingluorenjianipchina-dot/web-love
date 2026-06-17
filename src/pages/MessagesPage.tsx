import { useEffect, useMemo, useState } from 'react'
import { formatTime } from '../services/date'
import { addMessage, markMessagesRead, pinMessage } from '../services/storage'
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
        <h3>留言列表</h3>
        <div className="list">
          {messages.map((message) => (
            <article className="message-card" key={message.id}>
              <div className="message-head">
                <strong>{message.senderName}</strong>
                <span>{message.pinned ? '已置顶' : readText(message)}</span>
              </div>
              <p>{message.content}</p>
              <div className="message-foot">
                <small>{formatTime(message.createdAt)}</small>
                {!message.pinned && (
                  <button className="text-btn" onClick={async () => onChange(await pinMessage(data, message.id))}>
                    置顶
                  </button>
                )}
              </div>
            </article>
          ))}
          {!messages.length && <p className="empty">还没有留言。</p>}
        </div>
      </section>
    </div>
  )
}
