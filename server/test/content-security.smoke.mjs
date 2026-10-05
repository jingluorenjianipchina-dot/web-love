// 内容安全接入冒烟测试：本地起一个 mock 微信接口，验证后端各 UGC 接口的检测行为。
// 运行：node server/test/content-security.smoke.mjs（需先 npm install）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const MOCK_PORT = 3999
const APP_PORT = 3101
const APP_PORT_OPEN = 3102
const MOCK_WX_OPENID = 'oMockWxOpenid0000000000000'

const mockState = {
  risky: false,
  lastTextCheck: null,
  lastImgCheckBytes: 0,
  boundCodes: []
}

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
  const pathname = new URL(req.url, 'http://localhost').pathname

  if (pathname === '/__mode') {
    mockState.risky = JSON.parse(body.toString()).risky
    return json(res, { ok: true, risky: mockState.risky })
  }
  if (pathname === '/__state') {
    return json(res, mockState)
  }
  if (pathname === '/cgi-bin/token') {
    return json(res, { access_token: 'mock-access-token', expires_in: 7200 })
  }
  if (pathname === '/sns/jscode2session') {
    mockState.boundCodes.push(new URL(req.url, 'http://localhost').searchParams.get('js_code'))
    return json(res, { openid: MOCK_WX_OPENID, session_key: 'mock-session-key' })
  }
  if (pathname === '/wxa/msg_sec_check') {
    mockState.lastTextCheck = JSON.parse(body.toString())
    return json(res, mockState.risky
      ? { errcode: 0, errmsg: 'ok', result: { suggest: 'risky', label: 20001 }, detail: [] }
      : { errcode: 0, errmsg: 'ok', result: { suggest: 'pass', label: 100 }, detail: [] })
  }
  if (pathname === '/wxa/img_sec_check') {
    mockState.lastImgCheckBytes = body.length
    return json(res, mockState.risky
      ? { errcode: 87014, errmsg: 'risky content diss allow' }
      : { errcode: 0, errmsg: 'ok' })
  }

  res.writeHead(404)
  res.end('not found')
})

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

