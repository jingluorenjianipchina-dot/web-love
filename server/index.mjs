import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import {
  addAnniversary,
  addAlbum,
  addCoupon,
  addMessage,
  addRoom,
  addVideoRecord,
  deleteAlbum,
  deleteMessage,
  deleteVideo,
  findUserByOpenid,
  findVideoByFilename,
  getActiveRoom,
  getData,
  getMessageSenderOpenid,
  getRoom,
  getRoomMessages,
  getVideo,
  getWxOpenid,
  initDb,
  login,
  markMessagesRead,
  pinMessage,
  purgeWatchData,
  replaceData,
  resetData,
  setMessagePinned,
  setRoomStatus,
  setVideoStatus,
  setWxOpenid,
  uploadsDir,
  updateMessage,
  updateAnniversary,
  updateCouponStatus,
  updateUserProfile,
  videoDir
} from './db.mjs'
import {
  checkImageDataUrl,
  checkText,
  codeToSession,
  decryptPushMessage,
  isContentSecurityConfigured,
  submitMediaCheck,
  verifyPushSignature
} from './wechat-security.mjs'
import { setupWatchServer } from './watch-server.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const app = express()
const port = Number(process.env.PORT || 3001)

app.use(cors())
app.use(express.json({ limit: '10mb' }))

const publicBaseUrl = (process.env.PUBLIC_BASE_URL || 'https://lxl-qwx.xyz').replace(/\/$/, '')
const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_BYTES) || 1024 * 1024 * 1024

const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov']
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(videoDir, { recursive: true })
      cb(null, videoDir)
    },
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '.mp4').toLowerCase()
      cb(null, `video_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`)
    }
  }),
  limits: { fileSize: MAX_VIDEO_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()
    if (!VIDEO_EXTENSIONS.includes(ext)) {
      cb(new Error('仅支持 MP4 / M4V / MOV 格式的视频'))
      return
    }
    cb(null, true)
  }
})

// 视频门禁：rejected 一律 404；ready 正常播放；checking 期间需放行给微信检测爬虫
app.use('/api/uploads/videos', (req, res, next) => {
  const video = findVideoByFilename(path.basename(req.path))
  if (!video || video.status === 'rejected') {
    res.status(404).json({ message: '视频不存在或未通过安全检测' })
    return
  }
  next()
})

app.use('/api/uploads', express.static(uploadsDir, {
  immutable: true,
  maxAge: '365d'
}))

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res)
    } catch (error) {
      next(error)
    }
  }
}

// 内容安全检测：不通过时直接以 400 + 提示语返回，两个前端都会展示该提示
async function guardText(res, text, { openid = '', scene = 2, label = 'text' } = {}) {
  const verdict = await checkText(text, {
    wxOpenid: openid ? getWxOpenid(openid) : '',
    scene,
    label
  })
  if (!verdict.ok) {
    res.status(400).json({ message: verdict.message })
    return false
  }
  return true
}

async function guardImage(res, imageUrl, { label = 'image' } = {}) {
  const verdict = await checkImageDataUrl(imageUrl, { label })
  if (!verdict.ok) {
    res.status(400).json({ message: verdict.message })
    return false
  }
  return true
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/login', (req, res) => {
  const result = login(req.body.roleKey, req.body.inviteCode)
  if (!result) {
    res.status(401).json({ message: '身份或邀请码不正确' })
    return
  }

  res.json({
    session: {
      openid: result.openid,
      roleKey: result.roleKey
    },
    data: getData()
  })
})

app.get('/api/data', (_req, res) => {
  res.json(getData())
})

app.get('/api/server-date', (_req, res) => {
  res.json({ date: new Date().toISOString().slice(0, 10) })
})

// 小程序登录后静默调用：wx.login 的 code 换真实 openid 并绑定到当前身份，
// 供 msgSecCheck 2.0 使用。登录方式（身份+邀请码）不受影响。
app.post('/api/wx/session', asyncRoute(async (req, res) => {
  const code = String(req.body.code || '').trim()
  const openid = String(req.body.openid || '').trim()

  if (!code || !openid) {
    res.status(400).json({ ok: false, message: '缺少 code 或 openid' })
    return
  }
  if (!isContentSecurityConfigured()) {
    res.json({ ok: false, message: '内容安全未配置' })
    return
  }

  try {
    const wxOpenid = await codeToSession(code)
    setWxOpenid(openid, wxOpenid)
    console.log(`[content-security] openid 绑定成功：${openid} → ${wxOpenid}`)
    res.json({ ok: true })
  } catch (error) {
    console.warn(`[content-security] openid 绑定失败：${error.message}`)
    res.status(400).json({ ok: false, message: error.message })
  }
}))

