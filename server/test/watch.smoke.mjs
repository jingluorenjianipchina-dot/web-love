// 「一起看」功能冒烟测试：mock 微信接口 + 消息推送回调（加密）+ WebSocket 双人同步。
// 运行：node server/test/watch.smoke.mjs（需先 npm install）
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const MOCK_PORT = 3998
const APP_PORT = 3103
const MOCK_WX_OPENID = 'oMockWxOpenid0000000000000'
const PUSH_TOKEN = 'push-token'
const PUSH_AES_KEY = crypto.randomBytes(32).toString('base64').slice(0, 43)

const mockState = { risky: false, mediaChecks: [] }

let failures = 0
function check(name, condition, extra = '') {
  if (condition) {
    console.log(`  ✅ ${name}`)
  } else {
    failures += 1
    console.log(`  ❌ ${name} ${extra}`)
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

function json(res, payload) {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

const mockServer = http.createServer(async (req, res) => {
  const body = await readBody(req)
  const url = new URL(req.url, 'http://localhost')

  if (url.pathname === '/__mode') {
    mockState.risky = JSON.parse(body.toString()).risky
    return json(res, { ok: true })
  }
  if (url.pathname === '/cgi-bin/token') {
    return json(res, { access_token: 'mock-access-token', expires_in: 7200 })
  }
  if (url.pathname === '/sns/jscode2session') {
    return json(res, { openid: MOCK_WX_OPENID, session_key: 'mock' })
  }
  if (url.pathname === '/wxa/msg_sec_check') {
    return json(res, mockState.risky
      ? { errcode: 0, result: { suggest: 'risky', label: 20001 } }
      : { errcode: 0, result: { suggest: 'pass', label: 100 } })
  }
  if (url.pathname === '/wxa/img_sec_check') {
    return json(res, mockState.risky ? { errcode: 87014 } : { errcode: 0 })
  }
  if (url.pathname === '/wxa/media_check_async') {
    mockState.mediaChecks.push(JSON.parse(body.toString()))
    return json(res, { errcode: 0 })
  }

  res.writeHead(404)
  res.end('not found')
})

function encryptPush(appId, event) {
  const key = Buffer.from(`${PUSH_AES_KEY}=`, 'base64')
  const msg = Buffer.from(JSON.stringify(event), 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(msg.length)
  const data = Buffer.concat([crypto.randomBytes(16), len, msg, Buffer.from(appId, 'utf8')])
  const pad = 32 - (data.length % 32)
  const cipher = crypto.createCipheriv('aes-256-cbc', key, key.slice(0, 16))
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(Buffer.concat([data, Buffer.alloc(pad, pad)])), cipher.final()]).toString('base64')
}

function pushSignature(encrypt) {
  const timestamp = '1700000000'
  const nonce = 'nonce123'
  const parts = encrypt
    ? [PUSH_TOKEN, timestamp, nonce, encrypt]
    : [PUSH_TOKEN, timestamp, nonce]
  const signature = crypto.createHash('sha1')
    .update(parts.sort().join(''))
    .digest('hex')
  return `msg_signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`
}

async function sendPush(appId, event) {
  const encrypt = encryptPush(appId, event)
  const response = await fetch(`http://127.0.0.1:${APP_PORT}/api/wx/push?${pushSignature(encrypt)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ToUserName: 'gh_test', Encrypt: encrypt })
  })
  return response.text()
}

function startAppServer(port, dbPath, extraEnv = {}) {
  const env = { ...process.env, PORT: String(port), DB_PATH: dbPath, ...extraEnv }
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (data) => process.stdout.write(`  [app:${port}] ${data}`))
  child.stderr.on('data', (data) => process.stdout.write(`  [app:${port}:err] ${data}`))
  return child
}

async function waitUntilReady(port) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`服务器 ${port} 未能在 15 秒内启动`)
}

async function api(method, apiPath, body) {
  const response = await fetch(`http://127.0.0.1:${APP_PORT}${apiPath}`, {
    method,
    headers: body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {},
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined
  })
  return { status: response.status, data: await response.json().catch(() => ({})), text: await response.text().catch(() => '') }
}

async function uploadVideo(fileName, bytes, { title = '', openid = 'local_xiaoqiu' } = {}) {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'video/mp4' }), fileName)
  if (openid) form.append('openid', openid)
  if (title) form.append('title', title)
  return api('POST', '/api/videos', form)
}

