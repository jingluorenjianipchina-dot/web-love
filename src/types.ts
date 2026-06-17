export type RoleKey = 'xiaoqiu' | 'xiaolong'

export type PageKey = 'home' | 'anniversaries' | 'messages' | 'coupons' | 'settings'

export type CouponStatus = 'unused' | 'pending' | 'used' | 'expired'

export interface RoleOption {
  key: RoleKey
  label: string
  inviteCode: string
}

export interface User {
  id: string
  openid: string
  roleKey: RoleKey
  displayName: string
  nickName: string
  avatarUrl: string
  birthday: string
  createdAt: string
  updatedAt: string
}

export interface Anniversary {
  id: string
  title: string
  date: string
  type: 'meet' | 'custom'
  creatorOpenid: string
  creatorName: string
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: string
  content: string
  senderOpenid: string
  senderName: string
  pinned: boolean
  readBy: string[]
  createdAt: string
  updatedAt: string
}

export interface Coupon {
  id: string
  title: string
  description: string
  expireDate: string
  status: CouponStatus
  creatorOpenid: string
  creatorName: string
  receiverOpenid: string
  receiverName: string
  useRequesterOpenid: string
  confirmOpenid: string
  requestedAt?: string
  usedAt?: string
  createdAt: string
  updatedAt: string
}

export interface AppData {
  users: User[]
  anniversaries: Anniversary[]
  messages: Message[]
  coupons: Coupon[]
}

export interface Session {
  openid: string
  roleKey: RoleKey
}
