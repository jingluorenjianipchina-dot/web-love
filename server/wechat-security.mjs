// 微信内容安全检测：文本 msgSecCheck 2.0 + 图片 imgSecCheck（同步版）+ 视频 mediaCheckAsync（异步）
// AppID / AppSecret 只从环境变量读取（服务器上的 .env），不能写入代码或仓库。
//
// 策略：
// - 未配置 WECHAT_APPID/WECHAT_SECRET 时跳过检测（放行并打警告日志）。
// - 微信接口返回“risky”时拒绝保存；接口本身调用失败时放行并记录，避免误伤正常使用。
// - msgSecCheck 2.0 必须传真实 openid，openid 由小程序端 wx.login 静默换取后绑定到用户。
// - 视频检测结果通过微信「消息推送」异步回调（/api/wx/push），用 trace_id 对应回视频。

import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_API_BASE = 'https://api.weixin.qq.com'
const TEXT_REJECT_MESSAGE = '内容包含违规信息，请修改后再发布'
const IMAGE_REJECT_MESSAGE = '图片包含不适合发布的内容，请更换图片后再试'
const WEBP_REJECT_MESSAGE = '暂不支持 WebP 图片，请使用 JPG 或 PNG 图片'
const MAX_IMAGE_BYTES = 1024 * 1024 // imgSecCheck 要求图片小于 1M
const REQUEST_TIMEOUT_MS = 10000

function securityConfig() {
  return {
    apiBase: process.env.WECHAT_API_BASE || DEFAULT_API_BASE,
    appid: process.env.WECHAT_APPID || '',
    secret: process.env.WECHAT_SECRET || '',
    strict: process.env.CONTENT_SECURITY_STRICT === '1'
  }
}

export function isContentSecurityConfigured() {
  const { appid, secret } = securityConfig()
  return Boolean(appid && secret)
}

let cachedToken = { value: '', expiresAt: 0 }

async function fetchWechatJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  return response.json()
}

async function getAccessToken(force = false) {
  if (!force && cachedToken.value && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value
  }

  const { apiBase, appid, secret } = securityConfig()
  const query = `grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`
  const data = await fetchWechatJson(`${apiBase}/cgi-bin/token?${query}`)

  if (!data.access_token) {
    throw new Error(`获取 access_token 失败：${data.errcode || ''} ${data.errmsg || ''}`)
  }

  cachedToken = {
    value: data.access_token,
    // 提前 2 分钟过期，避免边界时刻用到失效 token
    expiresAt: Date.now() + ((Number(data.expires_in) || 7200) - 120) * 1000
  }
  return cachedToken.value
}

async function callWithToken(invoke) {
  let data = await invoke(await getAccessToken())
  if (data && (data.errcode === 40001 || data.errcode === 42001)) {
    cachedToken = { value: '', expiresAt: 0 }
    data = await invoke(await getAccessToken(true))
  }
  return data
}

// 小程序 wx.login 的 code 换取真实 openid
export async function codeToSession(code) {
  const { apiBase, appid, secret } = securityConfig()
  const query = [
    `appid=${encodeURIComponent(appid)}`,
    `secret=${encodeURIComponent(secret)}`,
    `js_code=${encodeURIComponent(code)}`,
    'grant_type=authorization_code'
  ].join('&')
  const data = await fetchWechatJson(`${apiBase}/sns/jscode2session?${query}`)

  if (!data.openid) {
    throw new Error(`code 换取 openid 失败：${data.errcode || ''} ${data.errmsg || ''}`)
  }
  return data.openid
}

