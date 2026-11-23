// 房间与对局状态持久化：每次状态变更debounce落盘，进程重启后可完整恢复
// 存储仍是文件（data/rooms/*.json、data/sessions.json），接口独立，后续可换 MySQL/Redis
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ROOMS_DIR = path.join(DATA_DIR, 'rooms');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// 串行写队列：避免并发落盘互相覆盖
let chain = Promise.resolve();
function enqueue(fn) {
  chain = chain.then(fn).catch((e) => console.error('[persist] 落盘失败:', e.message));
  return chain;
}

export function saveRoom(room) {
  const code = String(room.code);
  const data = JSON.stringify(room.toData(), null, 2);
  return enqueue(async () => {
    await fs.mkdir(ROOMS_DIR, { recursive: true });
    await fs.writeFile(path.join(ROOMS_DIR, code + '.json'), data);
  });
}

export function deleteRoomFile(code) {
  return enqueue(async () => {
    try { await fs.unlink(path.join(ROOMS_DIR, String(code) + '.json')); } catch { /* 已不存在 */ }
  });
}

// 启动时读取全部房间快照
export async function loadRooms() {
  let files = [];
  try { files = await fs.readdir(ROOMS_DIR); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(await fs.readFile(path.join(ROOMS_DIR, f), 'utf8')));
    } catch (e) {
      console.warn('[persist] 跳过损坏的房间文件', f, e.message);
    }
  }
  return out;
}

// 登录会话持久化：服务重启后刷新页面仍可恢复登录态
export function saveSessions(map) {
  const obj = Object.fromEntries(map);
  return enqueue(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(SESSIONS_FILE, JSON.stringify(obj, null, 2));
  });
}

export async function loadSessions() {
  try { return JSON.parse(await fs.readFile(SESSIONS_FILE, 'utf8')); } catch { return {}; }
}

// 进程退出前：尽量把所有房间同步刷盘（best-effort）
export async function flushAllRooms(rooms) {
  for (const [, room] of rooms) {
    try { saveRoom(room); } catch { /* ignore */ }
  }
  try { await chain; } catch { /* ignore */ }
}
