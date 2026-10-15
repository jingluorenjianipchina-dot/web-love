// 「一起看」WebSocket 服务：房间进出、播放状态同步、房间内聊天。
// 同步模型：服务端维护房间权威状态（playing/position/version/updatedAt），
// 只接受"用户主动操作"更新权威状态并广播；播放中的周期心跳不广播，
// 仅用于把偏离权威时间线的那一个客户端私发校准（详见 handleStateMessage）。
// 协议（JSON）：
//   客户端 → 服务器：join{roomId, openid}
//                    state{source:'user'|'heartbeat', playing, position}
//                    chat{content} / leave / finish / ping
//   服务器 → 客户端：joined{room, video, state{playing, position, version}, peerOnline, messages}
//                    state{from, playing, position, version, serverTime}   // 用户操作广播
//                    state-ack{version, playing, position}                 // 操作回执（含新版本号）
//                    calibrate{playing, position, version, serverTime}     // 私发校准
//                    peer-online / peer-offline / chat{message} / chat-rejected{message}
//                    error{message} / room-finished
import { WebSocketServer } from 'ws'
import {
  addRoomMessage,
  getRoom,
  getRoomMessages,
  getVideo,
  getWxOpenid,
  setRoomStatus
} from './db.mjs'
import { checkText } from './wechat-security.mjs'

const AUTO_FINISH_DELAY_MS = 60 * 1000 // 双方都离开 1 分钟后自动结束房间
const PING_INTERVAL_MS = 30 * 1000
// 心跳进度与权威时间线的偏差超过该值才私发校准：太小会频繁 seek 造成画面跳动，
// 太大则双方观感不同步。约等于两人一起看可接受的画面误差（2~3 秒）。
const HEARTBEAT_CALIBRATE_DRIFT_SECONDS = 2.5
// 心跳允许把权威时间线向前锚定的上限：心跳间隔约 3s，正常播放器两次心跳间最多快几秒；
// 大幅超前（漏操作/异常客户端）不能前移时间线（会污染其他观看者），而是把它校准拉回。
const MAX_PLAUSIBLE_FORWARD_DRIFT_SECONDS = 5
// state 位置的合法范围（服务端不知道视频时长，只做数量级防护）
const MAX_SANE_POSITION_SECONDS = 24 * 60 * 60

// 房间内存态：roomId → { conns: Map<openid, Set<ws>>, state, finishTimer }。
// 放在模块顶层，供 setupWatchServer 与 getActiveWatchRoomIds（清理任务）共用。
const rooms = new Map()

