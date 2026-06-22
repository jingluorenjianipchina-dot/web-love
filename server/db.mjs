import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { ROLE_OPTIONS } from './config.mjs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, 'data')
export const uploadsDir = path.join(dataDir, 'uploads')
const avatarDir = path.join(uploadsDir, 'avatars')
const dbPath = process.env.DB_PATH || path.join(dataDir, 'love.sqlite')
let db

function now() {
  return new Date().toISOString()
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function safeFilePart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_')
}

function saveAvatarDataUrl(openid, avatarUrl) {
  if (!avatarUrl || !String(avatarUrl).startsWith('data:image/')) {
    return avatarUrl
  }

  const match = String(avatarUrl).match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/)
  if (!match) return ''

  const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
  const fileName = `${safeFilePart(openid)}-${Date.now()}.${extension}`
  fs.mkdirSync(avatarDir, { recursive: true })
  fs.writeFileSync(path.join(avatarDir, fileName), Buffer.from(match[2], 'base64'))
  return `/api/uploads/avatars/${fileName}`
}

function persist() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
}

function rows(sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const result = []

  while (stmt.step()) {
    result.push(stmt.getAsObject())
  }

  stmt.free()
  return result
}

function row(sql, params = []) {
  return rows(sql, params)[0] || null
}

function run(sql, params = []) {
  db.run(sql, params)
  persist()
}

function parseJson(value, fallback) {
  if (!value) return fallback

  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function normalizeUser(item) {
  return {
    id: item.id,
    openid: item.openid,
    roleKey: item.role_key,
    displayName: item.display_name,
    nickName: item.nick_name,
    avatarUrl: item.avatar_url,
    birthday: item.birthday,
    createdAt: item.created_at,
    updatedAt: item.updated_at
  }
}

function normalizeAnniversary(item) {
  return {
    id: item.id,
    title: item.title,
    date: item.date,
    type: item.type,
    creatorOpenid: item.creator_openid,
    creatorName: item.creator_name,
    createdAt: item.created_at,
    updatedAt: item.updated_at
  }
}

function normalizeMessage(item) {
  return {
    id: item.id,
    content: item.content,
    senderOpenid: item.sender_openid,
    senderName: item.sender_name,
    pinned: Boolean(item.pinned),
    readBy: parseJson(item.read_by, []),
    createdAt: item.created_at,
    updatedAt: item.updated_at
  }
}

function normalizeCoupon(item) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    expireDate: item.expire_date,
    status: item.status,
    creatorOpenid: item.creator_openid,
    creatorName: item.creator_name,
    receiverOpenid: item.receiver_openid,
    receiverName: item.receiver_name,
    useRequesterOpenid: item.use_requester_openid,
    confirmOpenid: item.confirm_openid,
    requestedAt: item.requested_at || undefined,
    usedAt: item.used_at || undefined,
    createdAt: item.created_at,
    updatedAt: item.updated_at
  }
}

function createSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      openid TEXT UNIQUE NOT NULL,
      role_key TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      nick_name TEXT NOT NULL,
      avatar_url TEXT NOT NULL DEFAULT '',
      birthday TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS anniversaries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      creator_openid TEXT NOT NULL,
      creator_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      sender_openid TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      read_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      expire_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      creator_openid TEXT NOT NULL,
      creator_name TEXT NOT NULL,
      receiver_openid TEXT NOT NULL,
      receiver_name TEXT NOT NULL,
      use_requester_openid TEXT NOT NULL DEFAULT '',
      confirm_openid TEXT NOT NULL DEFAULT '',
      requested_at TEXT,
      used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  persist()
}

function seedData() {
  const userCount = row('SELECT COUNT(*) AS count FROM users').count

  if (userCount === 0) {
    ROLE_OPTIONS.forEach((role) => {
      db.run(
        `INSERT INTO users (
          id, openid, role_key, display_name, nick_name, avatar_url, birthday, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, '', '', ?, ?)`,
        [`user_${role.key}`, `local_${role.key}`, role.key, role.label, role.label, now(), now()]
      )
    })
  }

  const anniversaryCount = row('SELECT COUNT(*) AS count FROM anniversaries').count
  if (anniversaryCount === 0) {
    db.run(
      `INSERT INTO anniversaries (
        id, title, date, type, creator_openid, creator_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['anniversary_meet', '我们相识的日子', '2024-01-01', 'meet', 'local_xiaoqiu', '小邱同学', now(), now()]
    )
  }

  const messageCount = row('SELECT COUNT(*) AS count FROM messages').count
  if (messageCount === 0) {
    db.run(
      `INSERT INTO messages (
        id, content, sender_openid, sender_name, pinned, read_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'message_welcome',
        '这里是服务器数据库里的第一条留言。',
        'local_xiaoqiu',
        '小邱同学',
        0,
        JSON.stringify(['local_xiaoqiu']),
        now(),
        now()
      ]
    )
  }

  const couponCount = row('SELECT COUNT(*) AS count FROM coupons').count
  if (couponCount === 0) {
    db.run(
      `INSERT INTO coupons (
        id, title, description, expire_date, status, creator_openid, creator_name,
        receiver_openid, receiver_name, use_requester_openid, confirm_openid, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?)`,
      [
        'coupon_demo',
        '奶茶券',
        '服务器数据库测试用卡券',
        '',
        'unused',
        'local_xiaoqiu',
        '小邱同学',
        'local_xiaolong',
        '小龙哥哥',
        now(),
        now()
      ]
    )
  }

  persist()
}

