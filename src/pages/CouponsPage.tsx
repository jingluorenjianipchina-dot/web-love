import { useMemo, useState } from 'react'
import { COUPON_TEMPLATES, STATUS_TEXT } from '../config'
import { formatDate } from '../services/date'
import { addCoupon, updateCouponStatus } from '../services/storage'
import type { AppData, Coupon, CouponStatus, Session } from '../types'

interface CouponsPageProps {
  data: AppData
  session: Session
  onChange: (data: AppData) => void
}

const filters: Array<{ key: CouponStatus | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'unused', label: '未使用' },
  { key: 'pending', label: '待确认' },
  { key: 'used', label: '已使用' },
  { key: 'expired', label: '已过期' }
]

function normalizeCoupon(coupon: Coupon): Coupon {
  const today = formatDate()
  const status = coupon.status === 'unused' && coupon.expireDate && coupon.expireDate < today
    ? 'expired'
    : coupon.status

  return { ...coupon, status }
}

export function CouponsPage({ data, session, onChange }: CouponsPageProps) {
  const [activeStatus, setActiveStatus] = useState<CouponStatus | 'all'>('all')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [expireDate, setExpireDate] = useState('')
  const [saving, setSaving] = useState(false)
  const receivers = data.users.filter((user) => user.openid !== session.openid)
  const [receiverOpenid, setReceiverOpenid] = useState(receivers[0]?.openid || '')

  const coupons = useMemo(() => {
    const normalized = data.coupons
      .map(normalizeCoupon)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    return activeStatus === 'all'
      ? normalized
      : normalized.filter((coupon) => coupon.status === activeStatus)
  }, [activeStatus, data.coupons])

  async function createCoupon() {
    const trimmedTitle = title.trim()
    const receiver = receivers.find((item) => item.openid === receiverOpenid)
    if (!trimmedTitle || !receiver) return

    try {
      setSaving(true)
      onChange(await addCoupon(data, {
        title: trimmedTitle,
        description: description.trim(),
        expireDate,
        receiverOpenid: receiver.openid,
        receiverName: receiver.displayName
      }, session))
      setTitle('')
      setDescription('')
      setExpireDate('')
    } finally {
      setSaving(false)
    }
  }

  function canRequestUse(coupon: Coupon) {
    return coupon.status === 'unused' && coupon.receiverOpenid === session.openid
  }

  function canConfirm(coupon: Coupon) {
    return coupon.status === 'pending' && coupon.confirmOpenid === session.openid
  }

  return (
    <div className="page-stack">
      <section className="card">
        <h3>创建卡券</h3>
        <div className="template-list">
          {COUPON_TEMPLATES.map((template) => (
            <button
              className={title === template ? 'tag active' : 'tag'}
              key={template}
              onClick={() => setTitle(template)}
            >
              {template}
            </button>
          ))}
        </div>
        <input
          className="input"
          value={title}
          placeholder="卡券名称，也可以自定义"
          onChange={(event) => setTitle(event.target.value)}
        />
        <textarea
          className="textarea"
          value={description}
          placeholder="使用说明，例如：心情不好时可用"
          maxLength={200}
          onChange={(event) => setDescription(event.target.value)}
        />
        <select
          className="input"
          value={receiverOpenid}
          onChange={(event) => setReceiverOpenid(event.target.value)}
        >
          {receivers.map((receiver) => (
            <option key={receiver.id} value={receiver.openid}>{receiver.displayName}</option>
          ))}
        </select>
        <input
          className="input"
          type="date"
          value={expireDate}
          onChange={(event) => setExpireDate(event.target.value)}
        />
        <button className="primary-btn" disabled={saving} onClick={createCoupon}>
          {saving ? '发送中...' : '发送给对方'}
        </button>
      </section>

      <section className="card">
        <h3>卡券包</h3>
        <div className="filter-row">
          {filters.map((filter) => (
            <button
              key={filter.key}
              className={activeStatus === filter.key ? 'chip active' : 'chip'}
              onClick={() => setActiveStatus(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="list">
          {coupons.map((coupon) => (
            <article className="coupon-card" key={coupon.id}>
              <div className="message-head">
                <strong>{coupon.title}</strong>
                <span>{STATUS_TEXT[coupon.status]}</span>
              </div>
              <p>{coupon.description || '没有使用说明'}</p>
              <small>
                {coupon.creatorName} 送给 {coupon.receiverName}
                {coupon.expireDate ? ` · 有效期至 ${coupon.expireDate}` : ' · 长期有效'}
              </small>
              <div className="action-row">
                {canRequestUse(coupon) && (
                  <button
                    className="ghost-btn"
                    onClick={async () => onChange(await updateCouponStatus(data, coupon.id, 'pending', session))}
                  >
                    申请使用
                  </button>
                )}
                {canConfirm(coupon) && (
                  <>
                    <button
                      className="ghost-btn"
                      onClick={async () => onChange(await updateCouponStatus(data, coupon.id, 'unused', session))}
                    >
                      暂不确认
                    </button>
                    <button
                      className="primary-btn small"
                      onClick={async () => onChange(await updateCouponStatus(data, coupon.id, 'used', session))}
                    >
                      确认使用
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
          {!coupons.length && <p className="empty">没有符合条件的卡券。</p>}
        </div>
      </section>
    </div>
  )
}
