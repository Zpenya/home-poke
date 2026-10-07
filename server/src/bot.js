// 争上游机器人：适度智能出牌
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

// 冲刺：一次性出能清掉最多牌的组合（飞机/连对/顺子/三带/对子/单张）
function chooseBig(hand, byRank, ranks, take) {
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
    if (pairs.length >= k) return { cardIds: [...body, ...pairs.slice(0, k).flatMap((r) => take(r, 2))] };
    const singles = ranks.filter((r) => !ex.has(r)).flatMap((r) => take(r, 1));
    if (singles.length >= k) return { cardIds: [...body, ...singles.slice(0, k)] };
    return { cardIds: body };
  }
  // 2. 连对
  const pairRanks = ranks.filter((r) => r <= 14 && byRank.get(r).length >= 2);
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

// 自由出牌：手牌多时先出小散牌（孤立单张、最小对子），保留顺子/连对/飞机/炸弹；
// 手牌少时冲刺一次清最多
function chooseFree(hand) {
  const byRank = new Map();
  for (const c of hand) {
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank).push(c);
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const take = (r, n) => byRank.get(r).slice(0, n);

  if (hand.length > 6) {
    // 常规：先出最小的孤立单张（散牌，最难带走，先消耗掉）
    const lonely = ranks.filter((r) => byRank.get(r).length === 1);
    if (lonely.length) return { cardIds: [byRank.get(lonely[0])[0].id] };
    // 没有散单张：出最小对子（保留大牌和组合）
    const pair = ranks.find((r) => byRank.get(r).length === 2);
    if (pair != null) return { cardIds: take(pair, 2).map((c) => c.id) };
  }
  // 冲刺或没有散牌可出：出能清掉最多牌的组合
  const big = chooseBig(hand, byRank, ranks, take);
  return { cardIds: big.cardIds.map((c) => c.id) };
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

  // 快出完：压完正好清空则必压（冲刺收尾）
  const finish = beats.find((b) => b.cards.length === hand.length);
  if (finish) return { cardIds: finish.cards.map((c) => c.id) };

  const first = beats[0];
  const isBigTarget = last.type === 'bomb' || last.type === 'rocket' || last.mainRank >= 15;
  const isBombFirst = first.ht.type === 'bomb' || first.ht.type === 'rocket';

  // 手牌还多：不要轻易用大牌/炸弹去压，保留守家
  if (hand.length > 6) {
    if (isBigTarget || isBombFirst) {
      if (Math.random() < 0.7) return { pass: true };
    }
  }
  // 手牌不多（接近出完）就压上
  return { cardIds: first.cards.map((c) => c.id) };
}
