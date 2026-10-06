// 游戏状态机：跨局复用，服务端权威
import {
  buildDeckPairs, shuffle, deal, sortHand, maxRank, hasTwoBigJokers,
} from './cards.js';
import { handType, canBeat, findBeats } from './handTypes.js';

const SEATS = 6;

// 详细出牌日志（调试用）：打印牌型、点数、组数、张数
function htDesc(ht) {
  const T = {
    single: '单张', pair: '对子', triple: '三张', triple_single: '三带一',
    triple_pair: '三带一对', straight: '顺子', pairs_straight: '连对',
    airplane: '飞机', airplane_singles: '飞机带单', airplane_pairs: '飞机带对',
    four_two: '四带二', four_two_pairs: '四带两对', bomb: `${ht.size}条炸`, rocket: '天王炸',
  };
  const name = T[ht.type] || ht.type;
  const len = ht.length > 1 ? ` ×${ht.length}组` : '';
  return `${name}(${ht.mainRank}${len})`;
}
function lastDesc(t) { return t ? htDesc(t.ht) : '自由出牌'; }

function removeCards(hand, ids) {
  const want = new Set(ids);
  const removed = [];
  for (let i = hand.length - 1; i >= 0; i--) {
    if (want.has(hand[i].id)) {
      removed.push(hand[i]);
      hand.splice(i, 1);
    }
  }
  return removed;
}

export class Game {
  constructor(room) {
    this.room = room;
    this.round = 0;
    this.state = 'idle'; // idle | tribute | playing | round_over
    this.hands = Array.from({ length: SEATS }, () => []);
    this.finishRanks = Array(SEATS).fill(0);
    this.alive = new Set();
    this.table = null; // { cards, ht, seat }
    this.currentTurn = -1;
    this.lastAttacker = -1;
    this.passCount = 0;
    this.ranking = [];
    this.tribute = null; // { from, to, card, stage }
    this.lastRoundInfo = null;
    this.log = [];
  }

  logEvent(obj) {
    this.log.push(obj);
    if (this.log.length > 20) this.log.shift();
  }

  // 抽出便于测试覆盖
  dealNewRound() {
    const deck = shuffle(buildDeckPairs());
    return deal(deck, SEATS).map((h) => sortHand(h));
  }

  startRound() {
    this.round += 1;
    this.hands = this.dealNewRound();
    this.finishRanks = Array(SEATS).fill(0);
    this.alive = new Set([0, 1, 2, 3, 4, 5]);
    this.table = null;
    this.passCount = 0;
    this.ranking = [];
    this.tribute = null;
    this.log = [];

    for (let s = 0; s < SEATS; s++) {
      this.room.sendTo(s, { type: 'deal', round: this.round, hand: this.hands[s] });
    }

    if (this.round === 1) {
      const first = this.findCardHolder(3, 0); // 黑桃 3
      this.state = 'playing';
      this.currentTurn = first;
      this.lastAttacker = first;
      this.room.broadcast({ type: 'game_start', round: 1, firstSeat: first });
      this.promptTurn();
    } else {
      const from = this.lastRoundInfo.lastSeat;
      const to = this.lastRoundInfo.firstSeat;
      if (hasTwoBigJokers(this.hands[from])) {
        this.state = 'playing';
        this.currentTurn = from;
        this.lastAttacker = from;
        this.room.broadcast({ type: 'resistance', round: this.round, seat: from });
        this.room.broadcast({ type: 'game_start', round: this.round, firstSeat: from });
        this.promptTurn();
      } else {
        this.state = 'tribute';
        this.tribute = { from, to, card: null, stage: 'pay' };
        this.room.broadcast({ type: 'tribute_announce', fromSeat: from, toSeat: to });
        this.room.sendTo(from, {
          type: 'tribute_required',
          toSeat: to,
          maxRank: maxRank(this.hands[from]),
        });
      }
    }
  }

  findCardHolder(rank, suit) {
    for (let s = 0; s < SEATS; s++) {
      if (this.hands[s].some((c) => c.rank === rank && c.suit === suit)) return s;
    }
    return 0;
  }

