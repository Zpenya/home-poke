import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { buildDeckPairs, deal, sortHand } from '../src/cards.js';

class MockRoom {
  constructor() {
    this.players = Array(6).fill(null).map((_, s) => ({ name: `P${s}`, isBot: false, online: true }));
    this.hostSeat = 0;
    this.sent = [];
    this.broadcasts = [];
    this.turns = [];
  }
  sendTo(seat, msg) { this.sent.push({ seat, msg }); }
  broadcast(msg) { this.broadcasts.push(msg); }
  onTurn(s) { this.turns.push(s); }
  hasSent(seat, type) { return this.sent.some((x) => x.seat === seat && x.msg.type === type); }
}

function defaultHands() {
  return deal(buildDeckPairs(), 6).map((h) => sortHand(h));
}

test('第一局：黑桃 3 持有者首发', () => {
  const room = new MockRoom();
  const game = new Game(room);
  game.startRound();
  assert.equal(game.state, 'playing');
  const start = room.broadcasts.find((m) => m.type === 'game_start');
  assert.ok(start);
  assert.ok(game.hands[start.firstSeat].some((c) => c.rank === 3 && c.suit === 0));
  assert.equal(game.currentTurn, start.firstSeat);
  assert.equal(room.turns[0], start.firstSeat);
});

test('第二局：两张大王抗贡，末游(seat5)先手且不进贡', () => {
  const room = new MockRoom();
  const game = new Game(room);
  game.round = 1;
  game.lastRoundInfo = { firstSeat: 0, lastSeat: 5 };
  game.dealNewRound = () => defaultHands(); // 默认发牌 seat5 恰有两张大王
  game.startRound();
  assert.equal(game.state, 'playing');
  assert.equal(game.currentTurn, 5);
  assert.ok(room.broadcasts.some((m) => m.type === 'resistance' && m.seat === 5));
  assert.ok(!room.broadcasts.some((m) => m.type === 'tribute_announce'));
  assert.ok(!room.hasSent(5, 'tribute_required'));
});

test('第二局：正常进贡→回贡全流程', () => {
  const room = new MockRoom();
  const game = new Game(room);
  game.round = 1;
  game.lastRoundInfo = { firstSeat: 0, lastSeat: 2 };
  game.dealNewRound = () => defaultHands();
  game.startRound();
  assert.equal(game.state, 'tribute');
  assert.deepEqual(
    { from: game.tribute.from, to: game.tribute.to, stage: game.tribute.stage },
    { from: 2, to: 0, stage: 'pay' }
  );
  assert.ok(room.hasSent(2, 'tribute_required'));

  // 进贡最大牌
  const maxR = Math.max(...game.hands[2].map((c) => c.rank));
  const tributeCard = game.hands[2].find((c) => c.rank === maxR);
  assert.equal(game.submitTribute(2, tributeCard.id), true);
  assert.equal(game.tribute.stage, 'return');
  assert.ok(room.hasSent(0, 'return_tribute_required'));
  assert.equal(game.hands[0].length, 19);
  assert.ok(game.hands[0].some((c) => c.id === tributeCard.id));

  // 回贡：选 head 手中最小且非贡牌
  const returnCard = [...game.hands[0]]
    .filter((c) => c.id !== tributeCard.id)
    .sort((a, b) => a.rank - b.rank)[0];
  assert.equal(game.submitReturn(0, returnCard.id), true);
  assert.equal(game.state, 'playing');
  assert.equal(game.currentTurn, 2);
  assert.equal(game.hands[0].length, 18);
  assert.equal(game.hands[2].length, 18);
  assert.ok(game.hands[2].some((c) => c.id === returnCard.id));
});

test('进贡校验：非最大牌被拒；不能回贡牌本身', () => {
  const room = new MockRoom();
  const game = new Game(room);
  game.round = 1;
  game.lastRoundInfo = { firstSeat: 0, lastSeat: 2 };
  game.dealNewRound = () => defaultHands();
  game.startRound();

  const small = [...game.hands[2]].sort((a, b) => a.rank - b.rank)[0];
  assert.equal(game.submitTribute(2, small.id), false);
  assert.equal(game.tribute.stage, 'pay');

  const maxR = Math.max(...game.hands[2].map((c) => c.rank));
  const tributeCard = game.hands[2].find((c) => c.rank === maxR);
  game.submitTribute(2, tributeCard.id);
  assert.equal(game.submitReturn(0, tributeCard.id), false);
  assert.equal(game.tribute.stage, 'return');
  assert.equal(game.state, 'tribute');
});
