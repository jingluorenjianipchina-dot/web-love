import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { ROLE_OPTIONS } from './config.mjs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
// DATA_DIR 可把数据目录（数据库+上传文件）搬到项目外，
// 本地开发时避免开发者工具监听到文件变化而反复重编译小程序
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data')
export const uploadsDir = path.join(dataDir, 'uploads')
const avatarDir = path.join(uploadsDir, 'avatars')
const albumDir = path.join(uploadsDir, 'albums')
const videoDir = path.join(uploadsDir, 'videos')
export { videoDir }
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

function saveImageDataUrl(folder, urlPrefix, filePrefix, imageUrl) {
  if (!imageUrl || !String(imageUrl).startsWith('data:image/')) {
    return imageUrl
  }

  const match = String(imageUrl).match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/)
  if (!match) return ''

  const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
  const fileName = `${safeFilePart(filePrefix)}-${Date.now()}.${extension}`
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(path.join(folder, fileName), Buffer.from(match[2], 'base64'))
  return `${urlPrefix}/${fileName}`
}

function saveAvatarDataUrl(openid, avatarUrl) {
  return saveImageDataUrl(avatarDir, '/api/uploads/avatars', openid, avatarUrl)
}

function saveAlbumDataUrl(openid, imageUrl) {
  return saveImageDataUrl(albumDir, '/api/uploads/albums', openid, imageUrl)
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

function normalizeAlbum(item) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    imageUrl: item.image_url,
    memoryDate: item.memory_date,
    creatorOpenid: item.creator_openid,
    creatorName: item.creator_name,
    createdAt: item.created_at,
    updatedAt: item.updated_at
  }
}

function normalizeVideo(item) {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    url: `/api/uploads/videos/${item.filename}`,
    sizeBytes: item.size_bytes,
    creatorOpenid: item.creator_openid,
    creatorName: item.creator_name,
    createdAt: item.created_at,
    updatedAt: item.updated_at
  }
}

function normalizeRoom(item) {
  return {
    id: item.id,
    videoId: item.video_id,
    videoTitle: item.video_title,
    videoStatus: item.video_status,
    status: item.status,
    initiatorOpenid: item.initiator_openid,
    initiatorName: item.initiator_name,
    createdAt: item.created_at,
    finishedAt: item.finished_at || undefined
  }
}