  // 末游进贡
  submitTribute(seat, cardId) {
    if (this.state !== 'tribute' || !this.tribute || this.tribute.stage !== 'pay') {
      return this.err(seat, '当前不是进贡环节');
    }
    const { from, to } = this.tribute;
    if (seat !== from) return this.err(seat, '还没轮到你进贡');
    const removed = removeCards(this.hands[from], [cardId]);
    if (removed.length !== 1) {
      sortHand(this.hands[from]);
      return this.err(seat, '贡牌不在你手中');
    }
    if (removed[0].rank !== maxRank(this.hands[from].concat(removed[0]))) {
      this.hands[from].push(removed[0]);
      sortHand(this.hands[from]);
      return this.err(seat, '必须进贡手中最大的牌');
    }
    const card = removed[0];
    this.hands[to].push(card);
    sortHand(this.hands[to]);
    this.tribute.card = card;
    this.tribute.stage = 'return';
    this.logEvent({ kind: 'tribute', from, to, rank: card.rank });
    this.room.broadcast({ type: 'tribute_paid', fromSeat: from, toSeat: to, rank: card.rank });
    this.room.sendTo(from, { type: 'hand_update', hand: this.hands[from] });
    this.room.sendTo(to, { type: 'hand_update', hand: this.hands[to] });
    this.room.sendTo(to, {
      type: 'return_tribute_required',
      fromSeat: from,
      forbiddenId: card.id,
    });
    return true;
  }

  // 头游回贡
  submitReturn(seat, cardId) {
    if (this.state !== 'tribute' || !this.tribute || this.tribute.stage !== 'return') {
      return this.err(seat, '当前不是回贡环节');
    }
    const { from, to, card } = this.tribute;
    if (seat !== to) return this.err(seat, '还没轮到你回贡');
    if (cardId === card.id) return this.err(seat, '不能回刚收到的那张牌');
    const removed = removeCards(this.hands[to], [cardId]);
    if (removed.length !== 1) return this.err(seat, '回贡牌不在你手中');
    this.hands[from].push(removed[0]);
    sortHand(this.hands[from]);
    this.logEvent({ kind: 'return_tribute', from: to, to: from, rank: removed[0].rank });
    this.room.broadcast({
      type: 'return_tribute_paid', fromSeat: to, toSeat: from, rank: removed[0].rank,
    });
    this.room.sendTo(from, { type: 'hand_update', hand: this.hands[from] });
    this.room.sendTo(to, { type: 'hand_update', hand: this.hands[to] });
    this.state = 'playing';
    this.currentTurn = from;
    this.lastAttacker = from;
    this.room.broadcast({ type: 'tribute_done', firstSeat: from });
    this.promptTurn();
    return true;
  }

  play(seat, cardIds) {
    if (this.state !== 'playing') return this.err(seat, '当前不是出牌环节');
    if (this.currentTurn !== seat) return this.err(seat, '还没轮到你出牌');
    if (!Array.isArray(cardIds) || cardIds.length === 0) return this.err(seat, '请选择要出的牌');
    const removed = removeCards(this.hands[seat], cardIds);
    if (removed.length !== cardIds.length) {
      removed.forEach((c) => this.hands[seat].push(c));
      sortHand(this.hands[seat]);
      return this.err(seat, '所选牌不在你手中');
    }
    const ht = handType(removed);
    if (!ht) {
      removed.forEach((c) => this.hands[seat].push(c));
      sortHand(this.hands[seat]);
      return this.err(seat, '不是合法牌型');
    }
    if (!canBeat(ht, this.table ? this.table.ht : null)) {
      removed.forEach((c) => this.hands[seat].push(c));
      sortHand(this.hands[seat]);
      return this.err(seat, '压不过当前的牌');
    }
    const prev = this.table;
    this.table = { cards: removed, ht, seat };
    this.lastAttacker = seat;
    this.passCount = 0;
    console.log(`[局${this.round}] seat${seat}(${this.room.players[seat]?.name||'?'}) 出 ${removed.length} 张 ${htDesc(ht)}，压 ${lastDesc(prev)}，剩余 ${this.hands[seat].length} 张`);
    this.logEvent({ kind: 'play', seat, cards: removed, ht });
    this.room.broadcast({ type: 'played', seat, cards: removed, ht });
    this.afterAction(seat, 'play');
    return true;
  }

