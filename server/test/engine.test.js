import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handType, canBeat, findBeats, isBomb, bombScore } from '../src/handTypes.js';

let seq = 0;
function c(rank, suit = 0, deck = 0) {
  return { id: `t${seq++}-${rank}-${suit}-${deck}`, rank, suit, deck };
}
// 生成 n 张同点数（自动分配花色/副号）
function nCards(rank, count) {
  const res = [];
  if (rank >= 16) {
    for (let i = 0; i < count; i++) res.push(c(rank, 4, i));
    return res;
  }
  for (let deck = 0; deck < 2 && res.length < count; deck++) {
    for (let suit = 0; suit < 4 && res.length < count; suit++) res.push(c(rank, suit, deck));
  }
  return res.slice(0, count);
}
function rangeRanks(ranks) {
  return ranks.map((r, i) => c(r, i % 4, 0));
}

test('单张/对子/三张', () => {
  assert.equal(handType(nCards(5, 1)).type, 'single');
  assert.equal(handType(nCards(9, 2)).type, 'pair');
  assert.equal(handType(nCards(17, 2)).type, 'pair'); // 大王对
  assert.equal(handType(nCards(16, 2)).type, 'pair'); // 小王对
  assert.equal(handType(nCards(10, 3)).type, 'triple');
  assert.equal(handType([...nCards(16, 1), ...nCards(17, 1)]), null); // 一大一小不成对
});

test('三带一/三带二', () => {
  assert.equal(handType([...nCards(5, 3), ...nCards(7, 1)]).type, 'triple_single');
  assert.equal(handType([...nCards(5, 3), ...nCards(17, 1)]).type, 'triple_single'); // 带大王
  assert.equal(handType([...nCards(5, 3), ...nCards(7, 2)]).type, 'triple_pair');
  assert.equal(handType([...nCards(5, 3), ...nCards(17, 2)]).type, 'triple_pair'); // 带大王对
  assert.equal(handType([...nCards(5, 3), ...nCards(7, 1), ...nCards(8, 1)]), null);
});

test('顺子', () => {
  assert.equal(handType(rangeRanks([3, 4, 5, 6, 7])).type, 'straight');
  assert.equal(handType(rangeRanks([10, 11, 12, 13, 14])).type, 'straight');
  assert.equal(handType(rangeRanks([3, 4, 5, 6])), null); // 不足 5
  assert.equal(handType(rangeRanks([3, 4, 5, 6, 8])), null); // 不连续
  assert.equal(handType(rangeRanks([11, 12, 13, 14, 15])), null); // 含 2
  assert.equal(handType(rangeRanks([14, 15, 16, 17, 3])), null);
});

test('连对', () => {
  const cs = [3, 4, 5].flatMap((r) => nCards(r, 2));
  assert.equal(handType(cs).type, 'pairs_straight');
  assert.equal(handType([3, 4].flatMap((r) => nCards(r, 2))), null); // 不足 3 对
  assert.equal(handType([13, 14, 15].flatMap((r) => nCards(r, 2))), null); // 含 2
});

test('飞机与翅膀', () => {
  assert.equal(handType([...nCards(3, 3), ...nCards(4, 3)]).type, 'airplane');
  assert.equal(
    handType([...nCards(3, 3), ...nCards(4, 3), ...nCards(5, 1), ...nCards(6, 1)]).type,
    'airplane_singles'
  );
  assert.equal(
    handType([...nCards(3, 3), ...nCards(4, 3), ...nCards(5, 2), ...nCards(6, 2)]).type,
    'airplane_pairs'
  );
  // 数量不匹配
  assert.equal(handType([...nCards(3, 3), ...nCards(4, 3), ...nCards(5, 2)]), null);
  // 混带
  assert.equal(
    handType([...nCards(3, 3), ...nCards(4, 3), ...nCards(5, 1), ...nCards(6, 2)]),
    null
  );
  // 主体含 2
  assert.equal(handType([...nCards(14, 3), ...nCards(15, 3)]), null);
});

