import type { Anniversary } from '../types'

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function formatDate(date = new Date()) {
  const d = new Date(date)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toDateOnly(value: string | Date) {
  const date = new Date(value)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function diffDays(from: string | Date, to: string | Date) {
  const start = toDateOnly(from).getTime()
  const end = toDateOnly(to).getTime()
  return Math.ceil((end - start) / 86400000)
}

export function daysSince(date: string) {
  return Math.max(diffDays(date, new Date()), 0)
}

export function daysUntilNext(monthDay: string) {
  const now = new Date()
  const [month, day] = monthDay.split('-').map(Number)
  let target = new Date(now.getFullYear(), month - 1, day)

  if (toDateOnly(target).getTime() < toDateOnly(now).getTime()) {
    target = new Date(now.getFullYear() + 1, month - 1, day)
  }

  return diffDays(now, target)
}

export function anniversaryInfo(item: Anniversary) {
  const date = new Date(item.date)
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

  return {
    ...item,
    passedDays: daysSince(item.date),
    remainingDays: daysUntilNext(monthDay)
  }
}

export function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
