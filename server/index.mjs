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
  checkVideoFrames,
  checkVideoScanTooling,
  codeToSession,
  decryptPushMessage,
  faststartVideo,
  isContentSecurityConfigured,
  verifyPushSignature
} from './wechat-security.mjs'
import { getActiveWatchRoomIds, setupWatchServer } from './watch-server.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const app = express()
const port = Number(process.env.PORT || 3001)

app.use(cors())
app.use(express.json({ limit: '10mb' }))

const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_BYTES) || 2 * 1024 * 1024 * 1024
const CHUNK_SIZE = 10 * 1024 * 1024 // 分片上传：单片 10MB
const DIRECT_UPLOAD_LIMIT = 1024 * 1024 * 1024 // 整传上限 1GB（multer 兜底），更大的走分片
const tmpChunkDir = path.join(uploadsDir, '..', 'tmp')

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
  limits: { fileSize: DIRECT_UPLOAD_LIMIT },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()
    if (!VIDEO_EXTENSIONS.includes(ext)) {
      cb(new Error('仅支持 MP4 / M4V / MOV 格式的视频'))
      return
    }
    cb(null, true)
  }
})

// 分片接收：单片限制给足余量（业务单片 10MB，接收上限 25MB）。
// uploadId/index 走 URL query（multer 按 multipart 顺序解析，body 字段可能晚于 file 到达）
const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const uploadId = String(req.query.uploadId || '')
      if (!/^[A-Za-z0-9_-]+$/.test(uploadId)) {
        cb(new Error('uploadId 不合法'))
        return
      }
      const dir = path.join(tmpChunkDir, uploadId)
      fs.mkdirSync(dir, { recursive: true })
      cb(null, dir)
    },
    filename: (req, _file, cb) => {
      const index = Number(req.query.index)
      cb(null, `part-${Number.isInteger(index) && index >= 0 ? index : 'bad'}`)
    }
  }),
  limits: { fileSize: CHUNK_SIZE * 2.5 }
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

// 公共收尾：faststart 秒开 → 入库 ready → ffmpeg 抽帧检测（不通过则 rejected 并删文件）
async function finalizeVideoFile({ filePath, filename, sizeBytes, title, openid }) {
  await faststartVideo(filePath)

  const videoId = `video_${Date.now()}_${Math.random().toString(16).slice(2)}`
  addVideoRecord({
    id: videoId,
    title,
    filename,
    sizeBytes,
    openid,
    status: 'ready'
  })

  if (isContentSecurityConfigured()) {
    const verdict = await checkVideoFrames(filePath)
    if (!verdict.ok && !verdict.skipped) {
      setVideoStatus(videoId, 'rejected')
      try { fs.unlinkSync(filePath) } catch {}
      console.warn(`[content-security] 视频帧检测未通过，已拒绝：${videoId}`)
    }
  }
  return { videoId }
}

function cleanupChunkDir(uploadId) {
  try { fs.rmSync(path.join(tmpChunkDir, uploadId), { recursive: true, force: true }) } catch {}
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

// ---------- 一起看：视频上传 / 分片上传 / 房间 ----------

// 整传（≤1GB，中小视频）：直接落盘，收尾走公共流程
app.post('/api/videos', (req, res, next) => {
  videoUpload.single('file')(req, res, (error) => {
    if (!error) {
      next()
      return
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ message: '视频超过 1GB，请使用分片上传（自动）' })
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

  const { videoId } = await finalizeVideoFile({
    filePath: file.path,
    filename: file.filename,
    sizeBytes: file.size,
    title,
    openid
  })

  console.log(`[watch] 视频上传成功 ${videoId}（${file.size} 字节，整传）`)
  res.json(getData())
}))

app.delete('/api/videos/:id', asyncRoute(async (req, res) => {
  res.json(deleteVideo(req.params.id))
}))

// 分片上传：接收单片（幂等——已存在的片直接跳过，天然支持断点续传）
app.post('/api/videos/chunk', (req, res, next) => {
  chunkUpload.single('file')(req, res, (error) => {
    if (!error) {
      next()
      return
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ message: '单片超过大小限制' })
      return
    }
    res.status(400).json({ message: error.message || '分片接收失败' })
  })
}, (req, res) => {
  const index = Number(req.query.index)
  const total = Number(req.query.total)
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(total) || total <= 0 || total > 9999) {
    res.status(400).json({ message: '分片参数不正确' })
    return
  }
  res.json({ ok: true, index, total })
})