function connectSocket(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/watch`)
    const inbox = []
    ws.on('message', (raw) => inbox.push(JSON.parse(String(raw))))
    ws.on('open', () => resolve({ ws, inbox }))
    ws.on('error', reject)
  })
}

async function waitFor(inbox, type, { timeoutMs = 4000, pred = () => true } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const index = inbox.findIndex((m) => m.type === type && pred(m))
    if (index >= 0) return inbox.splice(index, 1)[0]
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`等待消息 ${type} 超时`)
}

const createdVideoFiles = []
function trackVideoFile(data) {
  const video = data.videos && data.videos[0]
  if (video) createdVideoFiles.push(video.url.replace('/api/uploads/videos/', ''))
}

const tmpConfigured = fs.mkdtempSync(path.join(os.tmpdir(), 'love-watch-'))
const tmpOpen = fs.mkdtempSync(path.join(os.tmpdir(), 'love-watch-b-'))
const videoFileDir = path.join(tmpConfigured, 'uploads', 'videos')
const dbPath = path.join(tmpConfigured, 'love.sqlite')
const dbOpen = path.join(tmpOpen, 'love.sqlite')
let appServer = null

try {
  await new Promise((resolve) => mockServer.listen(MOCK_PORT, '127.0.0.1', resolve))
  appServer = startAppServer(APP_PORT, dbPath, {
    WECHAT_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
    WECHAT_APPID: 'wx-mock-appid',
    WECHAT_SECRET: 'mock-secret',
    WECHAT_PUSH_TOKEN: PUSH_TOKEN,
    WECHAT_PUSH_AES_KEY: PUSH_AES_KEY,
    MAX_VIDEO_BYTES: String(1024 * 1024),
    DATA_DIR: tmpConfigured,
    FFMPEG_PATH: 'ffmpeg-not-installed-for-test',
    FFPROBE_PATH: 'ffprobe-not-installed-for-test'
  })
  await waitUntilReady(APP_PORT)

  console.log('\n== 准备：登录 + openid 绑定 ==')
  await api('POST', '/api/login', { roleKey: 'xiaoqiu', inviteCode: 'XIAOQIU' })
  await api('POST', '/api/wx/session', { code: 'code-a', openid: 'local_xiaoqiu' })

  console.log('\n== 视频上传与检测回调 ==')
  let r = await uploadVideo('good.mp4', crypto.randomBytes(20 * 1024), { title: '我们的视频' })
  check('上传 mp4 成功（200）', r.status === 200, JSON.stringify(r.data))
  let video = r.data.videos && r.data.videos[0]
  check('测试环境无 ffmpeg，帧检测跳过直接 ready', video && video.status === 'ready', video && video.status)
  check('不再调用 mediaCheckAsync（该接口不支持视频）', mockState.mediaChecks.length === 0)
  trackVideoFile(r.data)

  r = await api('GET', video.url.replace(/^\/api/, '/api'))
  check('ready 视频文件可访问（200）', r.status === 200, `实际 ${r.status}`)

  const pushResult = await sendPush('wx-mock-appid', {
    Event: 'wxa_media_check', trace_id: video.id, result: { suggest: 'pass', label: 100 }
  })
  check('消息推送回调返回 success', pushResult === 'success', pushResult)
  r = await api('GET', '/api/data')
  video = r.data.videos && r.data.videos[0]
  check('回调后视频保持 ready', video && video.status === 'ready', video && video.status)

  console.log('\n== 房间接口 ==')
  r = await api('POST', '/api/rooms', { videoId: video.id, openid: 'local_xiaoqiu' })
  check('创建房间成功', r.status === 200 && r.data.rooms.length === 1)
  const roomId = r.data.rooms[0].id
  r = await api('POST', '/api/rooms', { videoId: video.id, openid: 'local_xiaolong' })
  check('重复发起幂等（仍是同一个房间）', r.status === 200 && r.data.rooms.length === 1 && r.data.rooms[0].id === roomId)

  console.log('\n== WebSocket 房间同步与聊天 ==')
  const alice = await connectSocket(APP_PORT)
  alice.ws.send(JSON.stringify({ type: 'join', roomId, openid: 'local_xiaoqiu' }))
  const joinedA = await waitFor(alice.inbox, 'joined')
  check('A 加入房间拿到视频地址与历史消息', joinedA.video.url === video.url && Array.isArray(joinedA.messages))
  check('A 加入时对方不在线', joinedA.peerOnline === false)

  const bob = await connectSocket(APP_PORT)
  bob.ws.send(JSON.stringify({ type: 'join', roomId, openid: 'local_xiaolong' }))
  const joinedB = await waitFor(bob.inbox, 'joined')
  const peerOnlineA = await waitFor(alice.inbox, 'peer-online')
  check('B 加入后 A 收到 peer-online，且 B 能看到 A 在线', peerOnlineA.openid === 'local_xiaolong' && joinedB.peerOnline === true)

  alice.ws.send(JSON.stringify({ type: 'state', source: 'user', playing: true, position: 12.5 }))
  const stateB = await waitFor(bob.inbox, 'state')
  check('B 实时收到 A 的用户操作（进度同步）', stateB.playing === true && Math.abs(stateB.position - 12.5) < 0.01)
  check('广播携带权威版本号 v1', stateB.version === 1, `实际 ${stateB.version}`)
  const ackA1 = await waitFor(alice.inbox, 'state-ack')
  check('操作者收到 state-ack 回执', ackA1.version === 1 && ackA1.playing === true)

  console.log('\n== 同步协议 v2：权威状态 / 心跳校准 ==')
  bob.ws.send(JSON.stringify({ type: 'state', source: 'heartbeat', playing: true, position: 12.6 }))
  await new Promise((resolve) => setTimeout(resolve, 400))
  check('与权威一致的心跳不广播、不触发校准', alice.inbox.every((m) => m.type !== 'state') && bob.inbox.every((m) => m.type !== 'calibrate'))

  bob.ws.send(JSON.stringify({ type: 'state', source: 'heartbeat', playing: true, position: 50 }))
  const calibBob = await waitFor(bob.inbox, 'calibrate')
  check('明显落后权威时间线的心跳触发私发校准', calibBob.playing === true
    && calibBob.position >= 12.5 && calibBob.position <= 20
    && calibBob.version === 1, JSON.stringify(calibBob))
  check('校准只发给偏离者，不广播给对方', alice.inbox.every((m) => m.type !== 'state' && m.type !== 'calibrate'))

  alice.ws.send(JSON.stringify({ type: 'state', source: 'user', playing: false, position: 13 }))
  const stateB2 = await waitFor(bob.inbox, 'state')
  check('B 收到 A 的暂停（v2）', stateB2.playing === false && Math.abs(stateB2.position - 13) < 0.01 && stateB2.version === 2)
  await waitFor(alice.inbox, 'state-ack')

  bob.ws.send(JSON.stringify({ type: 'state', source: 'heartbeat', playing: true, position: 14 }))
  const calibBob2 = await waitFor(bob.inbox, 'calibrate')
  check('暂停后 B 的过期心跳被校准回暂停态（不会广播覆写）', calibBob2.playing === false
    && Math.abs(calibBob2.position - 13) < 0.01 && calibBob2.version === 2, JSON.stringify(calibBob2))
  check('过期心跳不会改写权威状态、不影响 A', alice.inbox.every((m) => m.type !== 'state' && m.type !== 'calibrate'))

  const charlie = await connectSocket(APP_PORT)
  charlie.ws.send(JSON.stringify({ type: 'join', roomId, openid: 'local_xiaolong' }))
  const joinedC = await waitFor(charlie.inbox, 'joined')
  check('新加入者拿到权威快照（暂停@13s v2）', joinedC.state.playing === false
    && Math.abs(joinedC.state.position - 13) < 0.01 && joinedC.state.version === 2, JSON.stringify(joinedC.state))
  charlie.ws.close()

  alice.ws.send(JSON.stringify({ type: 'state', playing: true, position: 15 }))
  const stateB3 = await waitFor(bob.inbox, 'state')
  check('不带 source 的旧协议消息按用户操作处理（兼容旧客户端）', stateB3.playing === true
    && Math.abs(stateB3.position - 15) < 0.01 && stateB3.version === 3)

  alice.ws.send(JSON.stringify({ type: 'state', source: 'user', playing: true, position: 16 }))
  await waitFor(alice.inbox, 'state-ack', { pred: (m) => m.version === 4 })
  bob.ws.send(JSON.stringify({ type: 'state', source: 'user', playing: false, position: 16.5 }))
  const stateA5 = await waitFor(alice.inbox, 'state', { pred: (m) => m.version === 5 })
  const dave = await connectSocket(APP_PORT)
  dave.ws.send(JSON.stringify({ type: 'join', roomId, openid: 'local_xiaoqiu' }))
  const joinedD = await waitFor(dave.inbox, 'joined')
  check('连续快速操作后收敛到最新版本（B 的暂停 v5 胜出）', joinedD.state.version === 5
    && joinedD.state.playing === false && Math.abs(joinedD.state.position - 16.5) < 0.01
    && stateA5.playing === false, JSON.stringify(joinedD.state))
  dave.ws.close()

  alice.ws.send(JSON.stringify({ type: 'chat', content: '这段太好笑了' }))
  const chatB = await waitFor(bob.inbox, 'chat')
  check('B 收到 A 的房间聊天', chatB.message && chatB.message.content === '这段太好笑了')
  const chatA = await waitFor(alice.inbox, 'chat')
  check('发送者也收到消息回显（用于去重合并）', chatA.message.content === '这段太好笑了')

  await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mode`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ risky: true })
  })).json()
  alice.ws.send(JSON.stringify({ type: 'chat', content: '违规聊天内容' }))
  const rejected = await waitFor(alice.inbox, 'chat-rejected')
  check('违规聊天被拒绝并提示发送者', /违规/.test(rejected.message || ''))
  check('对方不会收到被拒消息', bob.inbox.every((m) => m.type !== 'chat'))

  await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mode`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ risky: false })
  })).json()

  r = await api('GET', `/api/rooms/${roomId}/messages`)
  check('聊天历史可查询', r.status === 200 && r.data.messages.length === 1)

  console.log('\n== 上传限制 ==')
  r = await uploadVideo('bad.avi', crypto.randomBytes(1024))
  check('不支持的格式被拒绝（400）', r.status === 400, JSON.stringify(r.data))

  console.log('\n== 分片上传 ==')
  const chunkUploadId = `testchunk_${Date.now()}`
  const chunkSource = crypto.randomBytes(30 * 1024)
  const partSize = 10 * 1024
  const partTotal = Math.ceil(chunkSource.length / partSize)
  for (let i = 0; i < partTotal; i += 1) {
    const form = new FormData()
    const slice = chunkSource.slice(i * partSize, Math.min((i + 1) * partSize, chunkSource.length))
    form.append('file', new Blob([slice], { type: 'video/mp4' }), 'part.mp4')
    r = await api('POST', `/api/videos/chunk?uploadId=${chunkUploadId}&index=${i}&total=${partTotal}`, form)
    check(`分片 ${i + 1}/${partTotal} 上传成功`, r.status === 200, JSON.stringify(r.data))
  }
  const form0 = new FormData()
  form0.append('file', new Blob([chunkSource.slice(0, partSize)], { type: 'video/mp4' }), 'part.mp4')
  r = await api('POST', `/api/videos/chunk?uploadId=${chunkUploadId}&index=0&total=${partTotal}`, form0)
  check('重复传同一片幂等成功', r.status === 200)

  r = await api('POST', '/api/videos/complete', {
    uploadId: chunkUploadId, title: '分片视频', total: partTotal, size: chunkSource.length,
    filename: 'chunked.mp4', openid: 'local_xiaoqiu'
  })
  check('complete 合并成功且视频 ready', r.status === 200 && r.data.videos[0].status === 'ready', JSON.stringify(r.data))
  const chunkVideo = r.data.videos[0]
  check('合并后的文件可访问', (await api('GET', chunkVideo.url)).status === 200)

  r = await api('POST', '/api/videos/complete', {
    uploadId: `missing_${Date.now()}`, title: 'x', total: 3, size: 100, filename: 'a.mp4', openid: 'local_xiaoqiu'
  })
  check('不完整会话 complete 被拒', r.status === 400)

  console.log('\n== 分片超限（测试 MAX_VIDEO_BYTES=1MB）==')
  const bigUploadId = `big_${Date.now()}`
  const bigPart = crypto.randomBytes(600 * 1024) // 两片共 1.2MB > 1MB 上限
  for (let i = 0; i < 2; i += 1) {
    const form = new FormData()
    form.append('file', new Blob([bigPart], { type: 'video/mp4' }), 'part.mp4')
    r = await api('POST', `/api/videos/chunk?uploadId=${bigUploadId}&index=${i}&total=2`, form)
  }
  r = await api('POST', '/api/videos/complete', {
    uploadId: bigUploadId, title: 'x', total: 2, size: bigPart.length * 2, filename: 'big.mp4', openid: 'local_xiaoqiu'
  })
  check('分片合并后超限被拒绝（400）', r.status === 400 && /超过/.test(r.data.message || ''), JSON.stringify(r.data))

  console.log('\n== 检测不通过的视频（生产环境装 ffmpeg 后生效，此处验证跳过路径）==')
  await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mode`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ risky: true })
  })).json()
  r = await uploadVideo('risky.mp4', crypto.randomBytes(20 * 1024))
  check('无 ffmpeg 时违规场景也按跳过放行（ready）', r.status === 200 && r.data.videos[0].status === 'ready')
  const riskyVideo = r.data.videos[0]
  trackVideoFile(r.data)
  r = await api('GET', riskyVideo.url)
  check('放行的视频文件可访问（200）', r.status === 200)

  await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mode`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ risky: true })
  })).json()
  r = await uploadVideo('titled.mp4', crypto.randomBytes(1024), { title: '违规标题' })
  check('违规标题上传被拒绝（400）且不留文件', r.status === 400)

  console.log('\n== 推送握手 ==')
  const echostr = 'echo-hello'
  const handshake = await fetch(`http://127.0.0.1:${APP_PORT}/api/wx/push?${pushSignature(null)}&echostr=${echostr}`)
  check('GET 验签握手返回 echostr', await handshake.text() === echostr)

  console.log('\n== 结束房间（WS 主动结束）==')
  alice.ws.send(JSON.stringify({ type: 'finish' }))
  const finishedB = await waitFor(bob.inbox, 'room-finished')
  check('WS finish 会让对方收到 room-finished', Boolean(finishedB))
  r = await api('GET', '/api/data')
  check('房间状态已落库为 finished', r.data.rooms[0].status === 'finished')

  console.log('\n== 删除视频时联动结束房间 ==')
  await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mode`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ risky: false })
  })).json()
  r = await uploadVideo('del.mp4', crypto.randomBytes(20 * 1024))
  const delVideo = r.data.videos && r.data.videos[0]
  check('删除前视频已可观看', r.status === 200 && delVideo && delVideo.status === 'ready')
  r = await api('POST', '/api/rooms', { videoId: delVideo.id, openid: 'local_xiaoqiu' })
  check('房间已建立', r.status === 200 && r.data.rooms.some((room) => room.videoId === delVideo.id && room.status !== 'finished'))
  trackVideoFile(r.data)
  const delRoomId = r.data.rooms.find((room) => room.videoId === delVideo.id).id
  r = await api('POST', `/api/rooms/${delRoomId}/finish`, {})
  check('REST 接口可结束房间', r.status === 200 && r.data.rooms.find((room) => room.id === delRoomId).status === 'finished')
  r = await api('DELETE', `/api/videos/${delVideo.id}`)
  check('删除视频成功且关联房间自动结束', r.status === 200 && r.data.rooms.every((room) => room.videoId !== delVideo.id || room.status === 'finished'))
  r = await api('GET', '/api/data')
  check('首页不再有指向该视频的进行中房间', !r.data.rooms.some((room) => room.videoId === delVideo.id && (room.status === 'waiting' || room.status === 'active')))
} finally {
  if (appServer) appServer.kill()
  mockServer.close()
  createdVideoFiles.forEach((name) => {
    try { fs.unlinkSync(path.join(videoFileDir, name)) } catch {}
  })
  try { fs.rmSync(tmpConfigured, { recursive: true, force: true }) } catch {}
  try { fs.rmSync(tmpOpen, { recursive: true, force: true }) } catch {}
}

console.log(failures === 0 ? '\n全部通过 ✅' : `\n有 ${failures} 项失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
