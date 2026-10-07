// 数据访问层：当前用 JSON 文件存储；所有接口保持独立，
// 后续切换 MySQL 时仅需替换本文件为等接口的实现（users/games 两张表）。
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GAMES_FILE = path.join(DATA_DIR, 'games.json');

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

// 单实例、内存缓存 + 串行落盘；文件方式对"用户不多"足够，接口可换数据库
class FileStore {
  constructor() {
    this.users = new Map(); // name -> {name, salt, hash, createdAt, stats}
    this.games = []; // [{id,time,results:[{name,rank}]}]
    this._ready = this._load();
    this._writeChain = Promise.resolve();
  }

  async _load() {
    try {
      const raw = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
      this.users = new Map(Object.entries(raw));
    } catch { this.users = new Map(); }
    try { this.games = JSON.parse(await fs.readFile(GAMES_FILE, 'utf8')); }
    catch { this.games = []; }
  }

  _persist() {
    // 串行写，避免并发落盘互相覆盖
    this._writeChain = this._writeChain.then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(USERS_FILE, JSON.stringify(Object.fromEntries(this.users), null, 2));
      await fs.writeFile(GAMES_FILE, JSON.stringify(this.games, null, 2));
    });
    return this._writeChain;
  }

  async findUser(name) { await this._ready; return this.users.get(String(name)) || null; }

  // 登录：用户不存在则自动创建（首登即注册）
  async login(name, password) {
    await this._ready;
    name = String(name || '').trim();
    if (!name) return null;
    let user = this.users.get(name);
    if (!user) {
      const salt = crypto.randomBytes(16).toString('hex');
      user = { name, salt, hash: hashPassword(password, salt), createdAt: Date.now(), stats: { games: 0, wins: 0, rankSum: 0 } };
      this.users.set(name, user);
      await this._persist();
      return user;
    }
    if (user.hash !== hashPassword(password, user.salt)) return null;
    return user;
  }

  // 一局结束：记录名次（含局号/进贡摘要），累加各玩家统计
  async recordRound(results, roundNo, tribute) {
    await this._ready;
    if (!Array.isArray(results) || !results.length) return;
    this.games.push({ id: this.games.length + 1, time: Date.now(), round: roundNo || 0, results, tribute: tribute || "" });
    if (this.games.length > 5000) this.games = this.games.slice(-5000);
    for (const { name, rank } of results) {
      const u = this.users.get(String(name));
      if (!u) continue;
      u.stats.games += 1;
      u.stats.rankSum += rank;
      if (rank === 1) u.stats.wins += 1;
    }
    await this._persist();
  }

  // 历史对局：返回最新若干局（供前端"历史对局"页展示）
  async listGames(limit = 30) {
    await this._ready;
    return this.games.slice(-limit).reverse().map((g) => ({
      id: g.id, round: g.round, time: g.time, tribute: g.tribute || "", results: g.results,
    }));
  }

  async playerStats(name) {
    await this._ready;
    const u = this.users.get(String(name));
    if (!u) return null;
    const s = u.stats;
    return { name: u.name, games: s.games, wins: s.wins, rankSum: s.rankSum, winRate: s.games ? +(s.wins / s.games).toFixed(3) : 0 };
  }

  // 排名：按胜场降序，其次胜率，其次名次均值
  async ranking(limit = 20) {
    await this._ready;
    return [...this.users.values()]
      .filter((u) => u.stats.games > 0)
      .map((u) => {
        const s = u.stats;
        return { name: u.name, games: s.games, wins: s.wins, rankSum: s.rankSum, winRate: s.games ? +(s.wins / s.games).toFixed(3) : 0 };
      })
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || a.rankSum - b.rankSum)
      .slice(0, limit);
  }
}

export const db = new FileStore();
