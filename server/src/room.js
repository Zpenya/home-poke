// 房间：座位、玩家连接、机器人调度、消息收发
import { Game } from './game.js';
import { botTributeChoice, botReturnChoice, botPlay } from './bot.js';

let botSeq = 0;

export class Room {
  constructor(code) {
    this.code = code;
    this.players = Array(6).fill(null);
    this.hostSeat = -1;
    this.game = new Game(this);
  }

  occupied() {
    return this.players.filter(Boolean).length;
  }

  addPlayer(name, ws, token) {
    const seat = this.players.findIndex((p) => p === null);
    if (seat === -1) return -1;
    this.players[seat] = { name: name || '玩家', token, ws, isBot: false, online: true };
    if (this.hostSeat === -1) this.hostSeat = seat;
    ws._seat = seat;
    ws._room = this;
    this.broadcastRoomState();
    return seat;
  }

  addBot() {
    const seat = this.players.findIndex((p) => p === null);
    if (seat === -1) return -1;
    botSeq += 1;
    this.players[seat] = {
      name: `机器人${botSeq}`, token: null, ws: null, isBot: true, online: true,
    };
    this.broadcastRoomState();
    return seat;
  }

  disconnect(seat) {
    const p = this.players[seat];
    if (!p || p.isBot) return;
    p.online = false;
    p.ws = null;
    this.broadcastRoomState();
  }

  sendTo(seat, msg) {
    const p = this.players[seat];
    if (!p) return;
    if (!p.isBot && p.ws && p.online) {
      try { p.ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
      return;
    }
    if (p.isBot) this.scheduleBotMessage(seat, msg);
  }

  broadcast(msg, exceptSeat = -1) {
    for (let s = 0; s < 6; s++) {
      if (s !== exceptSeat) this.sendTo(s, msg);
    }
  }

  playerPublic(s) {
    const p = this.players[s];
    return {
      seat: s,
      name: p ? p.name : null,
      isBot: p ? p.isBot : false,
      online: p ? p.online : false,
      cardCount: this.game.state === 'idle' ? 0 : this.game.hands[s].length,
      rank: this.game.finishRanks[s],
    };
  }

  broadcastRoomState() {
    this.broadcast({
      type: 'room_state',
      code: this.code,
      hostSeat: this.hostSeat,
      state: this.game.state,
      round: this.game.round,
      players: [0, 1, 2, 3, 4, 5].map((s) => this.playerPublic(s)),
    });
  }

  schedule(fn, delay = 700) {
    setTimeout(fn, delay + Math.random() * 600);
  }

  // 轮到 bot
  onTurn(seat) {
    const p = this.players[seat];
    if (!p || !p.isBot) return;
    this.schedule(() => {
      const action = botPlay(this.game, seat);
      if (action.pass) this.game.pass(seat);
      else this.game.play(seat, action.cardIds);
    });
  }

  // bot 响应进贡/回贡要求
  scheduleBotMessage(seat, msg) {
    if (msg.type === 'tribute_required') {
      this.schedule(() => this.game.submitTribute(seat, botTributeChoice(this.game, seat)));
    } else if (msg.type === 'return_tribute_required') {
      this.schedule(() => this.game.submitReturn(seat, botReturnChoice(this.game, seat, msg.forbiddenId)));
    }
  }

  startGame(seat) {
    if (seat !== this.hostSeat) return;
    if (this.game.state === 'playing' || this.game.state === 'tribute') return;
    while (this.occupied() < 6) this.addBot();
    this.game.startRound();
  }

  nextRound(seat) {
    if (seat !== this.hostSeat) return;
    if (this.game.state !== 'round_over') return;
    this.game.startRound();
  }
}
