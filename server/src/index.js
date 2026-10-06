// WebSocket 入口：消息路由、房间创建/加入、断线重连
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';

const rooms = new Map(); // code -> Room
const tokenIndex = new Map(); // token -> { code, seat }
const PORT = process.env.PORT || 8080;

function genRoomCode() {
  let code;
  do {
    code = String(100000 + Math.floor(Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

function replyError(ws, message) {
  try { ws.send(JSON.stringify({ type: 'error', message })); } catch { /* ignore */ }
}

function handle(ws, msg) {
  switch (msg.type) {
    case 'create_room': {
      const code = genRoomCode();
      const room = new Room(code);
      rooms.set(code, room);
      const token = crypto.randomUUID();
      const seat = room.addPlayer(String(msg.name || '房主'), ws, token);
      tokenIndex.set(token, { code, seat });
      ws.send(JSON.stringify({ type: 'room_created', code, seat, token }));
      break;
    }
    case 'join_room': {
      const code = String(msg.roomCode || '');
      const room = rooms.get(code);
      if (!room) return replyError(ws, '房间不存在');
      if (room.occupied() >= 6) return replyError(ws, '房间已满');
      const token = crypto.randomUUID();
      const seat = room.addPlayer(String(msg.name || '玩家'), ws, token);
      tokenIndex.set(token, { code, seat });
      ws.send(JSON.stringify({ type: 'room_joined', code, seat, token }));
      break;
    }
    case 'reconnect': {
      const info = tokenIndex.get(String(msg.token || ''));
      if (!info) return replyError(ws, '重连凭证无效');
      const room = rooms.get(info.code);
      const p = room && room.players[info.seat];
      if (!p) return replyError(ws, '座位不存在');
      p.ws = ws;
      p.online = true;
      ws._seat = info.seat;
      ws._room = room;
      ws.send(JSON.stringify(room.game.snapshot(info.seat)));
      room.broadcastRoomState();
      break;
    }
    case 'start_game':
      ws._room?.startGame(ws._seat);
      break;
    case 'next_round':
      ws._room?.nextRound(ws._seat);
      break;
    case 'play':
      ws._room?.game.play(ws._seat, msg.cardIds);
      break;
    case 'pass':
      ws._room?.game.pass(ws._seat);
      break;
    case 'hint':
      ws._room?.game.hint(ws._seat);
      break;
    case 'tribute':
      ws._room?.game.submitTribute(ws._seat, msg.cardId);
      break;
    case 'return_tribute':
      ws._room?.game.submitReturn(ws._seat, msg.cardId);
      break;
    case 'leave_room':
      if (ws._room) ws._room.disconnect(ws._seat);
      ws._room = null;
      ws._seat = -1;
      break;
    default:
      replyError(ws, '未知消息类型');
  }
}

const wss = new WebSocketServer({ port: PORT });
wss.on('connection', (ws) => {
  ws._room = null;
  ws._seat = -1;
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return replyError(ws, '消息格式错误');
    }
    handle(ws, msg);
  });
  ws.on('close', () => {
    if (ws._room && ws._seat >= 0) ws._room.disconnect(ws._seat);
  });
});

console.log(`六人扑克服务器已启动，监听端口 ${PORT}`);
