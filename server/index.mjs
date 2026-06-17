import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addAnniversary,
  addCoupon,
  addMessage,
  getData,
  initDb,
  login,
  markMessagesRead,
  pinMessage,
  replaceData,
  resetData,
  updateCouponStatus
} from './db.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const app = express()
const port = Number(process.env.PORT || 3001)

app.use(cors())
app.use(express.json({ limit: '2mb' }))

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res)
    } catch (error) {
      next(error)
    }
  }
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

app.post('/api/anniversaries', (req, res) => {
  const title = String(req.body.title || '').trim()
  const date = String(req.body.date || '').trim()

  if (!title || !date) {
    res.status(400).json({ message: '纪念日标题和日期不能为空' })
    return
  }

  res.json(addAnniversary({ title, date, openid: req.body.openid }))
})

app.post('/api/messages', (req, res) => {
  const content = String(req.body.content || '').trim()

  if (!content) {
    res.status(400).json({ message: '留言内容不能为空' })
    return
  }

  res.json(addMessage({ content, openid: req.body.openid }))
})

app.post('/api/messages/read', (req, res) => {
  res.json(markMessagesRead(req.body.openid))
})

app.post('/api/messages/:id/pin', (req, res) => {
  res.json(pinMessage(req.params.id))
})

app.post('/api/coupons', (req, res) => {
  const title = String(req.body.title || '').trim()

  if (!title) {
    res.status(400).json({ message: '卡券名称不能为空' })
    return
  }

  res.json(addCoupon({
    title,
    description: String(req.body.description || '').trim(),
    expireDate: String(req.body.expireDate || ''),
    receiverOpenid: req.body.receiverOpenid,
    openid: req.body.openid
  }))
})

app.post('/api/coupons/:id/status', (req, res) => {
  res.json(updateCouponStatus({
    id: req.params.id,
    status: req.body.status,
    openid: req.body.openid
  }))
})

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

await initDb()
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
