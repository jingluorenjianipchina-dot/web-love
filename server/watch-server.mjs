// 「一起看」WebSocket 服务：房间进出、播放状态同步、房间内聊天。
// 协议（JSON）：
//   客户端 → 服务器：join{roomId, openid} / state{playing, position} / chat{content} / leave
//   服务器 → 客户端：joined{room, video, state, peerOnline, messages} / peer-online / peer-offline
//                    state{from, playing, position} / chat{message} / chat-rejected{message}
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

function safeSend(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

export function setupWatchServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/watch' })
  // roomId → { videoId, conns: Map<openid, Set<ws>>, state: {playing, position, updatedAt}, finishTimer }
  const rooms = new Map()

  function getRoomState(roomId) {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        conns: new Map(),
        state: { playing: false, position: 0, updatedAt: Date.now() },
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
          state: { playing: roomState.state.playing, position: roomState.state.position },
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
        const roomState = rooms.get(roomId)
        if (!roomState) return
        const position = Math.max(0, Number(msg.position) || 0)
        roomState.state = { playing: Boolean(msg.playing), position, updatedAt: Date.now() }
        broadcast(roomId, { type: 'state', from: openid, playing: roomState.state.playing, position })
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