function migrateBase64Avatars() {
  const users = rows(`SELECT openid, avatar_url FROM users WHERE avatar_url LIKE 'data:image/%'`)
  if (!users.length) return

  users.forEach((user) => {
    const avatarUrl = saveAvatarDataUrl(user.openid, user.avatar_url)
    db.run('UPDATE users SET avatar_url = ?, updated_at = ? WHERE openid = ?', [avatarUrl, now(), user.openid])
  })
  persist()
}

export async function initDb() {
  fs.mkdirSync(dataDir, { recursive: true })
  const SQL = await initSqlJs({
    locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm')
  })
  db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database()

  createSchema()
  seedData()
  migrateBase64Avatars()
}

export function getData() {
  return {
    users: rows('SELECT * FROM users ORDER BY role_key').map(normalizeUser),
    anniversaries: rows('SELECT * FROM anniversaries ORDER BY date ASC').map(normalizeAnniversary),
    messages: rows('SELECT * FROM messages ORDER BY pinned DESC, created_at DESC').map(normalizeMessage),
    coupons: rows('SELECT * FROM coupons ORDER BY created_at DESC').map(normalizeCoupon)
  }
}

export function findUserByOpenid(openid) {
  const user = row('SELECT * FROM users WHERE openid = ?', [openid])
  return user ? normalizeUser(user) : null
}

export function login(roleKey, inviteCode) {
  const role = ROLE_OPTIONS.find((item) => item.key === roleKey)
  if (!role || String(inviteCode || '').trim().toUpperCase() !== role.inviteCode) {
    return null
  }

  const user = row('SELECT * FROM users WHERE role_key = ?', [role.key])
  return {
    openid: `local_${role.key}`,
    roleKey: role.key,
    user: user ? normalizeUser(user) : null
  }
}

export function updateUserProfile({ openid, nickName, avatarUrl }) {
  const user = findUserByOpenid(openid)
  if (!user) throw new Error('用户不存在')
  const nextAvatarUrl = saveAvatarDataUrl(openid, avatarUrl ?? user.avatarUrl)

  run(
    `UPDATE users
      SET nick_name = ?, avatar_url = ?, updated_at = ?
      WHERE openid = ?`,
    [nickName || user.nickName, nextAvatarUrl, now(), openid]
  )
  return getData()
}

