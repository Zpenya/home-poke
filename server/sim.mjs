// 6 真人客户端模拟：连接服务器、自动决策，连续跑 3 局
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { botPlay, botTributeChoice, botReturnChoice } from './src/bot.js';

const PORT = 8799;
const TOTAL_ROUNDS = Number(process.env.ROUNDS || 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn(process.execPath, ['src/index.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
function rpc(ws, msg, filter) {
  return new Promise((resolve) => {
    const h = (data) => {
      const m = JSON.parse(data.toString());
      if (filter(m)) { ws.off('message', h); resolve(m); }
    };
    ws.on('message', h);
    ws.send(JSON.stringify(msg));
  });
}

await sleep(800);

// 1 建房 + 5 加入
const ws0 = await connect();
const created = await rpc(ws0, { type: 'create_room', name: 'P1' }, (m) => m.type === 'room_created');
const roomCode = created.code;
const players = [];
players.push({ ws: ws0, seat: created.seat, name: 'P1', hand: [] });
for (let i = 1; i < 6; i++) {
  const ws = await connect();
  const joined = await rpc(
    ws,
    { type: 'join_room', roomCode, name: `P${i + 1}` },
    (m) => m.type === 'room_joined'
  );
  players.push({ ws, seat: joined.seat, name: `P${i + 1}`, hand: [] });
}

const fg = { hands: [[], [], [], [], [], [], []], table: null };
const results = [];
let roundNo = 0;
const events = [];

function bySeat(s) { return players.find((p) => p.seat === s); }
function syncHand(p) { fg.hands[p.seat] = p.hand; }

for (const p of players) {
  p.ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    switch (m.type) {
      case 'deal':
      case 'hand_update':
        p.hand = m.hand;
        syncHand(p);
        break;
      case 'turn':
        if (m.seat !== p.seat) break;
        if (m.free) fg.table = null;
        setTimeout(() => {
          const action = botPlay(fg, p.seat);
          if (action.pass) {
            console.log(`seat${p.seat} PASS (hand=${p.hand.length})`);
            p.ws.send(JSON.stringify({ type: 'pass' }));
          } else {
            const idset = new Set(p.hand.map((c) => c.id));
            const missing = action.cardIds.filter((id) => !idset.has(id));
            console.log(`seat${p.seat} 出 ${action.cardIds.length} 张, hand=${p.hand.length}, 缺失=${missing.length}`);
            if (missing.length) console.log('  缺失id:', missing, ' hand:', p.hand.map((c) => c.id));
            p.ws.send(JSON.stringify({ type: 'play', cardIds: action.cardIds }));
          }
        }, 30);
        break;
      case 'played':
        if (m.seat === p.seat) {
          const ids = new Set(m.cards.map((c) => c.id));
          p.hand = p.hand.filter((c) => !ids.has(c.id));
          syncHand(p);
        }
        if (p.seat === 0) fg.table = { ht: m.ht };
        break;
      case 'tribute_required':
        setTimeout(() => {
          p.ws.send(JSON.stringify({ type: 'tribute', cardId: botTributeChoice(fg, p.seat) }));
        }, 30);
        break;
      case 'return_tribute_required':
        setTimeout(() => {
          p.ws.send(JSON.stringify({
            type: 'return_tribute',
            cardId: botReturnChoice(fg, p.seat, m.forbiddenId),
          }));
        }, 30);
        break;
      case 'resistance':
        if (p.seat === 0) events.push(`第${roundNo + 1}局 座位${m.seat} 抗贡`);
        break;
      case 'tribute_paid':
        if (p.seat === 0) events.push(`第${roundNo + 1}局 ${m.fromSeat}→${m.toSeat} 进贡 rank${m.rank}`);
        break;
      case 'return_tribute_paid':
        if (p.seat === 0) events.push(`第${roundNo + 1}局 ${m.fromSeat}→${m.toSeat} 回贡 rank${m.rank}`);
        break;
      case 'round_over': {
        if (p.seat !== 0) break;
        roundNo += 1;
        results.push(m.ranking);
        if (roundNo < TOTAL_ROUNDS) {
          setTimeout(() => bySeat(0).ws.send(JSON.stringify({ type: 'next_round' })), 500);
        } else {
          finish();
        }
        break;
      }
      case 'error':
        console.log(`[服务器报错] ${m.message}`);
        process.exitCode = 1;
        break;
    }
  });
}

function finish() {
  console.log('\n===== 模拟结果 =====');
  results.forEach((r, i) => {
    console.log(`第${i + 1}局 名次(座位): 1=${r[0]} 2=${r[1]} 3=${r[2]} 4=${r[3]} 5=${r[4]} 6=${r[5]}`);
  });
  console.log('\n--- 进贡/抗贡事件 ---');
  events.forEach((e) => console.log(e));
  const tributeRounds = new Set(events.map((e) => e[1]));
  console.log(`\n共完成 ${results.length} 局，事件 ${events.length} 条`);
  srv.kill();
  process.exit(process.exitCode || 0);
}

setTimeout(() => {
  console.log('模拟超时');
  srv.kill();
  process.exit(1);
}, 180000);

bySeat(0).ws.send(JSON.stringify({ type: 'start_game' }));
