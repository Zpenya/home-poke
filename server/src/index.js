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
const tokenIndex = new Map(); // token -> { code, seat }（房间座位凭证）
const loginSessions = new Map(); // 登录会话 token -> 昵称（刷新后恢复登录态）
const onlineUsers = new Set(); // 在线玩家昵称（登录即加入，断开即移除）
const PORT = process.env.PORT || 8080;

function genRoomCode() {
  let code;
  do {
    code = String(100000 + Math.floor(Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

// 查找某账号已占用的座位（一个账号只能同时存在于一个房间一个座位，防重复进房）
function findPlayerRoom(name) {
  for (const [, room] of rooms) {
    const seat = room.players.findIndex((p) => p && !p.isBot && p.name === name);
    if (seat >= 0) return { room, seat };
  }
  return null;
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
      onlineUsers.add(user.name);
      const sessionToken = crypto.randomUUID();
      loginSessions.set(sessionToken, user.name);
      const stats = await db.playerStats(user.name);
      reply(ws, { type: 'login_ok', name: user.name, stats, token: sessionToken });
      break;
    }
    case 'resume_session': {
      // 刷新后恢复登录态（不进入任何房间）
      const name = loginSessions.get(String(msg.token || ''));
      if (!name) return reply(ws, { type: 'login_fail', message: '登录会话已失效' });
      ws._userName = name;
      onlineUsers.add(name);
      const stats = await db.playerStats(name);
      reply(ws, { type: 'login_ok', name, stats, token: msg.token });
      break;
    }
    case 'get_online': {
      reply(ws, { type: 'online', list: [...onlineUsers] });
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
      const name = ws._userName || String(msg.name || '房主');
      const dup = findPlayerRoom(name);
      if (dup) return replyError(ws, '你已在房间中，请先退出');
      const code = genRoomCode();
      const room = new Room(code, db);
      rooms.set(code, room);
      const token = crypto.randomUUID();
      const seat = room.addPlayer(name, ws, token);
      tokenIndex.set(token, { code, seat });
      reply(ws, { type: 'room_created', code, seat, token });
      break;
    }
    case 'join_room': {
      const name = ws._userName || String(msg.name || '玩家');
      const dup = findPlayerRoom(name);
      if (dup) return replyError(ws, '你已在房间中，请先退出');
      const code = String(msg.roomCode || '');
      const room = rooms.get(code);
      if (!room) return replyError(ws, '房间不存在');
      if (room.occupied() >= 6) return replyError(ws, '房间已满');
      const token = crypto.randomUUID();
      const seat = room.addPlayer(name, ws, token);
      tokenIndex.set(token, { code, seat });
      reply(ws, { type: 'room_joined', code, seat, token });
      break;
    }
    case 'list_rooms': {
      // 大厅房间列表：只列出尚未开局、且还有空位的房间，供点击加入
      const list = [...rooms.entries()].map(([code, room]) => ({
        code,
        count: room.occupied(),
        host: (room.players[room.hostSeat] || {}).name || '',
        state: room.game.state,
      })).filter((r) => r.count > 0 && r.count < 6 && r.state === 'idle');
      reply(ws, { type: 'rooms', list });
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
    case 'restart': ws._room?.restartGame(ws._seat); break;
    case 'play': ws._room?.game.play(ws._seat, msg.cardIds); break;
    case 'pass': ws._room?.game.pass(ws._seat); break;
    case 'hint': ws._room?.game.hint(ws._seat); break;
    case 'tribute': ws._room?.game.submitTribute(ws._seat, msg.cardId); break;
    case 'return_tribute': ws._room?.game.submitReturn(ws._seat, msg.cardId); break;
    case 'leave_room':
      // 主动退出：清空座位（区别于网络断开时保留座位的 disconnect），回大厅
      if (ws._room && ws._seat >= 0) ws._room.removePlayer(ws._seat);
      ws._room = null;
      ws._seat = -1;
      break;
    default:
      replyError(ws, '未知消息类型');
  }
}

// 同一端口：HTTP 托管网页（GET / 返回 index.html）与静态资源（/assets/*），WebSocket 复用同一 server
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    try {
      const html = await fs.readFile(WEB_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('网页文件不存在：' + WEB_FILE);
    }
  } else if (req.method === 'GET' && url.startsWith('/assets/')) {
    const base = path.dirname(WEB_FILE);
    const file = path.join(base, url.replace(/^\/+/, ''));
    if (!file.startsWith(base + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
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
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return replyError(ws, '消息格式错误'); }
    try { await handle(ws, msg); } catch (e) { console.error('handle error:', e); replyError(ws, '服务器内部错误'); }
  });
  ws.on('close', () => {
    if (ws._userName) onlineUsers.delete(ws._userName);
    if (ws._room && ws._seat >= 0) ws._room.disconnect(ws._seat); // 网络断开：保留座位，等待重连恢复
  });
});

// 心跳保活：定期 ping，超时未 pong 判定连接已死（半开 TCP），主动 terminate 并清理，避免僵尸连接
const HEARTBEAT_MS = 30000;
const hbTimer = setInterval(() => {
  wss.clients.forEach((c) => {
    if (c.isAlive === false) { c.terminate(); return; }
    c.isAlive = false;
    try { c.ping(); } catch { c.terminate(); }
  });
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(hbTimer));
process.on('SIGINT', () => { clearInterval(hbTimer); process.exit(0); });

server.listen(PORT, () => {
  console.log(`六人扑克服务器已启动，监听端口 ${PORT}`);
  console.log(`  网页入口：http://localhost:${PORT}/  （WebSocket 同源 wss/ws）`);
  console.log(`  数据目录：${process.env.DATA_DIR || '<server>/data'}`);
  console.log(`  网页文件：${WEB_FILE}（覆盖后刷新即最新）`);
});
