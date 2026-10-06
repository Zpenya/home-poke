// 调试用简单机器人：贪心拆牌
import { maxRank } from './cards.js';
import { findBeats } from './handTypes.js';

export function botTributeChoice(game, seat) {
  const hand = game.hands[seat];
  const mr = maxRank(hand);
  return hand.find((c) => c.rank === mr).id;
}

export function botReturnChoice(game, seat, forbiddenId) {
  const sorted = [...game.hands[seat]].sort((a, b) => a.rank - b.rank);
  return sorted.find((c) => c.id !== forbiddenId).id;
}

// 自由出牌：贪心，优先出能一次减少最多手牌的非炸弹组合
function chooseFree(hand) {
  const byRank = new Map();
  for (const c of hand) {
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank).push(c);
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const take = (r, n) => byRank.get(r).slice(0, n);

  // 最长连续段
  function longest(candidates) {
    let best = [];
    for (let i = 0; i < candidates.length; i++) {
      const cur = [candidates[i]];
      for (let j = i + 1; j < candidates.length && candidates[j] === cur[cur.length - 1] + 1; j++) {
        cur.push(candidates[j]);
      }
      if (cur.length > best.length) best = cur;
    }
    return best;
  }

  // 1. 飞机（优先带翅膀）
  const triRanks = ranks.filter((r) => r <= 14 && byRank.get(r).length >= 3);
  const plane = longest(triRanks);
  if (plane.length >= 2) {
    const k = plane.length;
    const body = plane.flatMap((r) => take(r, 3));
    const ex = new Set(plane);
    const pairs = ranks.filter((r) => !ex.has(r) && byRank.get(r).length >= 2);
    if (pairs.length >= k) {
      return { cardIds: [...body, ...pairs.slice(0, k).flatMap((r) => take(r, 2))] };
    }
    const singles = ranks.filter((r) => !ex.has(r)).flatMap((r) => take(r, 1));
    if (singles.length >= k) return { cardIds: [...body, ...singles.slice(0, k)] };
    return { cardIds: body };
  }

  // 2. 连对
  const pairRanks = ranks.filter((r) => r <= 14 && byRank.get(r).length >= 3 - 1);
  const pairsStraight = longest(pairRanks);
  if (pairsStraight.length >= 3) return { cardIds: pairsStraight.flatMap((r) => take(r, 2)) };

  // 3. 顺子
  const straight = longest(ranks.filter((r) => r <= 14));
  if (straight.length >= 5) return { cardIds: straight.map((r) => take(r, 1)[0]) };

  // 4. 三带二 / 三带一 / 三张
  const tr = ranks.find((r) => byRank.get(r).length >= 3);
  if (tr != null) {
    const pr = ranks.find((r) => r !== tr && byRank.get(r).length >= 2);
    if (pr != null) return { cardIds: [...take(tr, 3), ...take(pr, 2)] };
    const sr = ranks.find((r) => r !== tr);
    if (sr != null) return { cardIds: [...take(tr, 3), ...take(sr, 1)] };
    return { cardIds: take(tr, 3) };
  }

  // 5. 对子 / 单张
  const pr = ranks.find((r) => byRank.get(r).length >= 2);
  if (pr != null) return { cardIds: take(pr, 2) };
  return { cardIds: [take(ranks[0], 1)[0]] };
}

export function botPlay(game, seat) {
  const hand = game.hands[seat];
  const last = game.table ? game.table.ht : null;
  if (last == null) {
    const r = chooseFree(hand);
    return { cardIds: r.cardIds.map((c) => c.id) };
  }

  const beats = findBeats(hand, last);
  if (beats.length === 0) return { pass: true };
  const first = beats[0];
  // 炸弹不轻易拆：手牌多时倾向 Pass
  if (first.ht.type === 'bomb' || first.ht.type === 'rocket') {
    if (hand.length > 5 && Math.random() < 0.6) return { pass: true };
  }
  return { cardIds: first.cards.map((c) => c.id) };
}