  pass(seat) {
    if (this.state !== 'playing') return this.err(seat, '当前不是出牌环节');
    if (this.currentTurn !== seat) return this.err(seat, '还没轮到你');
    if (!this.table) return this.err(seat, '自由出牌时不能 Pass');
    this.passCount += 1;
    console.log(`[局${this.round}] seat${seat}(${this.room.players[seat]?.name||'?'}) Pass（放弃压 ${lastDesc(this.table)}）`);
    this.logEvent({ kind: 'pass', seat });
    this.room.broadcast({ type: 'passed', seat });
    this.afterAction(seat, 'pass');
    return true;
  }

  afterAction(seat, action) {
    if (action === 'play' && this.hands[seat].length === 0) this.finishPlayer(seat);
    if (this.alive.size === 1) {
      this.endRound();
      return;
    }
    const attackerAlive = this.alive.has(this.lastAttacker);
    const needPass = this.alive.size - (attackerAlive ? 1 : 0);
    if (this.passCount >= needPass) {
      const lead = attackerAlive ? this.lastAttacker : this.nextAlive(this.lastAttacker);
      this.table = null;
      this.passCount = 0;
      this.currentTurn = lead;
    } else {
      this.currentTurn = this.nextAlive(seat);
    }
    this.promptTurn();
  }

  nextAlive(seat) {
    for (let i = 1; i <= SEATS; i++) {
      const s = (seat + i) % SEATS;
      if (this.alive.has(s)) return s;
    }
    return -1;
  }

  finishPlayer(seat) {
    this.alive.delete(seat);
    this.ranking.push(seat);
    this.finishRanks[seat] = this.ranking.length;
    this.logEvent({ kind: 'finish', seat, rank: this.ranking.length });
    this.room.broadcast({ type: 'player_finished', seat, rank: this.ranking.length });
  }

  endRound() {
    const last = [...this.alive][0];
    this.ranking.push(last);
    this.finishRanks[last] = 6;
    this.state = 'round_over';
    this.lastRoundInfo = { firstSeat: this.ranking[0], lastSeat: this.ranking[5] };
    this.logEvent({ kind: 'round_over', ranking: this.ranking });
    this.room.broadcast({
      type: 'round_over',
      ranking: this.ranking,
      finishRanks: this.finishRanks,
      resistanceNext: hasTwoBigJokers(this.hands[last]),
    });
  }

  promptTurn() {
    const seat = this.currentTurn;
    this.room.broadcast({ type: 'turn', seat, free: !this.table });
    this.room.onTurn(seat);
  }

  hint(seat) {
    if (this.state !== 'playing' || this.currentTurn !== seat) {
      return this.err(seat, '当前不能提示');
    }
    const beats = findBeats(this.hands[seat], this.table ? this.table.ht : null);
    this.room.sendTo(seat, {
      type: 'hint_result',
      candidates: beats.slice(0, 12).map((b) => b.cards.map((c) => c.id)),
    });
  }

  err(seat, message) {
    this.room.sendTo(seat, { type: 'error', message });
    return false;
  }

  // 重连/入场完整快照
  snapshot(seat) {
    const players = this.room.players.map((p, s) => ({
      seat: s,
      name: p ? p.name : null,
      isBot: p ? p.isBot : false,
      online: p ? p.online : false,
      cardCount: this.hands[s].length,
      rank: this.finishRanks[s],
    }));
    return {
      type: 'state',
      state: this.state,
      round: this.round,
      currentTurn: this.currentTurn,
      table: this.table ? { cards: this.table.cards, ht: this.table.ht, seat: this.table.seat } : null,
      players,
      ranking: this.ranking,
      lastRoundInfo: this.lastRoundInfo,
      tribute: this.tribute ? { from: this.tribute.from, to: this.tribute.to, stage: this.tribute.stage } : null,
      log: this.log,
      hand: this.hands[seat],
      hostSeat: this.room.hostSeat,
    };
  }
}
