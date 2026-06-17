import { ROLE_OPTIONS } from '../config'
import type { Anniversary, AppData, Coupon, CouponStatus, RoleKey, Session } from '../types'

const DATA_KEY = 'webLoveData'
const SESSION_KEY = 'webLoveSession'

function now() {
  return new Date().toISOString()
}

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function defaultData(): AppData {
  return {
    users: ROLE_OPTIONS.map((role) => ({
      id: `user_${role.key}`,
      openid: `local_${role.key}`,
      roleKey: role.key,
      displayName: role.label,
      nickName: role.label,
      avatarUrl: '',
      birthday: '',
      createdAt: now(),
      updatedAt: now()
    })),
    anniversaries: [
      {
        id: 'anniversary_meet',
        title: '我们相识的日子',
        date: '2024-01-01',
        type: 'meet',
        creatorOpenid: 'local_xiaoqiu',
        creatorName: '小邱同学',
        createdAt: now(),
        updatedAt: now()
      }
    ],
    messages: [
      {
        id: 'message_welcome',
        content: '这里是网页版本地留言，导出备份后可以发给对方导入。',
        senderOpenid: 'local_xiaoqiu',
        senderName: '小邱同学',
        pinned: false,
        readBy: ['local_xiaoqiu'],
        createdAt: now(),
        updatedAt: now()
      }
    ],
    coupons: [
      {
        id: 'coupon_demo',
        title: '奶茶券',
        description: '网页版本地测试用卡券',
        expireDate: '',
        status: 'unused',
        creatorOpenid: 'local_xiaoqiu',
        creatorName: '小邱同学',
        receiverOpenid: 'local_xiaolong',
        receiverName: '小龙哥哥',
        useRequesterOpenid: '',
        confirmOpenid: '',
        createdAt: now(),
        updatedAt: now()
      }
    ]
  }
}

function safeParse<T>(value: string | null) {
  if (!value) return null

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function normalizeData(data: Partial<AppData> | null): AppData {
  const fallback = defaultData()

  return {
    users: Array.isArray(data?.users) ? data.users : fallback.users,
    anniversaries: Array.isArray(data?.anniversaries) ? data.anniversaries : fallback.anniversaries,
    messages: Array.isArray(data?.messages) ? data.messages : fallback.messages,
    coupons: Array.isArray(data?.coupons) ? data.coupons : fallback.coupons
  }
}

export function loadData() {
  const data = normalizeData(safeParse<Partial<AppData>>(localStorage.getItem(DATA_KEY)))
  localStorage.setItem(DATA_KEY, JSON.stringify(data))
  return data
}

export function saveData(data: AppData) {
  localStorage.setItem(DATA_KEY, JSON.stringify(data))
}

export function getSession() {
  return safeParse<Session>(localStorage.getItem(SESSION_KEY))
}

export function setSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

export function resetData() {
  const data = defaultData()
  saveData(data)
  return data
}

export function exportData(data: AppData) {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: now(),
      data
    },
    null,
    2
  )
}

export function importData(json: string) {
  const parsed = safeParse<unknown>(json)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('备份文件格式不正确')
  }

  const source = 'data' in parsed
    ? (parsed as { data?: Partial<AppData> }).data || null
    : parsed as Partial<AppData>
  const data = normalizeData(source)
  saveData(data)
  return data
}

export function login(roleKey: RoleKey) {
  const session: Session = {
    openid: `local_${roleKey}`,
    roleKey
  }
  setSession(session)
  return session
}

export function addAnniversary(data: AppData, title: string, date: string, session: Session): AppData {
  const user = data.users.find((item) => item.openid === session.openid)
  if (!user) return data
  const anniversary: Anniversary = {
    id: createId('anniversary'),
    title,
    date,
    type: title.includes('相识') ? 'meet' : 'custom',
    creatorOpenid: user.openid,
    creatorName: user.displayName,
    createdAt: now(),
    updatedAt: now()
  }

  return {
    ...data,
    anniversaries: [...data.anniversaries, anniversary]
  }
}

export function addMessage(data: AppData, content: string, session: Session): AppData {
  const user = data.users.find((item) => item.openid === session.openid)
  if (!user) return data

  return {
    ...data,
    messages: [
      {
        id: createId('message'),
        content,
        senderOpenid: user.openid,
        senderName: user.displayName,
        pinned: false,
        readBy: [user.openid],
        createdAt: now(),
        updatedAt: now()
      },
      ...data.messages
    ]
  }
}

export function markMessagesRead(data: AppData, session: Session) {
  return {
    ...data,
    messages: data.messages.map((message) => {
      if (message.senderOpenid === session.openid || message.readBy.includes(session.openid)) {
        return message
      }

      return {
        ...message,
        readBy: [...message.readBy, session.openid],
        updatedAt: now()
      }
    })
  }
}

export function pinMessage(data: AppData, id: string) {
  return {
    ...data,
    messages: data.messages.map((message) => (
      message.id === id
        ? { ...message, pinned: true, updatedAt: now() }
        : message
    ))
  }
}

export function addCoupon(
  data: AppData,
  payload: Pick<Coupon, 'title' | 'description' | 'expireDate' | 'receiverOpenid' | 'receiverName'>,
  session: Session
): AppData {
  const user = data.users.find((item) => item.openid === session.openid)
  if (!user) return data
  const coupon: Coupon = {
    id: createId('coupon'),
    title: payload.title,
    description: payload.description,
    expireDate: payload.expireDate,
    status: 'unused',
    creatorOpenid: user.openid,
    creatorName: user.displayName,
    receiverOpenid: payload.receiverOpenid,
    receiverName: payload.receiverName,
    useRequesterOpenid: '',
    confirmOpenid: '',
    createdAt: now(),
    updatedAt: now()
  }

  return {
    ...data,
    coupons: [coupon, ...data.coupons]
  }
}

export function updateCouponStatus(data: AppData, id: string, status: CouponStatus, session: Session) {
  return {
    ...data,
    coupons: data.coupons.map((coupon) => {
      if (coupon.id !== id) return coupon

      if (status === 'pending') {
        return {
          ...coupon,
          status,
          useRequesterOpenid: session.openid,
          confirmOpenid: coupon.creatorOpenid,
          requestedAt: now(),
          updatedAt: now()
        }
      }

      if (status === 'used') {
        return {
          ...coupon,
          status,
          usedAt: now(),
          updatedAt: now()
        }
      }

      return {
        ...coupon,
        status,
        useRequesterOpenid: '',
        confirmOpenid: '',
        updatedAt: now()
      }
    })
  }
}
