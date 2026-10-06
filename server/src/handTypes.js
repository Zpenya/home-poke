// 牌型识别、比较、提示（核心引擎，平台无关）
import { SMALL_JOKER, BIG_JOKER } from './cards.js';

export function countByRank(cards) {
  const m = new Map();
  for (const c of cards) m.set(c.rank, (m.get(c.rank) || 0) + 1);
  return m; // rank -> 张数
}

function isConsecutive(ranks) {
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

// 识别一组牌的牌型；非法返回 null
// 返回字段：type, mainRank（比较基准）, length（组数/顺子长度）, size（炸弹条数）
export function handType(cards) {
  if (!cards || cards.length === 0) return null;
  const n = cards.length;
  const counts = countByRank(cards);
  const ranks = [...counts.keys()].sort((a, b) => a - b);

  // 天王炸：2 小王 + 2 大王
  if (n === 4 && counts.get(SMALL_JOKER) === 2 && counts.get(BIG_JOKER) === 2) {
    return { type: 'rocket', size: 4, mainRank: BIG_JOKER, length: 1 };
  }

  // 只有一个点数
  if (ranks.length === 1) {
    const r = ranks[0];
    const cnt = counts.get(r);
    if (cnt === 1) return { type: 'single', mainRank: r, length: 1 };
    if (cnt === 2) return { type: 'pair', mainRank: r, length: 1 };
    if (cnt === 3) return { type: 'triple', mainRank: r, length: 1 };
    if (cnt >= 4 && cnt <= 8) return { type: 'bomb', size: cnt, mainRank: r, length: 1 };
    return null;
  }

  // 三带一（4 张：3 + 1 单）
  if (n === 4) {
    const t = ranks.find((r) => counts.get(r) === 3);
    if (t != null) {
      const others = ranks.filter((r) => r !== t);
      if (others.length === 1 && counts.get(others[0]) === 1) {
        return { type: 'triple_single', mainRank: t, length: 1 };
      }
    }
    return null;
  }

  // 三带二（5 张：3 + 1 对）
  if (n === 5) {
    const t = ranks.find((r) => counts.get(r) === 3);
    const p = ranks.find((r) => counts.get(r) === 2);
    if (t != null && p != null && ranks.length === 2) {
      return { type: 'triple_pair', mainRank: t, length: 1 };
    }
  }

  // 顺子：全部为单张，>=5 张连续，不含 2(15) 和王
  if (n >= 5 && ranks.every((r) => counts.get(r) === 1)) {
    if (ranks[ranks.length - 1] <= 14 && isConsecutive(ranks)) {
      return { type: 'straight', mainRank: ranks[0], length: n };
    }
  }

  // 连对：全部为对子，>=3 组连续，不含 2 和王
  if (ranks.length >= 3 && ranks.every((r) => counts.get(r) === 2)) {
    if (ranks[ranks.length - 1] <= 14 && isConsecutive(ranks)) {
      return { type: 'pairs_straight', mainRank: ranks[0], length: ranks.length };
    }
  }

  // 飞机主体候选：恰好 3 张且点数 <=14（不含 2、王）
  const tripleRanks = ranks.filter((r) => counts.get(r) === 3 && r <= 14).sort((a, b) => a - b);

  // 飞机（不带翅膀）
  if (tripleRanks.length >= 2 && tripleRanks.length === ranks.length && isConsecutive(tripleRanks)) {
    return { type: 'airplane', mainRank: tripleRanks[0], length: tripleRanks.length };
  }

  // 飞机带翅膀：三张主体连续，其余只能是单张或对子
  if (
    tripleRanks.length >= 2 &&
    isConsecutive(tripleRanks) &&
    ranks.every((r) => counts.get(r) === 3 || counts.get(r) <= 2)
  ) {
    const k = tripleRanks.length;
    const body = new Set(tripleRanks);
    const restRanks = ranks.filter((r) => !body.has(r));
    const restCount = restRanks.reduce((s, r) => s + counts.get(r), 0);
    if (restCount === k && restRanks.every((r) => counts.get(r) === 1)) {
      return { type: 'airplane_singles', mainRank: tripleRanks[0], length: k };
    }
    if (restCount === 2 * k && restRanks.every((r) => counts.get(r) === 2)) {
      return { type: 'airplane_pairs', mainRank: tripleRanks[0], length: k };
    }
  }

  // 四带二 / 四带两对（普通牌型，不是炸弹）
  const fourRanks = ranks.filter((r) => counts.get(r) === 4);
  if (fourRanks.length === 1) {
    const fr = fourRanks[0];
    const restRanks = ranks.filter((r) => r !== fr);
    const restCount = restRanks.reduce((s, r) => s + counts.get(r), 0);
    if (restCount === 2) {
      return { type: 'four_two', mainRank: fr, length: 1 };
    }
    if (restCount === 4 && restRanks.length === 2 && restRanks.every((r) => counts.get(r) === 2)) {
      return { type: 'four_two_pairs', mainRank: fr, length: 1 };
    }
  }

  return null;
}

export function isBomb(ht) {
  return ht && (ht.type === 'bomb' || ht.type === 'rocket');
}

// 炸弹/天王炸的比较分：先比条数，再比点数；天王炸最大
export function bombScore(ht) {
  if (ht.type === 'rocket') return 10000;
  if (ht.type === 'bomb') return ht.size * 100 + ht.mainRank;
  return 0;
}

// play 能否压过 last；last 为 null 表示自由出牌
export function canBeat(play, last) {
  if (!play) return false;
  if (!last) return true;
  if (play.type === 'rocket') return true;
  if (play.type === 'bomb') {
    if (last.type === 'rocket') return false;
    if (last.type === 'bomb') return bombScore(play) > bombScore(last);
    return true;
  }
  if (isBomb(last)) return false;
  if (play.type !== last.type) return false;
  if (play.length !== last.length) return false;
  return play.mainRank > last.mainRank;
}

function dedupKey(cards) {
  return cards.map((c) => c.id).sort().join('|');
}

function cost(ht) {
  return isBomb(ht) ? 1_000_000 + bombScore(ht) : ht.mainRank * 1000 + ht.length * 10;
}

// 枚举手牌中所有能压过 last 的出牌组合（近似完备，带牌取最小），按代价从小到大返回
export function findBeats(hand, last) {
  const byRank = new Map();
  for (const c of hand) {
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank).push(c);
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const out = new Map();

  const take = (r, n) => byRank.get(r).slice(0, n);
  const has = (r, n) => byRank.has(r) && byRank.get(r).length >= n;
  const push = (cards) => {
    const ht = handType(cards);
    if (ht && canBeat(ht, last)) {
      const k = dedupKey(cards);
      if (!out.has(k)) out.set(k, { cards, ht });
    }
  };
  const singlesOutside = (exclude, k) => {
    const pool = [];
    for (const r of ranks) if (!exclude.has(r)) pool.push(...byRank.get(r));
    pool.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
    return pool.slice(0, k);
  };
  const pairsOutside = (exclude, k) => {
    const res = [];
    for (const r of ranks) {
      if (!exclude.has(r) && byRank.get(r).length >= 2) {
        res.push(...take(r, 2));
        if (res.length >= 2 * k) break;
      }
    }
    return res.slice(0, 2 * k);
  };

  // 天王炸
  if (has(SMALL_JOKER, 2) && has(BIG_JOKER, 2)) {
    push([...take(SMALL_JOKER, 2), ...take(BIG_JOKER, 2)]);
  }
  // 四条~八条
  for (const r of ranks) {
    const cnt = byRank.get(r).length;
    for (let s = 4; s <= cnt; s++) push(take(r, s));
  }

  if (last == null) {
    if (hand.length) push([byRank.get(ranks[0])[0]]);
    return [...out.values()].sort((a, b) => cost(a.ht) - cost(b.ht));
  }

  switch (last.type) {
    case 'single':
      for (const r of ranks) if (r > last.mainRank) push(take(r, 1));
      break;
    case 'pair':
      for (const r of ranks) if (r > last.mainRank && byRank.get(r).length >= 2) push(take(r, 2));
      break;
    case 'triple':
      for (const r of ranks) if (r > last.mainRank && byRank.get(r).length >= 3) push(take(r, 3));
      break;
    case 'triple_single':
      for (const r of ranks) {
        if (r > last.mainRank && byRank.get(r).length >= 3) {
          const add = singlesOutside(new Set([r]), 1);
          if (add.length === 1) push([...take(r, 3), ...add]);
        }
      }
      break;
    case 'triple_pair':
      for (const r of ranks) {
        if (r > last.mainRank && byRank.get(r).length >= 3) {
          const pr = ranks.find((x) => x !== r && byRank.get(x).length >= 2);
          if (pr != null) push([...take(r, 3), ...take(pr, 2)]);
        }
      }
      break;
    case 'straight': {
      const L = last.length;
      for (let s = last.mainRank + 1; s + L - 1 <= 14; s++) {
        const cs = [];
        let ok = true;
        for (let r = s; r < s + L; r++) {
          if (!has(r, 1)) { ok = false; break; }
          cs.push(take(r, 1)[0]);
        }
        if (ok) push(cs);
      }
      break;
    }
    case 'pairs_straight': {
      const L = last.length;
      for (let st = last.mainRank + 1; st + L - 1 <= 14; st++) {
        const cs = [];
        let ok = true;
        for (let r = st; r < st + L; r++) {
          if (!has(r, 2)) { ok = false; break; }
          cs.push(...take(r, 2));
        }
        if (ok) push(cs);
      }
      break;
    }
    case 'airplane':
    case 'airplane_singles':
    case 'airplane_pairs': {
      const k = last.length;
      for (let st = 3; st + k - 1 <= 14; st++) {
        let ok = true;
        for (let r = st; r < st + k; r++) {
          if (!has(r, 3)) { ok = false; break; }
        }
        if (!ok) continue;
        const body = [];
        const ex = new Set();
        for (let r = st; r < st + k; r++) { body.push(...take(r, 3)); ex.add(r); }
        if (last.type === 'airplane') push(body);
        if (last.type === 'airplane_singles') {
          const add = singlesOutside(ex, k);
          if (add.length === k) push([...body, ...add]);
        }
        if (last.type === 'airplane_pairs') {
          const add = pairsOutside(ex, k);
          if (add.length === 2 * k) push([...body, ...add]);
        }
      }
      break;
    }
    case 'four_two':
      for (const r of ranks) {
        if (r > last.mainRank && byRank.get(r).length >= 4) {
          const add = singlesOutside(new Set([r]), 2);
          if (add.length === 2) push([...take(r, 4), ...add]);
        }
      }
      break;
    case 'four_two_pairs':
      for (const r of ranks) {
        if (r > last.mainRank && byRank.get(r).length >= 4) {
          const add = pairsOutside(new Set([r]), 2);
          if (add.length === 4) push([...take(r, 4), ...add]);
        }
      }
      break;
  }

  return [...out.values()].sort((a, b) => cost(a.ht) - cost(b.ht));
}
