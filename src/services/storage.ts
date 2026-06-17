import type { AppData, Coupon, CouponStatus, RoleKey, Session } from '../types'

const SESSION_KEY = 'webLoveSession'

function safeParse<T>(value: string | null) {
  if (!value) return null

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

async function request<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: '请求失败' }))
    throw new Error(error.message || '请求失败')
  }

  return response.json() as Promise<T>
}

export function loadData() {
  return request<AppData>('/api/data')
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
  return request<AppData>('/api/reset', { method: 'POST' })
}

export function exportData(data: AppData) {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
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

  return request<AppData>('/api/import', {
    method: 'POST',
    body: JSON.stringify(parsed)
  })
}

export async function login(roleKey: RoleKey, inviteCode: string) {
  const result = await request<{ session: Session; data: AppData }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ roleKey, inviteCode })
  })
  const session = result.session
  setSession(session)
  return result
}

export function addAnniversary(_data: AppData, title: string, date: string, session: Session) {
  return request<AppData>('/api/anniversaries', {
    method: 'POST',
    body: JSON.stringify({ title, date, openid: session.openid })
  })
}

export function addMessage(_data: AppData, content: string, session: Session) {
  return request<AppData>('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ content, openid: session.openid })
  })
}

export function markMessagesRead(_data: AppData, session: Session) {
  return request<AppData>('/api/messages/read', {
    method: 'POST',
    body: JSON.stringify({ openid: session.openid })
  })
}

export function pinMessage(_data: AppData, id: string) {
  return request<AppData>(`/api/messages/${id}/pin`, { method: 'POST' })
}

export function addCoupon(
  _data: AppData,
  payload: Pick<Coupon, 'title' | 'description' | 'expireDate' | 'receiverOpenid' | 'receiverName'>,
  session: Session
) {
  return request<AppData>('/api/coupons', {
    method: 'POST',
    body: JSON.stringify({ ...payload, openid: session.openid })
  })
}

export function updateCouponStatus(_data: AppData, id: string, status: CouponStatus, session: Session) {
  return request<AppData>(`/api/coupons/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, openid: session.openid })
  })
}
