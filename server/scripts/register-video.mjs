// 管理员工具（可选的补充方式）：把视频注册进「一起看」视频库，不经小程序上传。
// 小程序内的上传入口保持不变，仍然可用且会走内容检测；本脚本适合
// 在电脑上快速放入大视频（跳过手机上传的漫长等待），内容由运营者负责。
//
// 用法（在 ~/web-love 目录下运行，会读取 .env 的 DATA_DIR/DB_PATH 配置）：
//   node server/scripts/register-video.mjs <本地视频路径 | http(s)直链> [标题]
//   例：node server/scripts/register-video.mjs /home/admin/our-video.mp4 我们的第一支视频
//   例：node server/scripts/register-video.mjs https://example.com/video.mp4 标题
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { addVideoRecord, initDb, videoDir } from '../db.mjs'

const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_BYTES) || 1024 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['.mp4', '.m4v', '.mov']

const [source, ...titleParts] = process.argv.slice(2)
const title = titleParts.join(' ').trim()

if (!source) {
  console.log('用法：node server/scripts/register-video.mjs <本地视频路径或http(s)直链> [标题]')
  process.exit(1)
}

const extension = path.extname(source.split('?')[0]).toLowerCase() || '.mp4'
if (!ALLOWED_EXTENSIONS.includes(extension)) {
  console.log(`不支持的格式：${extension}（仅支持 ${ALLOWED_EXTENSIONS.join(' / ')}）`)
  process.exit(1)
}

await initDb()
fs.mkdirSync(videoDir, { recursive: true })

const filename = `video_${Date.now()}_${Math.random().toString(16).slice(2)}${extension}`
const target = path.join(videoDir, filename)

if (/^https?:\/\//.test(source)) {
  console.log('开始从直链下载…')
  const response = await fetch(source)
  if (!response.ok) {
    console.log(`下载失败：HTTP ${response.status}`)
    process.exit(1)
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(target))
} else {
  if (!fs.existsSync(source)) {
    console.log(`文件不存在：${source}`)
    process.exit(1)
  }
  console.log('复制文件到视频库…')
  fs.copyFileSync(source, target)
}

const size = fs.statSync(target).size
if (size > MAX_VIDEO_BYTES) {
  try { fs.unlinkSync(target) } catch {}
  console.log(`文件 ${(size / 1024 / 1024).toFixed(1)}MB 超过 1GB 限制，已丢弃`)
  process.exit(1)
}

const id = `video_${Date.now()}_${Math.random().toString(16).slice(2)}`
addVideoRecord({
  id,
  title,
  filename,
  sizeBytes: size,
  openid: process.env.ADMIN_OPENID || 'local_xiaoqiu',
  status: 'ready'
})

console.log('已注册进视频库 ✅')
console.log(`  标题：${title || '未命名视频'}`)
console.log(`  大小：${(size / 1024 / 1024).toFixed(1)}MB`)
console.log(`  编号：${id}`)
console.log('打开小程序「一起看」即可看到并发起观看。')
