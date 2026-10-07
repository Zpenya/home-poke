// WebSocket 入口 + 网页静态托管：消息路由、房间创建/加入、登录、战绩、断线重连
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 网页文件：默认 server/web/index.html；可用 WEB_FILE 指定，覆盖后玩家刷新即最新
const WEB_FILE = process.env.WEB_FILE || path.join(__dirname, '..', 'web', 'index.html');
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

function reply(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
}
function replyError(ws, message) { reply(ws, { type: 'error', message }); }

async function handle(ws, msg) {
  switch (msg.type) {
    case 'login': {
      const name = String(msg.name || '').trim();
      if (!name) return reply(ws, { type: 'login_fail', message: '昵称不能为空' });
      const user = await db.login(name, msg.password);
      if (!user) return reply(ws, { type: 'login_fail', message: '密码不正确' });
      ws._userName = user.name;
      const stats = await db.playerStats(user.name);
      reply(ws, { type: 'login_ok', name: user.name, stats });
      break;
    }
    case 'get_stats': {
      if (!ws._userName) return replyError(ws, '请先登录');
      const stats = await db.playerStats(ws._userName);
      reply(ws, { type: 'stats', stats });
      break;
    }
    case 'get_ranking': {
      const list = await db.ranking(20);
      reply(ws, { type: 'ranking', list });
      break;
    }
    case 'get_history': {
      const list = await db.listGames(30);
      reply(ws, { type: 'history', list });
      break;
    }
    case 'create_room': {
      const code = genRoomCode();
      const room = new Room(code, db);
      rooms.set(code, room);
      const token = crypto.randomUUID();
      const seat = room.addPlayer(ws._userName || String(msg.name || '房主'), ws, token);
      tokenIndex.set(token, { code, seat });
      reply(ws, { type: 'room_created', code, seat, token });
      break;
    }
    case 'join_room': {
      const code = String(msg.roomCode || '');
      const room = rooms.get(code);
      if (!room) return replyError(ws, '房间不存在');
      if (room.occupied() >= 6) return replyError(ws, '房间已满');
      const token = crypto.randomUUID();
      const seat = room.addPlayer(ws._userName || String(msg.name || '玩家'), ws, token);
      tokenIndex.set(token, { code, seat });
      reply(ws, { type: 'room_joined', code, seat, token });
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
      ws._userName = p.name;
      reply(ws, room.game.snapshot(info.seat));
      room.broadcastRoomState();
      break;
    }
    case 'start_game': ws._room?.startGame(ws._seat); break;
    case 'next_round': ws._room?.nextRound(ws._seat); break;
    case 'play': ws._room?.game.play(ws._seat, msg.cardIds); break;
    case 'pass': ws._room?.game.pass(ws._seat); break;
    case 'hint': ws._room?.game.hint(ws._seat); break;
    case 'tribute': ws._room?.game.submitTribute(ws._seat, msg.cardId); break;
    case 'return_tribute': ws._room?.game.submitReturn(ws._seat, msg.cardId); break;
    case 'leave_room':
      if (ws._room) ws._room.disconnect(ws._seat);
      ws._room = null;
      ws._seat = -1;
      break;
    default:
      replyError(ws, '未知消息类型');
  }
}

// 同一端口：HTTP 托管网页（GET / 返回 index.html），WebSocket 复用同一 server
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    try {
      const html = await fs.readFile(WEB_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('网页文件不存在：' + WEB_FILE);
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
});

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws._room = null;
  ws._seat = -1;
  ws._userName = null;
  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return replyError(ws, '消息格式错误'); }
    try { await handle(ws, msg); } catch (e) { console.error('handle error:', e); replyError(ws, '服务器内部错误'); }
  });
  ws.on('close', () => {
    if (ws._room && ws._seat >= 0) ws._room.disconnect(ws._seat);
  });
});

server.listen(PORT, () => {
  console.log(`六人扑克服务器已启动，监听端口 ${PORT}`);
  console.log(`  网页入口：http://localhost:${PORT}/  （WebSocket 同源 wss/ws）`);
  console.log(`  数据目录：${process.env.DATA_DIR || '<server>/data'}`);
  console.log(`  网页文件：${WEB_FILE}（覆盖后刷新即最新）`);
});
