import { useState } from 'react'
import { anniversaryInfo, formatDate } from '../services/date'
import { addAnniversary, updateAnniversary } from '../services/storage'
import type { AppData, Session } from '../types'

interface AnniversariesPageProps {
  data: AppData
  session: Session
  onChange: (data: AppData) => void
}

export function AnniversariesPage({ data, session, onChange }: AnniversariesPageProps) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(formatDate())
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [editingTitle, setEditingTitle] = useState('')
  const [editingDate, setEditingDate] = useState('')

  const anniversaries = [...data.anniversaries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(anniversaryInfo)

  async function submit() {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    try {
      setSaving(true)
      onChange(await addAnniversary(data, trimmedTitle, date, session))
      setTitle('')
      setDate(formatDate())
    } finally {
      setSaving(false)
    }
  }

  function openEdit(id: string, currentTitle: string, currentDate: string) {
    setEditingId(id)
    setEditingTitle(currentTitle)
    setEditingDate(currentDate)
  }

  function closeEdit() {
    setEditingId('')
    setEditingTitle('')
    setEditingDate('')
  }

  async function submitEdit() {
    const trimmedTitle = editingTitle.trim()
    if (!editingId || !trimmedTitle || !editingDate) return

    try {
      setSaving(true)
      onChange(await updateAnniversary(data, editingId, trimmedTitle, editingDate, session))
      closeEdit()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-stack">
      <section className="card">
        <h3>全部纪念日</h3>
        <div className="list">
          {anniversaries.map((item) => (
            <button
              className="list-item list-item-button"
              key={item.id}
              type="button"
              onClick={() => openEdit(item.id, item.title, item.date)}
            >
              <div>
                <strong>{item.title}</strong>
                <p>{item.date} · {item.creatorName}</p>
              </div>
              <div className="item-metrics">
                <span>已过 {item.passedDays} 天</span>
                <small>距下次 {item.remainingDays} 天</small>
              </div>
            </button>
          ))}
          {!anniversaries.length && <p className="empty">还没有纪念日。</p>}
        </div>
      </section>

      {editingId ? (
        <section className="card">
          <h3>编辑纪念日</h3>
          <button className="text-btn" type="button" onClick={closeEdit}>返回纪念日列表</button>
          <input
            className="input"
            value={editingTitle}
            placeholder="纪念日标题"
            onChange={(event) => setEditingTitle(event.target.value)}
          />
          <input
            className="input"
            type="date"
            value={editingDate}
            onChange={(event) => setEditingDate(event.target.value)}
          />
          <button className="primary-btn" disabled={saving} onClick={submitEdit}>
            {saving ? '保存中...' : '保存修改'}
          </button>
        </section>
      ) : (
        <section className="card">
          <h3>添加纪念日</h3>
          <input
            className="input"
            value={title}
            placeholder="纪念日标题"
            onChange={(event) => setTitle(event.target.value)}
          />
          <input
            className="input"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <button className="primary-btn" disabled={saving} onClick={submit}>
            {saving ? '保存中...' : '保存纪念日'}
          </button>
        </section>
      )}
    </div>
  )
}