async function api(port, method, apiPath, body) {
  const response = await fetch(`http://127.0.0.1:${port}${apiPath}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  })
  return { status: response.status, data: await response.json().catch(() => ({})) }
}

const SMALL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function bigPngDataUrl() {
  const { default: Jimp } = await import('jimp')
  const image = new Jimp(900, 900, 0x000000ff)
  for (let i = 0; i < image.bitmap.data.length; i += 4) {
    image.bitmap.data[i] = Math.floor(Math.random() * 256)
    image.bitmap.data[i + 1] = Math.floor(Math.random() * 256)
    image.bitmap.data[i + 2] = Math.floor(Math.random() * 256)
  }
  const buffer = await image.getBufferAsync(Jimp.MIME_PNG)
  console.log(`  （测试用大图：${buffer.length} 字节）`)
  return `data:image/png;base64,${buffer.toString('base64')}`
}

// 预先生成一个"老版本"数据库（users 表没有 wx_openid 列），验证自动迁移
async function createLegacyDb(dbPath) {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
  const db = new SQL.Database()
  db.run(`CREATE TABLE users (
    id TEXT PRIMARY KEY, openid TEXT UNIQUE NOT NULL, role_key TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL, nick_name TEXT NOT NULL, avatar_url TEXT NOT NULL DEFAULT '',
    birthday TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`)
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
}

const createdUploadFiles = []
function trackUploadFile(data) {
  const match = typeof data === 'string' ? data.match(/^\/api\/uploads\/(.+)$/) : null
  if (match) createdUploadFiles.push(path.join(REPO_ROOT, 'server', 'data', 'uploads', ...match[1].split('/')))
}

const tmpConfigured = fs.mkdtempSync(path.join(os.tmpdir(), 'love-sec-a-'))
const tmpOpen = fs.mkdtempSync(path.join(os.tmpdir(), 'love-sec-b-'))
const dbConfigured = path.join(tmpConfigured, 'love.sqlite')
const dbOpen = path.join(tmpOpen, 'love.sqlite')

let appServer = null
let appServerOpen = null

try {
  await createLegacyDb(dbConfigured)
  await new Promise((resolve) => mockServer.listen(MOCK_PORT, '127.0.0.1', resolve))
  console.log('\n== 启动服务（已配置内容安全，指向 mock 微信接口）==')
  appServer = startAppServer(APP_PORT, dbConfigured, {
    WECHAT_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
    WECHAT_APPID: 'wx-mock-appid',
    WECHAT_SECRET: 'mock-secret',
    DATA_DIR: tmpConfigured
  })
  await waitUntilReady(APP_PORT)

  console.log('\n== 文本/图片检测（正常内容放行）==')
  await api(APP_PORT, 'POST', '/api/wx/session', { code: 'mock-js-code', openid: 'local_xiaoqiu' })
  check('code2session 绑定被调用', mockState.boundCodes.includes('mock-js-code'))

  let r = await api(APP_PORT, 'POST', '/api/messages', { content: '今天也要加油呀', openid: 'local_xiaoqiu' })
  check('正常留言放行（200）', r.status === 200)
  check('msgSecCheck 收到真实 openid', mockState.lastTextCheck && mockState.lastTextCheck.openid === MOCK_WX_OPENID)
  check('msgSecCheck 使用 version=2', mockState.lastTextCheck && mockState.lastTextCheck.version === 2)
  const messageId = r.data.messages && r.data.messages[0] && r.data.messages[0].id

  r = await api(APP_PORT, 'POST', '/api/albums', {
    title: '第一张', description: '', memoryDate: '2026-09-28',
    imageUrl: SMALL_PNG, openid: 'local_xiaoqiu'
  })
  check('正常相册照片放行（200）', r.status === 200)
  trackUploadFile(r.data.albums && r.data.albums[0] && r.data.albums[0].imageUrl)

  r = await api(APP_PORT, 'POST', '/api/albums', {
    title: '', description: '', imageUrl: await bigPngDataUrl(), openid: 'local_xiaoqiu'
  })
  check('超过 1M 的照片压缩后放行（200）', r.status === 200)
  check('imgSecCheck 收到的图片已压缩到 1M 以内', mockState.lastImgCheckBytes > 0 && mockState.lastImgCheckBytes <= 1024 * 1024,
    `实际 ${mockState.lastImgCheckBytes} 字节`)
  trackUploadFile(r.data.albums && r.data.albums[0] && r.data.albums[0].imageUrl)

  r = await api(APP_PORT, 'POST', '/api/users/local_xiaoqiu/profile', {
    nickName: '小邱同学', avatarUrl: SMALL_PNG
  })
  check('正常昵称+头像放行（200）', r.status === 200)
  trackUploadFile(r.data && r.data.users && r.data.users[0] && r.data.users[0].avatarUrl)

  console.log('\n== 检测不通过时全部拒绝（400 + 提示语）==')
  await (await fetch(`http://127.0.0.1:${MOCK_PORT}/__mode`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ risky: true })
  })).json()

  r = await api(APP_PORT, 'POST', '/api/messages', { content: '违规测试内容', openid: 'local_xiaoqiu' })
  check('违规留言被拒绝（400）', r.status === 400, `实际 ${r.status}`)
  check('拒绝提示语正确', /违规/.test(r.data.message || ''), JSON.stringify(r.data))

  r = await api(APP_PORT, 'POST', `/api/messages/${messageId}/update`, { content: '违规测试内容' })
  check('修改留言（不带 openid）仍被检测拒绝', r.status === 400)
  check('修改留言退回用发送者绑定的 openid 检测', mockState.lastTextCheck && mockState.lastTextCheck.openid === MOCK_WX_OPENID)

  r = await api(APP_PORT, 'POST', '/api/anniversaries', { title: '违规标题', date: '2026-09-28', openid: 'local_xiaoqiu' })
  check('违规纪念日标题被拒绝', r.status === 400)

  r = await api(APP_PORT, 'POST', '/api/coupons', { title: '违规卡券', description: '', openid: 'local_xiaoqiu' })
  check('违规卡券名称被拒绝', r.status === 400)

  r = await api(APP_PORT, 'POST', '/api/users/local_xiaoqiu/profile', { nickName: '违规昵称' })
  check('违规昵称被拒绝', r.status === 400)

  r = await api(APP_PORT, 'POST', '/api/users/local_xiaoqiu/profile', { nickName: '小邱同学', avatarUrl: SMALL_PNG })
  check('违规头像图片被拒绝', r.status === 400, JSON.stringify(r.data))

  r = await api(APP_PORT, 'POST', '/api/albums', { title: '', description: '', imageUrl: SMALL_PNG, openid: 'local_xiaoqiu' })
  check('违规相册照片被拒绝', r.status === 400)
  check('图片拒绝提示语正确', /图片/.test(r.data.message || ''), JSON.stringify(r.data))

  console.log('\n== 未配置 AppSecret 时降级放行（不 block 正常使用）==')
  appServerOpen = startAppServer(APP_PORT_OPEN, dbOpen, {
    WECHAT_APPID: '',
    WECHAT_SECRET: '',
    DATA_DIR: tmpOpen
  })
  await waitUntilReady(APP_PORT_OPEN)
  await api(APP_PORT_OPEN, 'POST', '/api/login', { roleKey: 'xiaoqiu', inviteCode: 'XIAOQIU' })
  r = await api(APP_PORT_OPEN, 'POST', '/api/messages', { content: '违规测试内容', openid: 'local_xiaoqiu' })
  check('未配置时留言放行（200）', r.status === 200, `实际 ${r.status}`)
  r = await api(APP_PORT_OPEN, 'POST', '/api/wx/session', { code: 'x', openid: 'local_xiaoqiu' })
  check('未配置时绑定接口优雅返回', r.status === 200 && r.data.ok === false)
} finally {
  if (appServer) appServer.kill()
  if (appServerOpen) appServerOpen.kill()
  mockServer.close()
  createdUploadFiles.forEach((file) => {
    try { fs.unlinkSync(file) } catch {}
  })
  ;[tmpConfigured, tmpOpen].forEach((dir) => {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  })
}

console.log(failures === 0 ? '\n全部通过 ✅' : `\n有 ${failures} 项失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
