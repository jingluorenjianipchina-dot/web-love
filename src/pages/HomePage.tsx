import { DAILY_QUOTES, STATUS_TEXT } from '../config'
import { anniversaryInfo, formatDate, formatTime } from '../services/date'
import type { AppData, User } from '../types'

interface HomePageProps {
  data: AppData
  currentUser: User
}

function pickDailyQuote() {
  const now = new Date()
  const index = (now.getFullYear() + now.getMonth() + now.getDate()) % DAILY_QUOTES.length
  return DAILY_QUOTES[index]
}

function avatarText(user: User) {
  const name = user.nickName || user.displayName
  return name.slice(1, 2) || name.slice(0, 1) || '?'
}

export function HomePage({ data, currentUser }: HomePageProps) {
  const anniversaries = data.anniversaries.map(anniversaryInfo)
  const sortedByRemaining = [...anniversaries].sort((a, b) => a.remainingDays - b.remainingDays)
  const mainAnniversary = anniversaries.find((item) => item.type === 'meet') || anniversaries[0]
  const nextAnniversary = sortedByRemaining[0]
  const latestMessage = [...data.messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const today = formatDate()
  const unusedCoupons = data.coupons.filter((coupon) => {
    const expired = coupon.status === 'unused' && coupon.expireDate && coupon.expireDate < today
    return !expired && coupon.status === 'unused'
  })

  return (
    <div className="page-stack">
      <section className="hero-card">
        <p className="eyebrow">今天是 {today}</p>
        <h2>{currentUser.displayName}，欢迎回来</h2>
        <p>{pickDailyQuote()}</p>
      </section>

      <section className="card">
        <h3>我和你</h3>
        <div className="user-row">
          {data.users.map((user) => (
            <div className="avatar-card" key={user.id}>
              <div className="avatar">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt={`${user.displayName}头像`} />
                ) : (
                  avatarText(user)
                )}
              </div>
              <strong>{user.displayName}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="stats-grid">
        <div className="stat-card">
          <span>相识天数</span>
          <strong>{mainAnniversary?.passedDays ?? 0}</strong>
          <small>{mainAnniversary?.title || '还没有纪念日'}</small>
        </div>
        <div className="stat-card">
          <span>最近纪念日</span>
          <strong>{nextAnniversary ? `${nextAnniversary.remainingDays}天` : '-'}</strong>
          <small>{nextAnniversary?.title || '去添加一个吧'}</small>
        </div>
        <div className="stat-card">
          <span>未使用卡券</span>
          <strong>{unusedCoupons.length}</strong>
          <small>{STATUS_TEXT.unused}</small>
        </div>
      </section>

      <section className="card">
        <h3>最近留言</h3>
        {latestMessage ? (
          <div className="soft-panel">
            <p>{latestMessage.content}</p>
            <small>{latestMessage.senderName} · {formatTime(latestMessage.createdAt)}</small>
          </div>
        ) : (
          <p className="empty">还没有留言。</p>
        )}
      </section>
    </div>
  )
}