function safeSend(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

// 当前有 WebSocket 连接的房间 id（供清理任务跳过正在使用的房间）
export function getActiveWatchRoomIds() {
  const ids = []
  rooms.forEach((state, roomId) => {
    if (state.conns.size > 0) ids.push(roomId)
  })
  return ids
}

export function setupWatchServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/watch' })

  function getRoomState(roomId) {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        conns: new Map(),
        // 权威播放状态：version 单调递增，position 是 updatedAt 时刻的进度
        state: { playing: false, position: 0, version: 0, updatedAt: Date.now() },
        finishTimer: null
      })
    }
    return rooms.get(roomId)
  }

  function broadcast(roomId, payload, exceptWs = null) {
    const roomState = rooms.get(roomId)
    if (!roomState) return
    roomState.conns.forEach((set) => set.forEach((client) => {
      if (client !== exceptWs) safeSend(client, payload)
    }))
  }

  function peerOpenidCount(roomId, exceptOpenid) {
    const roomState = rooms.get(roomId)
    if (!roomState) return 0
    let count = 0
    roomState.conns.forEach((set, openid) => {
      if (openid !== exceptOpenid && set.size > 0) count += 1
    })
    return count
  }

  // 播放状态消息的统一入口。区分两类来源：
  //   user      —— 用户主动的播放/暂停/拖动：校验后更新权威状态、递增版本号并广播。
  //   heartbeat —— 播放中的周期进度汇报：绝不广播、不改 playing/version，
  //                只在偏离权威时间线时向"偏离的那个人"私发校准。
  // 旧版客户端不带 source 字段，按 user 处理（保持兼容，行为同旧版广播）。
  function handleStateMessage(ws, roomId, openid, msg) {
    const roomState = rooms.get(roomId)
    if (!roomState) return

    const playing = msg.playing === true
    const rawPosition = Number(msg.position)
    if (!Number.isFinite(rawPosition) || rawPosition < 0 || rawPosition > MAX_SANE_POSITION_SECONDS) {
      if (msg.source !== 'heartbeat') safeSend(ws, { type: 'error', message: '播放状态不合法' })
      return
    }
    const position = rawPosition
    const source = msg.source === 'heartbeat' ? 'heartbeat' : 'user'
    const now = Date.now()

    if (source === 'user') {
      const room = getRoom(roomId)
      if (room && room.status === 'finished') {
        safeSend(ws, { type: 'error', message: '该房间已结束' })
        return
      }
      roomState.state = {
        playing,
        position,
        version: roomState.state.version + 1,
        updatedAt: now
      }
      console.log(`[watch] 房间 ${roomId} 用户 ${openid.slice(0, 8)} ${playing ? '播放' : '暂停'}@${position.toFixed(1)}s → v${roomState.state.version}`)
      broadcast(roomId, {
        type: 'state',
        from: openid,
        playing,
        position,
        version: roomState.state.version,
        serverTime: now
      }, ws)
      safeSend(ws, { type: 'state-ack', version: roomState.state.version, playing, position })
      return
    }

    // —— 心跳分支：权威状态只认用户操作，心跳最多让时间线"向前"锚定或触发私发校准 ——
    const state = roomState.state
    if (playing !== state.playing) {
      // 发送方还以为房间在另一种状态（多半漏收了某次用户操作），把它拉回权威状态
      console.log(`[watch] 房间 ${roomId} 用户 ${openid.slice(0, 8)} 心跳与权威状态不符（本机 ${playing ? '播放中' : '已暂停'} / 房间 ${state.playing ? '播放中' : '已暂停'}），私发校准 v${state.version}`)
      safeSend(ws, {
        type: 'calibrate',
        playing: state.playing,
        position: Math.max(0, state.position + (state.playing ? (now - state.updatedAt) / 1000 : 0)),
        version: state.version,
        serverTime: now
      })
      return
    }
    if (!state.playing) return // 暂停中不会有合法心跳，理论上到不了这里

    const expected = state.position + (now - state.updatedAt) / 1000
    const drift = position - expected
    if (drift > HEARTBEAT_CALIBRATE_DRIFT_SECONDS && drift <= MAX_PLAUSIBLE_FORWARD_DRIFT_SECONDS) {
      // 播放快于权威时间线（在物理可能范围内）：把时间线向前锚定到它（只前进不后退，防止慢的一方被倒回去重看）
      roomState.state = { ...state, position, updatedAt: now }
      console.log(`[watch] 房间 ${roomId} 权威时间线前移 ${expected.toFixed(1)}s → ${position.toFixed(1)}s (v${state.version})`)
    } else if (Math.abs(drift) > HEARTBEAT_CALIBRATE_DRIFT_SECONDS) {
      // 落后于权威时间线（中途卡顿）或大幅超前（异常）：只校准它一个人，向权威时间线对齐
      console.log(`[watch] 房间 ${roomId} 用户 ${openid.slice(0, 8)} 心跳偏离 ${drift.toFixed(1)}s，私发校准 v${state.version}`)
      safeSend(ws, { type: 'calibrate', playing: true, position: Math.max(0, expected), version: state.version, serverTime: now })
    }
  }

  function detach(ws) {
    const joined = ws.watchSession
    if (!joined) return
    ws.watchSession = null

    const { roomId, openid } = joined
    const roomState = rooms.get(roomId)
    if (!roomState) return

    const set = roomState.conns.get(openid)
    if (set) {
      set.delete(ws)
      if (set.size === 0) roomState.conns.delete(openid)
    }

    if (roomState.conns.size === 0) {
      roomState.finishTimer = setTimeout(async () => {
        const current = rooms.get(roomId)
        if (!current || current.conns.size > 0) return
        rooms.delete(roomId)
        const room = getRoom(roomId)
        if (room && room.status !== 'finished') {
          setRoomStatus(roomId, 'finished')
          console.log(`[watch] 房间 ${roomId} 双方均已离开，自动结束`)
        }
      }, AUTO_FINISH_DELAY_MS)
    } else {
      broadcast(roomId, { type: 'peer-offline', openid })
    }
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return
      }

      if (msg.type === 'join') {
        const roomId = String(msg.roomId || '')
        const openid = String(msg.openid || '')
        const room = getRoom(roomId)
        if (!room) {
          safeSend(ws, { type: 'error', message: '房间不存在' })
          return
        }
        if (room.status === 'finished') {
          safeSend(ws, { type: 'error', message: '该房间已结束' })
          return
        }
        const video = getVideo(room.video_id)
        if (!video) {
          safeSend(ws, { type: 'error', message: '视频不存在' })
          return
        }
        if (video.status === 'checking') {
          safeSend(ws, { type: 'error', message: '视频安全检测中，请稍候再进入' })
          return
        }
        if (video.status === 'rejected') {
          safeSend(ws, { type: 'error', message: '视频未通过安全检测，不能观看' })
          return
        }

        ws.watchSession = { roomId, openid }
        const roomState = getRoomState(roomId)
        if (roomState.finishTimer) {
          clearTimeout(roomState.finishTimer)
          roomState.finishTimer = null
        }
        if (!roomState.conns.has(openid)) roomState.conns.set(openid, new Set())
        roomState.conns.get(openid).add(ws)

        const peerOnline = peerOpenidCount(roomId, openid) > 0
        if (room.status === 'waiting') setRoomStatus(roomId, 'active')

        safeSend(ws, {
          type: 'joined',
          room: { id: room.id, status: 'active', initiatorOpenid: room.initiator_openid },
          video: { id: video.id, title: video.title, url: `/api/uploads/videos/${video.filename}` },
          state: {
            playing: roomState.state.playing,
            position: roomState.state.position,
            version: roomState.state.version
          },
          peerOnline,
          messages: getRoomMessages(roomId).slice(-50)
        })
        broadcast(roomId, { type: 'peer-online', openid }, ws)
        return
      }

      if (!ws.watchSession) {
        safeSend(ws, { type: 'error', message: '请先加入房间' })
        return
      }
      const { roomId, openid } = ws.watchSession

      if (msg.type === 'state') {
        handleStateMessage(ws, roomId, openid, msg)
        return
      }

      if (msg.type === 'chat') {
        const content = String(msg.content || '').trim()
        if (!content) return
        handleChat(ws, roomId, openid, content)
        return
      }

      if (msg.type === 'finish') {
        const room = getRoom(roomId)
        if (room && room.status !== 'finished') {
          setRoomStatus(roomId, 'finished')
          broadcast(roomId, { type: 'room-finished' })
          console.log(`[watch] 房间 ${roomId} 被用户手动结束`)
        }
        rooms.delete(roomId)
        return
      }

      if (msg.type === 'leave') {
        detach(ws)
        safeSend(ws, { type: 'left' })
        return
      }

      // 客户端应用层心跳，保持 NAT 映射不断
      if (msg.type === 'ping') return
    })

    ws.on('close', () => detach(ws))
    ws.on('error', () => detach(ws))
  })

  async function handleChat(ws, roomId, openid, content) {
    const verdict = await checkText(content, { wxOpenid: getWxOpenid(openid), scene: 2, label: '房间聊天' })
    if (!verdict.ok) {
      safeSend(ws, { type: 'chat-rejected', message: verdict.message })
      return
    }

    const message = addRoomMessage({ roomId, openid, content })
    broadcast(roomId, { type: 'chat', message })
  }

  const pingTimer = setInterval(() => {
    wss.clients.forEach((client) => {
      if (!client.isAlive) {
        client.terminate()
        return
      }
      client.isAlive = false
      client.ping()
    })
  }, PING_INTERVAL_MS)
  wss.on('close', () => clearInterval(pingTimer))

  console.log('[watch] WebSocket 服务已启动（/ws/watch）')
  return wss
}
