import type { RoleOption } from './types'

export const APP_NAME = '小邱同学&&小龙哥哥的专属空间'

export const ROLE_OPTIONS: RoleOption[] = [
  {
    key: 'xiaoqiu',
    label: '小邱同学',
    inviteCode: 'XIAOQIU'
  },
  {
    key: 'xiaolong',
    label: '小龙哥哥',
    inviteCode: 'XIAOLONG'
  }
]

export const DAILY_QUOTES = [
  '你来啦，今天也欢迎你。',
  '这是只属于我们的地方。',
  '有些话，慢慢说给你听。',
  '又是想分享给你的一天。',
  '今天也想把温柔留给你。',
  '愿今天有一点点刚好的开心。',
  '如果见不到面，也要记得被惦记着。',
  '把普通日子，藏成我们的特别记号。'
]

export const COUPON_TEMPLATES = [
  '请吃饭券',
  '电影券',
  '奶茶券',
  '陪聊天券',
  '道歉券',
  '任性券',
  '拥抱券',
  '选择餐厅券',
  '愿望实现券',
  '撒娇券',
  '反悔券',
  '和好券'
]

export const STATUS_TEXT = {
  unused: '未使用',
  pending: '待确认',
  used: '已使用',
  expired: '已过期'
} as const
