// 牌的定义、洗牌、发牌
// rank: 3..14 = 3..A, 15 = 2, 16 = 小王, 17 = 大王
// suit: 0 黑桃 1 红桃 2 梅花 3 方块, 4 = 王
export const SMALL_JOKER = 16;
export const BIG_JOKER = 17;

export function buildDeckPairs() {
  const cards = [];
  for (let deck = 0; deck < 2; deck++) {
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 3; rank <= 15; rank++) {
        cards.push({ id: `${rank}-${suit}-${deck}`, rank, suit, deck });
      }
    }
    cards.push({ id: `16-4-${deck}`, rank: SMALL_JOKER, suit: 4, deck });
    cards.push({ id: `17-4-${deck}`, rank: BIG_JOKER, suit: 4, deck });
  }
  return cards; // 108 张
}

// Fisher–Yates，可注入随机源（测试可复现）
export function shuffle(arr, rnd = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 轮流发牌给 6 家
export function deal(cards, seats = 6) {
  const hands = Array.from({ length: seats }, () => []);
  cards.forEach((c, i) => hands[i % seats].push(c));
  return hands;
}

export function sortHand(hand) {
  hand.sort((a, b) => a.rank - b.rank || a.suit - b.suit || a.deck - b.deck);
  return hand;
}

export function maxRank(hand) {
  return hand.reduce((m, c) => Math.max(m, c.rank), 0);
}

// 抗贡条件：手里有两张大王
export function hasTwoBigJokers(hand) {
  return hand.filter((c) => c.rank === BIG_JOKER).length >= 2;
}

export function rankLabel(rank) {
  if (rank <= 10) return String(rank);
  return { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王' }[rank];
}