app.post('/api/users/:openid/profile', asyncRoute(async (req, res) => {
  const nickName = String(req.body.nickName || '').trim()

  if (!nickName) {
    res.status(400).json({ message: '昵称不能为空' })
    return
  }
  if (!(await guardText(res, nickName, { openid: req.params.openid, scene: 1, label: '昵称' }))) {
    return
  }
  if (!(await guardImage(res, req.body.avatarUrl, { label: '头像' }))) {
    return
  }

  res.json(updateUserProfile({
    openid: req.params.openid,
    nickName,
    avatarUrl: req.body.avatarUrl
  }))
}))

app.post('/api/anniversaries', asyncRoute(async (req, res) => {
  const title = String(req.body.title || '').trim()
  const date = String(req.body.date || '').trim()

  if (!title || !date) {
    res.status(400).json({ message: '纪念日标题和日期不能为空' })
    return
  }
  if (!(await guardText(res, title, { openid: req.body.openid, label: '纪念日标题' }))) {
    return
  }

  res.json(addAnniversary({ title, date, openid: req.body.openid }))
}))

app.post('/api/anniversaries/:id', asyncRoute(async (req, res) => {
  const title = String(req.body.title || '').trim()
  const date = String(req.body.date || '').trim()

  if (!title || !date) {
    res.status(400).json({ message: '纪念日标题和日期不能为空' })
    return
  }
  if (!(await guardText(res, title, { openid: req.body.openid, label: '纪念日标题' }))) {
    return
  }

  res.json(updateAnniversary({
    id: req.params.id,
    title,
    date,
    openid: req.body.openid
  }))
}))

app.post('/api/messages', asyncRoute(async (req, res) => {
  const content = String(req.body.content || '').trim()

  if (!content) {
    res.status(400).json({ message: '留言内容不能为空' })
    return
  }
  if (!(await guardText(res, content, { openid: req.body.openid, label: '留言' }))) {
    return
  }

  res.json(addMessage({ content, openid: req.body.openid }))
}))

app.post('/api/messages/read', (req, res) => {
  res.json(markMessagesRead(req.body.openid))
})

app.post('/api/messages/:id/pin', (req, res) => {
  const pinned = req.body?.pinned
  if (typeof pinned === 'boolean') {
    res.json(setMessagePinned(req.params.id, pinned))
    return
  }
  res.json(pinMessage(req.params.id))
})

app.post('/api/messages/:id/update', asyncRoute(async (req, res) => {
  const content = String(req.body.content || '').trim()
  if (!content) {
    res.status(400).json({ message: '留言内容不能为空' })
    return
  }

  // 优先用请求方 openid；老版本前端不带 openid 时退回留言发送者
  const checkOpenid = String(req.body.openid || '').trim() || getMessageSenderOpenid(req.params.id)
  if (!(await guardText(res, content, { openid: checkOpenid, label: '修改留言' }))) {
    return
  }

  res.json(updateMessage({
    id: req.params.id,
    content
  }))
}))

app.delete('/api/messages/:id', (req, res) => {
  res.json(deleteMessage(req.params.id))
})

app.post('/api/coupons', asyncRoute(async (req, res) => {
  const title = String(req.body.title || '').trim()

  if (!title) {
    res.status(400).json({ message: '卡券名称不能为空' })
    return
  }
  if (!(await guardText(res, title, { openid: req.body.openid, label: '卡券名称' }))) {
    return
  }

  const description = String(req.body.description || '').trim()
  if (!(await guardText(res, description, { openid: req.body.openid, label: '卡券说明' }))) {
    return
  }

  res.json(addCoupon({
    title,
    description,
    expireDate: String(req.body.expireDate || ''),
    receiverOpenid: req.body.receiverOpenid,
    openid: req.body.openid
  }))
}))

app.post('/api/coupons/:id/status', (req, res) => {
  res.json(updateCouponStatus({
    id: req.params.id,
    status: req.body.status,
    openid: req.body.openid
  }))
})

app.post('/api/albums', asyncRoute(async (req, res) => {
  const imageUrl = String(req.body.imageUrl || '')
  if (!imageUrl) {
    res.status(400).json({ message: '照片不能为空' })
    return
  }

  const title = String(req.body.title || '').trim()
  if (!(await guardText(res, title, { openid: req.body.openid, label: '相册标题' }))) {
    return
  }

  const description = String(req.body.description || '').trim()
  if (!(await guardText(res, description, { openid: req.body.openid, label: '相册说明' }))) {
    return
  }

  if (!(await guardImage(res, imageUrl, { label: '相册照片' }))) {
    return
  }

  res.json(addAlbum({
    title,
    description,
    imageUrl,
    memoryDate: String(req.body.memoryDate || '').trim(),
    openid: req.body.openid
  }))
}))

app.delete('/api/albums/:id', (req, res) => {
  res.json(deleteAlbum(req.params.id))
})

// ---------- 一起看：视频上传 / 房间 ----------