export function addAnniversary({ title, date, openid }) {
  const user = findUserByOpenid(openid)
  if (!user) throw new Error('身份不存在')

  run(
    `INSERT INTO anniversaries (
      id, title, date, type, creator_openid, creator_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [createId('anniversary'), title, date, title.includes('相识') ? 'meet' : 'custom', user.openid, user.displayName, now(), now()]
  )
  return getData()
}

export function updateAnniversary({ id, title, date, openid }) {
  const user = findUserByOpenid(openid)
  if (!user) throw new Error('身份不存在')

  const existing = row('SELECT * FROM anniversaries WHERE id = ?', [id])
  if (!existing) throw new Error('纪念日不存在')

  run(
    `UPDATE anniversaries
      SET title = ?, date = ?, type = ?, updated_at = ?
      WHERE id = ?`,
    [title, date, title.includes('相识') ? 'meet' : 'custom', now(), id]
  )
  return getData()
}

export function addMessage({ content, openid }) {
  const user = findUserByOpenid(openid)
  if (!user) throw new Error('身份不存在')

  run(
    `INSERT INTO messages (
      id, content, sender_openid, sender_name, pinned, read_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [createId('message'), content, user.openid, user.displayName, 0, JSON.stringify([user.openid]), now(), now()]
  )
  return getData()
}

export function markMessagesRead(openid) {
  const messages = rows('SELECT * FROM messages')
  messages.forEach((message) => {
    if (message.sender_openid === openid) return
    const readBy = parseJson(message.read_by, [])
    if (readBy.includes(openid)) return

    run('UPDATE messages SET read_by = ?, updated_at = ? WHERE id = ?', [
      JSON.stringify([...readBy, openid]),
      now(),
      message.id
    ])
  })
  return getData()
}

export function pinMessage(id) {
  run('UPDATE messages SET pinned = 1, updated_at = ? WHERE id = ?', [now(), id])
  return getData()
}

export function setMessagePinned(id, pinned) {
  run('UPDATE messages SET pinned = ?, updated_at = ? WHERE id = ?', [pinned ? 1 : 0, now(), id])
  return getData()
}

export function updateMessage({ id, content }) {
  run('UPDATE messages SET content = ?, updated_at = ? WHERE id = ?', [content, now(), id])
  return getData()
}

export function deleteMessage(id) {
  run('DELETE FROM messages WHERE id = ?', [id])
  return getData()
}

export function addCoupon(payload) {
  const user = findUserByOpenid(payload.openid)
  const receiver = findUserByOpenid(payload.receiverOpenid)
  if (!user || !receiver) throw new Error('身份不存在')

  run(
    `INSERT INTO coupons (
      id, title, description, expire_date, status, creator_openid, creator_name,
      receiver_openid, receiver_name, use_requester_openid, confirm_openid, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'unused', ?, ?, ?, ?, '', '', ?, ?)`,
    [
      createId('coupon'),
      payload.title,
      payload.description || '',
      payload.expireDate || '',
      user.openid,
      user.displayName,
      receiver.openid,
      receiver.displayName,
      now(),
      now()
    ]
  )
  return getData()
}

export function updateCouponStatus({ id, status, openid }) {
  const coupon = row('SELECT * FROM coupons WHERE id = ?', [id])
  if (!coupon) throw new Error('卡券不存在')

  if (status === 'pending') {
    run(
      `UPDATE coupons SET status = 'pending', use_requester_openid = ?, confirm_openid = ?,
        requested_at = ?, updated_at = ? WHERE id = ?`,
      [openid, coupon.creator_openid, now(), now(), id]
    )
    return getData()
  }

  if (status === 'used') {
    run(
      `UPDATE coupons SET status = 'used', used_at = ?, updated_at = ? WHERE id = ?`,
      [now(), now(), id]
    )
    return getData()
  }

  run(
    `UPDATE coupons SET status = ?, use_requester_openid = '', confirm_openid = '',
      requested_at = NULL, updated_at = ? WHERE id = ?`,
    [status, now(), id]
  )
  return getData()
}

export function replaceData(data) {
  db.run('DELETE FROM coupons')
  db.run('DELETE FROM messages')
  db.run('DELETE FROM anniversaries')
  db.run('DELETE FROM users')

  data.users.forEach((user) => {
    db.run(
      `INSERT INTO users (
        id, openid, role_key, display_name, nick_name, avatar_url, birthday, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user.id, user.openid, user.roleKey, user.displayName, user.nickName, user.avatarUrl, user.birthday, user.createdAt, user.updatedAt]
    )
  })

  data.anniversaries.forEach((item) => {
    db.run(
      `INSERT INTO anniversaries (
        id, title, date, type, creator_openid, creator_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.id, item.title, item.date, item.type, item.creatorOpenid, item.creatorName, item.createdAt, item.updatedAt]
    )
  })

  data.messages.forEach((message) => {
    db.run(
      `INSERT INTO messages (
        id, content, sender_openid, sender_name, pinned, read_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [message.id, message.content, message.senderOpenid, message.senderName, message.pinned ? 1 : 0, JSON.stringify(message.readBy || []), message.createdAt, message.updatedAt]
    )
  })

  data.coupons.forEach((coupon) => {
    db.run(
      `INSERT INTO coupons (
        id, title, description, expire_date, status, creator_openid, creator_name,
        receiver_openid, receiver_name, use_requester_openid, confirm_openid,
        requested_at, used_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        coupon.id,
        coupon.title,
        coupon.description,
        coupon.expireDate,
        coupon.status,
        coupon.creatorOpenid,
        coupon.creatorName,
        coupon.receiverOpenid,
        coupon.receiverName,
        coupon.useRequesterOpenid,
        coupon.confirmOpenid,
        coupon.requestedAt || null,
        coupon.usedAt || null,
        coupon.createdAt,
        coupon.updatedAt
      ]
    )
  })

  persist()
  return getData()
}

export function resetData() {
  db.run('DELETE FROM coupons')
  db.run('DELETE FROM messages')
  db.run('DELETE FROM anniversaries')
  db.run('DELETE FROM users')
  persist()
  seedData()
  return getData()
}