test('炸弹：四条~八条', () => {
  for (let s = 4; s <= 8; s++) {
    const ht = handType(nCards(6, s));
    assert.equal(ht.type, 'bomb');
    assert.equal(ht.size, s);
  }
});

test('天王炸', () => {
  const ht = handType([...nCards(16, 2), ...nCards(17, 2)]);
  assert.equal(ht.type, 'rocket');
  assert.equal(handType([...nCards(16, 1), ...nCards(17, 1)]), null);
  assert.equal(handType([...nCards(16, 2), ...nCards(17, 1)]), null);
});

test('四带二/四带两对（非炸弹）', () => {
  assert.equal(handType([...nCards(5, 4), ...nCards(7, 1), ...nCards(8, 1)]).type, 'four_two');
  assert.equal(handType([...nCards(5, 4), ...nCards(7, 2)]).type, 'four_two');
  assert.equal(
    handType([...nCards(5, 4), ...nCards(7, 2), ...nCards(8, 2)]).type,
    'four_two_pairs'
  );
  assert.equal(handType([...nCards(5, 4), ...nCards(7, 4)]), null); // 两个四张
});

test('canBeat 基础', () => {
  const s5 = handType(nCards(5, 1));
  const s7 = handType(nCards(7, 1));
  assert.equal(canBeat(s7, s5), true);
  assert.equal(canBeat(s5, s7), false);
  assert.equal(canBeat(handType(nCards(5, 2)), s5), false); // 对子压不了单张
  assert.equal(canBeat(handType(nCards(5, 1)), null), true); // 自由出牌
});

test('canBeat 炸弹链', () => {
  const straight = handType(rangeRanks([3, 4, 5, 6, 7]));
  const b4 = handType(nCards(5, 4));
  const b5 = handType(nCards(6, 5));
  const b4big = handType(nCards(14, 4));
  const rocket = handType([...nCards(16, 2), ...nCards(17, 2)]);
  assert.equal(canBeat(b4, straight), true);
  assert.equal(canBeat(b5, b4), true);
  assert.equal(canBeat(b4, b5), false);
  assert.equal(canBeat(b4big, b4), true); // 同条数比点数
  assert.equal(canBeat(b4, b4big), false);
  assert.equal(canBeat(rocket, b5), true);
  assert.equal(canBeat(b5, rocket), false);
  assert.equal(canBeat(straight, b4), false); // 普通压不了炸弹
});

test('canBeat 三带只比主体', () => {
  const a = handType([...nCards(6, 3), ...nCards(17, 1)]);
  const b = handType([...nCards(5, 3), ...nCards(7, 1)]);
  assert.equal(canBeat(a, b), true);
});

test('findBeats 自由出牌给最小单', () => {
  const hand = [...nCards(10, 2), ...nCards(5, 1)];
  const res = findBeats(hand, null);
  assert.equal(res[0].ht.type, 'single');
  assert.equal(res[0].ht.mainRank, 5);
});

test('findBeats 压牌', () => {
  const last = handType(nCards(7, 1));
  const hand = [...nCards(5, 1), ...nCards(9, 1), ...nCards(10, 4)];
  const res = findBeats(hand, last);
  assert.ok(res.length >= 2); // 9 单张 + 10 炸弹
  assert.equal(res[0].ht.mainRank, 9); // 最小代价是 9
  assert.ok(res.some((x) => isBomb(x.ht)));
});

test('findBeats 无解', () => {
  const last = handType(nCards(17, 1)); // 大王
  const hand = [...nCards(5, 1), ...nCards(9, 2)];
  const res = findBeats(hand, last);
  assert.equal(res.length, 0);
});

test('bombScore 顺序', () => {
  assert.ok(bombScore(handType(nCards(5, 5))) > bombScore(handType(nCards(14, 4))));
  assert.ok(bombScore(handType([...nCards(16, 2), ...nCards(17, 2)])) > bombScore(handType(nCards(5, 8))));
});