app.post('/api/videos', (req, res, next) => {
  videoUpload.single('file')(req, res, (error) => {
    if (!error) {
      next()
      return
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ message: '视频超过 1GB 限制' })
      return
    }
    res.status(400).json({ message: error.message || '视频上传失败' })
  })
}, asyncRoute(async (req, res) => {
  const file = req.file
  if (!file) {
    res.status(400).json({ message: '视频文件不能为空' })
    return
  }

  const openid = String(req.body.openid || '').trim()
  const title = String(req.body.title || '').trim()

  const cleanupFile = () => { try { fs.unlinkSync(file.path) } catch {} }

  if (!(await guardText(res, title, { openid, label: '视频标题' }))) {
    cleanupFile()
    return
  }
  if (!findUserByOpenid(openid)) {
    cleanupFile()
    res.status(400).json({ message: '身份不存在' })
    return
  }

  const videoId = `video_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const checking = isContentSecurityConfigured()
  addVideoRecord({
    id: videoId,
    title,
    filename: file.filename,
    sizeBytes: file.size,
    openid,
    status: checking ? 'checking' : 'ready'
  })

  if (checking) {
    const mediaUrl = `${publicBaseUrl}/api/uploads/videos/${file.filename}`
    const result = await submitMediaCheck({
      mediaUrl,
      openid: getWxOpenid(openid),
      traceId: videoId
    })
    if (result.skipped || !result.ok) {
      if (!result.skipped) {
        console.warn(`[content-security] mediaCheckAsync 提交失败（${result.errcode} ${result.errmsg}），兜底放行`)
      }
      setVideoStatus(videoId, 'ready')
    }
  }

  console.log(`[watch] 视频上传成功 ${videoId}（${file.size} 字节）`)
  res.json(getData())
}))

app.delete('/api/videos/:id', asyncRoute(async (req, res) => {
  res.json(deleteVideo(req.params.id))
}))

app.post('/api/rooms', asyncRoute(async (req, res) => {
  const videoId = String(req.body.videoId || '').trim()
  const openid = String(req.body.openid || '').trim()

  const video = getVideo(videoId)
  if (!video || video.status !== 'ready') {
    res.status(400).json({ message: '视频不可用' })
    return
  }

  const existing = getActiveRoom()
  if (!existing) {
    addRoom({ videoId, openid })
  }
  res.json(getData())
}))

app.post('/api/rooms/:id/finish', asyncRoute(async (req, res) => {
  setRoomStatus(req.params.id, 'finished')
  res.json(getData())
}))

app.get('/api/rooms/:id/messages', (req, res) => {
  res.json({ messages: getRoomMessages(req.params.id) })
})

// 微信消息推送：GET 为 URL 验证握手，POST 接收 mediaCheckAsync 检测结果
app.get('/api/wx/push', (req, res) => {
  if (!verifyPushSignature(req.query)) {
    res.status(403).send('forbidden')
    return
  }
  res.send(String(req.query.echostr || ''))
})

app.post('/api/wx/push', asyncRoute(async (req, res) => {
  let event = req.body
  try {
    if (event && typeof event.Encrypt === 'string') {
      if (!verifyPushSignature(req.query, event.Encrypt)) {
        res.status(403).send('forbidden')
        return
      }
      event = JSON.parse(decryptPushMessage(event.Encrypt).message)
    }

    if (event && event.Event === 'wxa_media_check') {
      const video = getVideo(String(event.trace_id || ''))
      const suggest = event.result && event.result.suggest
      console.log(`[content-security] mediaCheckAsync 回调 trace_id=${event.trace_id} suggest=${suggest}`)
      if (video && video.status === 'checking') {
        if (suggest === 'pass') {
          setVideoStatus(video.id, 'ready')
        } else {
          setVideoStatus(video.id, 'rejected')
          try { fs.unlinkSync(path.join(videoDir, video.filename)) } catch {}
        }
      }
    }
  } catch (error) {
    console.warn(`[content-security] 消息推送处理失败：${error.message}`)
  }
  res.send('success')
}))

app.get('/api/export', (_req, res) => {
  res.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    data: getData()
  })
})

app.post('/api/import', (req, res) => {
  const source = req.body?.data || req.body
  res.json(replaceData(source))
})

app.post('/api/reset', (_req, res) => {
  res.json(resetData())
})

app.use(express.static(distDir))
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    next()
    return
  }

  res.sendFile(path.join(distDir, 'index.html'))
})

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({
    message: error instanceof Error ? error.message : '服务器错误'
  })
})

const server = http.createServer(app)
setupWatchServer(server)

await initDb()
console.log(`[content-security] ${isContentSecurityConfigured() ? '内容安全检测已启用' : '内容安全检测未启用（未配置 WECHAT_APPID/WECHAT_SECRET，UGC 会直接放行）'}`)
try {
  const removed = purgeWatchData()
  if (removed.videos || removed.rooms) {
    console.log(`[watch] 启动清理：删除视频 ${removed.videos} 个、过期房间 ${removed.rooms} 个`)
  }
} catch (error) {
  console.warn(`[watch] 启动清理失败：${error.message}`)
}
setInterval(() => {
  try {
    purgeWatchData()
  } catch (error) {
    console.warn(`[watch] 定时清理失败：${error.message}`)
  }
}, 60 * 60 * 1000)

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