export async function checkText(text, { wxOpenid = '', scene = 2, label = 'text' } = {}) {
  const content = String(text || '').trim()
  if (!content) return { ok: true, skipped: 'empty' }

  if (!isContentSecurityConfigured()) {
    console.warn(`[content-security] 未配置 WECHAT_APPID/WECHAT_SECRET，跳过文本检测（${label}）`)
    return { ok: true, skipped: 'not-configured' }
  }

  if (!wxOpenid) {
    console.warn(`[content-security] 用户没有绑定的真实 openid，跳过文本检测（${label}）`)
    return { ok: true, skipped: 'no-openid' }
  }

  const { apiBase, strict } = securityConfig()
  const payload = { content, version: 2, scene, openid: wxOpenid }

  try {
    const data = await callWithToken(async (token) =>
      fetchWechatJson(`${apiBase}/wxa/msg_sec_check?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      })
    )

    console.log(`[content-security] msgSecCheck（${label}, scene=${scene}）返回：${JSON.stringify(data)}`)

    if (data.errcode === 0 || data.errcode === undefined) {
      const suggest = data.result && data.result.suggest
      if (suggest === 'risky') return { ok: false, message: TEXT_REJECT_MESSAGE }
      if (suggest === 'review' && strict) return { ok: false, message: TEXT_REJECT_MESSAGE }
      return { ok: true }
    }

    console.warn(`[content-security] msgSecCheck 调用异常 errcode=${data.errcode} ${data.errmsg}，本次放行`)
    return { ok: true, apiError: data.errcode }
  } catch (error) {
    console.warn(`[content-security] msgSecCheck 调用失败：${error.message}，本次放行`)
    return { ok: true, apiError: error.message }
  }
}

export function parseImageDataUrl(value) {
  const match = String(value || '').match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/)
  if (!match) return null

  const type = match[1] === 'jpeg' ? 'jpg' : match[1]
  return { type, buffer: Buffer.from(match[2], 'base64') }
}

// imgSecCheck 限制 1M 以内，超限的图用 jimp 压到 1M 以内再检测（jimp 纯 JS，服务器无需编译环境）
async function shrinkToCheckable(buffer) {
  let Jimp
  try {
    Jimp = (await import('jimp')).default
  } catch {
    return null
  }

  try {
    const image = await Jimp.read(buffer)
    for (const size of [1600, 1280, 1024, 800, 640]) {
      const scaled = image.clone()
      if (scaled.bitmap.width > size || scaled.bitmap.height > size) {
        scaled.scaleToFit(size, size)
      }
      const output = await scaled.quality(80).getBufferAsync(Jimp.MIME_JPEG)
      if (output.length <= MAX_IMAGE_BYTES) return output
    }
  } catch (error) {
    console.warn(`[content-security] 图片压缩失败：${error.message}`)
  }
  return null
}

export async function checkImageDataUrl(imageUrl, { label = 'image' } = {}) {
  if (!isContentSecurityConfigured()) {
    console.warn(`[content-security] 未配置 WECHAT_APPID/WECHAT_SECRET，跳过图片检测（${label}）`)
    return { ok: true, skipped: 'not-configured' }
  }

  const parsed = parseImageDataUrl(imageUrl)
  if (!parsed) return { ok: true, skipped: 'not-data-url' }

  if (parsed.type === 'webp') {
    // imgSecCheck 不支持 webp，服务端也无法转码，直接拒绝，避免漏检内容被发布
    return { ok: false, message: WEBP_REJECT_MESSAGE }
  }

  let buffer = parsed.buffer
  if (buffer.length > MAX_IMAGE_BYTES) {
    console.log(`[content-security] 图片 ${buffer.length} 字节超过 1M，先压缩再检测（${label}）`)
    const shrunk = await shrinkToCheckable(buffer)
    if (!shrunk) {
      return { ok: false, message: '图片过大且无法压缩，请更换小于 1M 的图片' }
    }
    buffer = shrunk
  }

  const mime = parsed.type === 'png' ? 'image/png' : 'image/jpeg'
  return imgSecCheckBuffer(buffer, label, mime)
}

// ---------- 视频：服务端 ffmpeg 抽帧 + imgSecCheck ----------
// 注意：微信 mediaCheckAsync 只支持图片/音频，不支持视频（media_type 只有 1/2），
// 因此视频采用"抽帧后逐帧 imgSecCheck"的官方社区方案。

export function checkVideoScanTooling() {
  return new Promise((resolve) => {
    execFile(process.env.FFPROBE_PATH || 'ffprobe', ['-version'], { timeout: 5000 }, (error) => resolve(!error))
  })
}

// 快速重封装：不重新编码（-c copy），把 moov 移到文件头（+faststart），
// 让播放器能秒开、边下边播。几乎零 CPU、画质零损失。成功返回 true。
export function faststartVideo(filePath) {
  return new Promise((resolve) => {
    const outPath = `${filePath}.faststart`
    execFile(
      process.env.FFMPEG_PATH || 'ffmpeg',
      ['-i', filePath, '-c', 'copy', '-movflags', '+faststart', '-y', outPath],
      { timeout: 180000 },
      (error) => {
        if (error) {
          try { fs.unlinkSync(outPath) } catch {}
          resolve(false)
          return
        }
        try {
          fs.renameSync(outPath, filePath)
          resolve(true)
        } catch {
          try { fs.unlinkSync(outPath) } catch {}
          resolve(false)
        }
      }
    )
  })
}

function probeVideoDuration(filePath) {
  return new Promise((resolve) => {
    execFile(
      process.env.FFPROBE_PATH || 'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath],
      { timeout: 20000 },
      (error, stdout) => {
        if (error) {
          resolve(NaN)
          return
        }
        try {
          resolve(Number(JSON.parse(stdout).format.duration))
        } catch {
          resolve(NaN)
        }
      }
    )
  })
}

function extractFrame(filePath, atSeconds, outputPath) {
  return new Promise((resolve) => {
    execFile(
      process.env.FFMPEG_PATH || 'ffmpeg',
      ['-ss', String(atSeconds), '-i', filePath, '-frames:v', '1', '-q:v', '3', '-y', outputPath],
      { timeout: 60000 },
      (error) => resolve(!error)
    )
  })
}

// 对单帧/单图执行 imgSecCheck（供图片 data URL 与视频帧共用）
async function imgSecCheckBuffer(buffer, label, mime = 'image/jpeg') {
  const { apiBase } = securityConfig()
  try {
    const data = await callWithToken(async (token) => {
      const form = new FormData()
      form.append('media', new Blob([buffer], { type: mime }), 'check.jpg')
      const response = await fetch(
        `${apiBase}/wxa/img_sec_check?access_token=${encodeURIComponent(token)}`,
        { method: 'POST', body: form, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
      )
      return response.json()
    })

    console.log(`[content-security] imgSecCheck（${label}, ${buffer.length} 字节）返回：${JSON.stringify(data)}`)

    if (data.errcode === 0) return { ok: true }
    if (data.errcode === 87014) return { ok: false, message: IMAGE_REJECT_MESSAGE }

    console.warn(`[content-security] imgSecCheck 调用异常 errcode=${data.errcode} ${data.errmsg}，本次放行`)
    return { ok: true, apiError: data.errcode }
  } catch (error) {
    console.warn(`[content-security] imgSecCheck 调用失败：${error.message}，本次放行`)
    return { ok: true, apiError: error.message }
  }
}

// 视频抽帧检测：按时长取 5~12 帧，任一帧违规即拒绝；
// 服务器未装 ffmpeg/ffprobe 时跳过检测（放行并告警）。
export async function checkVideoFrames(filePath) {
  if (!isContentSecurityConfigured()) {
    console.warn('[content-security] 未配置 WECHAT_APPID/WECHAT_SECRET，跳过视频帧检测')
    return { skipped: true }
  }

  const duration = await probeVideoDuration(filePath)
  if (!Number.isFinite(duration) || duration <= 0) {
    console.warn('[content-security] ffprobe 不可用或视频读取失败，跳过视频帧检测（请安装 ffmpeg：sudo apt install -y ffmpeg）')
    return { skipped: true }
  }

  const frameCount = Math.min(12, Math.max(5, Math.ceil(duration / 30)))
  const stamps = []
  for (let i = 1; i <= frameCount; i += 1) {
    stamps.push(Number(((duration * i) / (frameCount + 1)).toFixed(2)))
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-scan-'))
  try {
    let checked = 0
    for (let i = 0; i < stamps.length; i += 1) {
      const framePath = path.join(tmpDir, `frame-${i}.jpg`)
      const extracted = await extractFrame(filePath, stamps[i], framePath)
      if (!extracted || !fs.existsSync(framePath)) continue

      let buffer = fs.readFileSync(framePath)
      if (buffer.length > MAX_IMAGE_BYTES) {
        const shrunk = await shrinkToCheckable(buffer)
        if (!shrunk) continue
        buffer = shrunk
      }

      const verdict = await imgSecCheckBuffer(buffer, `视频帧${i + 1}/${stamps.length}`)
      if (!verdict.ok) return { ok: false }
      checked += 1
    }

    if (checked === 0) {
      console.warn('[content-security] 一帧都没能抽取成功，跳过视频帧检测')
      return { skipped: true }
    }
    console.log(`[content-security] 视频帧检测完成：${checked}/${stamps.length} 帧全部通过`)
    return { ok: true }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

// ---------- 消息推送（接收 mediaCheckAsync 检测结果回调） ----------

export function pushConfig() {
  return {
    token: process.env.WECHAT_PUSH_TOKEN || '',
    aesKey: process.env.WECHAT_PUSH_AES_KEY || ''
  }
}

export function isPushConfigured() {
  const { token } = pushConfig()
  return Boolean(token)
}

function sha1Hex(value) {
  return crypto.createHash('sha1').update(value).digest('hex')
}

// 微信消息推送验签：signature = sha1(sort(token, timestamp, nonce[, encrypt]))
export function verifyPushSignature(query, encrypt = '') {
  const { token } = pushConfig()
  if (!token) return false

  const parts = [token, String(query.timestamp || ''), String(query.nonce || '')]
  if (encrypt) parts.push(encrypt)
  const signature = sha1Hex(parts.sort().join(''))
  return signature === String(query.msg_signature || '')
}

// 安全模式解密：EncodingAESKey Base64 解码得 AES-256-CBC 密钥
// 明文结构：random(16) + msg_len(4 字节大端) + msg + appid
export function decryptPushMessage(encrypt) {
  const { aesKey } = pushConfig()
  if (!aesKey) throw new Error('未配置 WECHAT_PUSH_AES_KEY')

  const key = Buffer.from(`${aesKey}=`, 'base64')
  // 微信用 32 字节块的 PKCS7 填充，关闭 Node 默认的 16 字节自动去填充，
  // 改按消息自带的长度前缀解析（尾部填充自然被忽略）
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, key.slice(0, 16))
  decipher.setAutoPadding(false)
  const plain = Buffer.concat([decipher.update(Buffer.from(encrypt, 'base64')), decipher.final()])
  const length = plain.readUInt32BE(16)
  return {
    message: plain.slice(20, 20 + length).toString('utf8'),
    appId: plain.slice(20 + length).toString('utf8')
  }
}