function normalizeRoomMessage(item) {
  return {
    id: item.id,
    roomId: item.room_id,
    senderOpenid: item.sender_openid,
    senderName: item.sender_name,
    content: item.content,
    createdAt: item.created_at
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
      wx_openid TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL,
      memory_date TEXT NOT NULL DEFAULT '',
      creator_openid TEXT NOT NULL,
      creator_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      filename TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      creator_openid TEXT NOT NULL,
      creator_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      status TEXT NOT NULL,
      initiator_openid TEXT NOT NULL,
      initiator_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS room_messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      sender_openid TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
  persist()
}

// 老库没有 wx_openid 列时自动补上（存真实微信 openid，供内容安全检测使用）
function ensureWxOpenidColumn() {
  const result = db.exec('PRAGMA table_info(users)')
  const columns = result[0] ? result[0].values.map((entry) => entry[1]) : []
  if (columns.length && !columns.includes('wx_openid')) {
    db.run(`ALTER TABLE users ADD COLUMN wx_openid TEXT NOT NULL DEFAULT ''`)
    persist()
  }
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
  ensureWxOpenidColumn()
  seedData()
  migrateBase64Avatars()
}

export function getData() {
  return {
    users: rows('SELECT * FROM users ORDER BY role_key').map(normalizeUser),
    anniversaries: rows('SELECT * FROM anniversaries ORDER BY date ASC').map(normalizeAnniversary),
    messages: rows('SELECT * FROM messages ORDER BY pinned DESC, created_at DESC').map(normalizeMessage),
    coupons: rows('SELECT * FROM coupons ORDER BY created_at DESC').map(normalizeCoupon),
    albums: rows('SELECT * FROM albums ORDER BY memory_date DESC, created_at DESC').map(normalizeAlbum),
    videos: rows('SELECT * FROM videos ORDER BY created_at DESC').map(normalizeVideo),
    rooms: rows(`
      SELECT rooms.*, videos.title AS video_title, videos.status AS video_status
      FROM rooms LEFT JOIN videos ON videos.id = rooms.video_id
      ORDER BY rooms.created_at DESC
    `).map(normalizeRoom)
  }
}

export function findUserByOpenid(openid) {
  const user = row('SELECT * FROM users WHERE openid = ?', [openid])
  return user ? normalizeUser(user) : null
}

export function setWxOpenid(openid, wxOpenid) {
  const user = row('SELECT id FROM users WHERE openid = ?', [openid])
  if (!user) throw new Error('用户不存在')

  run('UPDATE users SET wx_openid = ?, updated_at = ? WHERE openid = ?', [wxOpenid, now(), openid])
  return true
}

export function getWxOpenid(openid) {
  const user = row('SELECT wx_openid FROM users WHERE openid = ?', [openid])
  return (user && user.wx_openid) || ''
}

export function getMessageSenderOpenid(id) {
  const message = row('SELECT sender_openid FROM messages WHERE id = ?', [id])
  return (message && message.sender_openid) || ''
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

export function addAlbum(payload) {
  const user = findUserByOpenid(payload.openid)
  if (!user) throw new Error('身份不存在')

  const imageUrl = saveAlbumDataUrl(user.openid, payload.imageUrl)
  if (!imageUrl) throw new Error('照片不能为空')

  run(
    `INSERT INTO albums (
      id, title, description, image_url, memory_date, creator_openid, creator_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      createId('album'),
      payload.title || '',
      payload.description || '',
      imageUrl,
      payload.memoryDate || new Date().toISOString().slice(0, 10),
      user.openid,
      user.displayName,
      now(),
      now()
    ]
  )
  return getData()
}

export function deleteAlbum(id) {
  run('DELETE FROM albums WHERE id = ?', [id])
  return getData()
}

// ---------- 一起看：视频 / 房间 ----------

export function addVideoRecord({ id, title, filename, sizeBytes, openid, status }) {
  const user = findUserByOpenid(openid)
  if (!user) throw new Error('身份不存在')

  run(
    `INSERT INTO videos (
      id, title, filename, status, size_bytes, creator_openid, creator_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, title || '', filename, status, sizeBytes || 0, user.openid, user.displayName, now(), now()]
  )
  return row('SELECT * FROM videos WHERE id = ?', [id])
}

export function getVideo(id) {
  return row('SELECT * FROM videos WHERE id = ?', [id])
}

export function findVideoByFilename(filename) {
  return row('SELECT * FROM videos WHERE filename = ?', [filename])
}

export function setVideoStatus(id, status) {
  run('UPDATE videos SET status = ?, updated_at = ? WHERE id = ?', [status, now(), id])
}

export function deleteVideo(id) {
  const video = getVideo(id)
  if (video) {
    // 同步结束引用该视频的未完成房间，避免出现指向已删视频的“幽灵房间”
    run(
      `UPDATE rooms SET status = 'finished', updated_at = ?, finished_at = ?
        WHERE video_id = ? AND status IN ('waiting', 'active')`,
      [now(), now(), id]
    )
    try { fs.unlinkSync(path.join(videoDir, video.filename)) } catch {}
    run('DELETE FROM videos WHERE id = ?', [id])
  }
  return getData()
}

export function getActiveRoom() {
  return row(`SELECT rooms.*, videos.title AS video_title, videos.status AS video_status
    FROM rooms LEFT JOIN videos ON videos.id = rooms.video_id
    WHERE rooms.status IN ('waiting', 'active') LIMIT 1`)
}

export function addRoom({ videoId, openid }) {
  const user = findUserByOpenid(openid)
  if (!user) throw new Error('身份不存在')

  const id = createId('room')
  run(
    `INSERT INTO rooms (
      id, video_id, status, initiator_openid, initiator_name, created_at, updated_at, finished_at
    ) VALUES (?, ?, 'waiting', ?, ?, ?, ?, NULL)`,
    [id, videoId, user.openid, user.displayName, now(), now()]
  )
  return getRoom(id)
}

export function getRoom(id) {
  return row(`SELECT rooms.*, videos.title AS video_title, videos.status AS video_status
    FROM rooms LEFT JOIN videos ON videos.id = rooms.video_id
    WHERE rooms.id = ?`, [id])
}

export function setRoomStatus(id, status) {
  const finishedAt = status === 'finished' ? now() : null
  run('UPDATE rooms SET status = ?, updated_at = ?, finished_at = ? WHERE id = ?', [status, now(), finishedAt, id])
}

export function addRoomMessage({ roomId, openid, content }) {
  const user = findUserByOpenid(openid)
  if (!user) throw new Error('身份不存在')

  const message = {
    id: createId('roommsg'),
    room_id: roomId,
    sender_openid: user.openid,
    sender_name: user.displayName,
    content,
    created_at: now()
  }
  run(
    `INSERT INTO room_messages (id, room_id, sender_openid, sender_name, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [message.id, message.room_id, message.sender_openid, message.sender_name, message.content, message.created_at]
  )
  return normalizeRoomMessage(message)
}

export function getRoomMessages(roomId) {
  return rows('SELECT * FROM room_messages WHERE room_id = ? ORDER BY created_at ASC', [roomId]).map(normalizeRoomMessage)
}

export function deleteRoomMessages(roomId) {
  run('DELETE FROM room_messages WHERE room_id = ?', [roomId])
}

// 定期清理：已看完 72 小时删视频，房间+聊天保留 7 天，检测卡住超 24h 的视频放行兜底
export function purgeWatchData() {
  const nowMs = Date.now()
  const VIDEO_TTL_MS = 72 * 60 * 60 * 1000
  const ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000
  const CHECK_STUCK_MS = 24 * 60 * 60 * 1000
  const removed = { videos: 0, rooms: 0 }

  rows(`SELECT * FROM rooms WHERE status = 'finished' AND finished_at IS NOT NULL`).forEach((room) => {
    const finishedMs = Date.parse(room.finished_at)
    if (Number.isNaN(finishedMs)) return

    if (nowMs - finishedMs >= VIDEO_TTL_MS && room.video_id) {
      const video = getVideo(room.video_id)
      if (video) {
        try { fs.unlinkSync(path.join(videoDir, video.filename)) } catch {}
        run('DELETE FROM videos WHERE id = ?', [video.id])
        removed.videos += 1
      }
    }

    if (nowMs - finishedMs >= ROOM_TTL_MS) {
      deleteRoomMessages(room.id)
      run('DELETE FROM rooms WHERE id = ?', [room.id])
      removed.rooms += 1
    }
  })

  rows(`SELECT * FROM videos WHERE status = 'rejected'`).forEach((video) => {
    if (nowMs - Date.parse(video.updated_at) >= ROOM_TTL_MS) {
      try { fs.unlinkSync(path.join(videoDir, video.filename)) } catch {}
      run('DELETE FROM videos WHERE id = ?', [video.id])
      removed.videos += 1
    }
  })

  rows(`SELECT * FROM videos WHERE status = 'checking'`).forEach((video) => {
    if (nowMs - Date.parse(video.updated_at) >= CHECK_STUCK_MS) {
      console.warn(`[content-security] 视频检测结果超 24h 未回（${video.id}），兜底放行`)
      setVideoStatus(video.id, 'ready')
    }
  })

  return removed
}

export function replaceData(data) {
  db.run('DELETE FROM albums')
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

  ;(data.albums || []).forEach((album) => {
    db.run(
      `INSERT INTO albums (
        id, title, description, image_url, memory_date, creator_openid, creator_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        album.id,
        album.title || '',
        album.description || '',
        album.imageUrl,
        album.memoryDate || '',
        album.creatorOpenid,
        album.creatorName,
        album.createdAt,
        album.updatedAt
      ]
    )
  })

  persist()
  return getData()
}

export function resetData() {
  db.run('DELETE FROM albums')
  db.run('DELETE FROM coupons')
  db.run('DELETE FROM messages')
  db.run('DELETE FROM anniversaries')
  db.run('DELETE FROM users')
  persist()
  seedData()
  return getData()
}