// 分片上传：合并 + 公共收尾（faststart + 检测 + 入库）
app.post('/api/videos/complete', asyncRoute(async (req, res) => {
  const uploadId = String(req.body.uploadId || '').trim()
  const total = Number(req.body.total)
  const title = String(req.body.title || '').trim()
  const openid = String(req.body.openid || '').trim()

  const dir = path.join(tmpChunkDir, uploadId)
  if (!uploadId || !/^[A-Za-z0-9_-]+$/.test(uploadId) || !fs.existsSync(dir)) {
    res.status(400).json({ message: '上传会话不存在或已过期' })
    return
  }

  const parts = []
  for (let i = 0; i < total; i += 1) {
    const partPath = path.join(dir, `part-${i}`)
    if (!fs.existsSync(partPath)) {
      cleanupChunkDir(uploadId)
      res.status(400).json({ message: `分片不完整（缺少第 ${i + 1} 片）` })
      return
    }
    parts.push(partPath)
  }

  const ext = path.extname(String(req.body.filename || '').split('?')[0]).toLowerCase() || '.mp4'
  if (!VIDEO_EXTENSIONS.includes(ext)) {
    cleanupChunkDir(uploadId)
    res.status(400).json({ message: '仅支持 MP4 / M4V / MOV 格式的视频' })
    return
  }

  if (!(await guardText(res, title, { openid, label: '视频标题' }))) {
    cleanupChunkDir(uploadId)
    return
  }
  if (!findUserByOpenid(openid)) {
    cleanupChunkDir(uploadId)
    res.status(400).json({ message: '身份不存在' })
    return
  }

  // 顺序合并分片为完整文件
  const mergedPath = path.join(dir, 'merged.mp4')
  try {
    const sink = fs.createWriteStream(mergedPath)
    for (const partPath of parts) {
      await new Promise((resolve, reject) => {
        const source = fs.createReadStream(partPath)
        source.pipe(sink, { end: false })
        source.on('end', resolve)
        source.on('error', reject)
      })
    }
    await new Promise((resolve, reject) => sink.end(() => resolve()))
  } catch (error) {
    cleanupChunkDir(uploadId)
    res.status(400).json({ message: '合并失败，请重试' })
    return
  }

  const size = fs.statSync(mergedPath).size
  if (size > MAX_VIDEO_BYTES) {
    cleanupChunkDir(uploadId)
    res.status(400).json({ message: '视频超过大小限制' })
    return
  }

  const filename = `video_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`
  const finalPath = path.join(videoDir, filename)
  fs.mkdirSync(videoDir, { recursive: true })
  fs.renameSync(mergedPath, finalPath)
  cleanupChunkDir(uploadId)

  const { videoId } = await finalizeVideoFile({
    filePath: finalPath,
    filename,
    sizeBytes: size,
    title,
    openid
  })

  console.log(`[watch] 视频上传成功 ${videoId}（${size} 字节，分片 ${total} 片）`)
  res.json(getData())
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
if (isContentSecurityConfigured()) {
  const hasFfmpeg = await checkVideoScanTooling()
  console.log(hasFfmpeg
    ? '[watch] ffmpeg 可用，上传视频将抽帧检测'
    : '[watch] 未检测到 ffmpeg，视频帧检测将跳过（服务器安装：sudo apt install -y ffmpeg）')
}
try {
  const removed = purgeWatchData(getActiveWatchRoomIds())
  if (removed.videos || removed.rooms) {
    console.log(`[watch] 启动清理：删除视频 ${removed.videos} 个、过期房间 ${removed.rooms} 个`)
  }
} catch (error) {
  console.warn(`[watch] 启动清理失败：${error.message}`)
}
setInterval(() => {
  try {
    purgeWatchData(getActiveWatchRoomIds())
    // 清理超过 1 小时未完成的分片临时目录
    try {
      if (fs.existsSync(tmpChunkDir)) {
        const cutoff = Date.now() - 60 * 60 * 1000
        fs.readdirSync(tmpChunkDir).forEach((name) => {
          const dir = path.join(tmpChunkDir, name)
          try {
            if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true })
          } catch {}
        })
      }
    } catch (error) {
      console.warn(`[watch] 分片临时目录清理失败：${error.message}`)
    }
  } catch (error) {
    console.warn(`[watch] 定时清理失败：${error.message}`)
  }
}, 60 * 60 * 1000)

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
