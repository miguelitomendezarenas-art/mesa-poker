// PASO 3 — Motor de la mesa: asientos, ciegas, rondas de apuestas, botes y showdown.
const { createDeck, shuffle } = require('./cards');
const { bestHand, compareScores } = require('./handEvaluator');

const SEATS = 6;
const TURN_MS = 40000;      // tiempo por turno
const NEXT_HAND_MS = 6000;  // pausa entre manos

class Table {
  constructor(opts = {}) {
    this.smallBlind = opts.smallBlind || 10;
    this.bigBlind = opts.bigBlind || 20;
    this.buyIn = opts.buyIn || 1000;
    this.onUpdate = () => {};
    this.seats = Array(SEATS).fill(null);
    this.spectators = new Map(); // playerId -> nombre
    this.started = false;
    this.phase = 'waiting'; // waiting | preflop | flop | turn | river | showdown
    this.community = [];
    this.pot = 0;
    this.dealer = -1;
    this.toAct = -1;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.handNumber = 0;
    this.result = null;
    this.log = [];
    this.chat = [];
    this.turnDeadline = null;
    this.turnTimer = null;
    this.stageTimer = null;
  }

  // ---------- utilidades ----------
  say(msg) { this.log.push(msg); if (this.log.length > 40) this.log.shift(); }
  update() { this.onUpdate(); }
  seatOf(id) { return this.seats.findIndex(p => p && p.id === id); }
  next(from, pred) {
    for (let i = 1; i <= SEATS; i++) {
      const idx = (((from + i) % SEATS) + SEATS) % SEATS;
      const p = this.seats[idx];
      if (p && pred(p)) return idx;
    }
    return -1;
  }
  alive() { return this.seats.filter(p => p && p.inHand && !p.folded); }
  needsAction(p) { return p.inHand && !p.folded && !p.allIn && (!p.acted || p.bet < this.currentBet); }
  nextToAct(from) { return this.next(from, p => this.needsAction(p)); }
  schedule(fn, ms) { clearTimeout(this.stageTimer); this.stageTimer = setTimeout(fn, ms); }
  clearTimers() { clearTimeout(this.turnTimer); clearTimeout(this.stageTimer); this.turnDeadline = null; }
  inActiveHand() { return ['preflop', 'flop', 'turn', 'river'].includes(this.phase); }

  // ---------- jugadores ----------
  join(id, name) {
    const i = this.seatOf(id);
    if (i >= 0) { const p = this.seats[i]; p.connected = true; p.sitOut = false; p.name = name || p.name; }
    else this.spectators.set(id, name);
    this.update();
  }

  disconnect(id) {
    const i = this.seatOf(id);
    this.spectators.delete(id);
    if (i < 0) return this.update();
    const p = this.seats[i];
    p.connected = false;
    this.say(`${p.name} se desconectó`);
    if (this.toAct === i) this.autoAct();
    else if (!this.inActiveHand() || !p.inHand) this.update();
    else this.update();
  }

  sit(id, name, seat, buyIn) {
    if (this.seatOf(id) >= 0) throw new Error('Ya tienes un asiento');
    if (!(seat >= 0 && seat < SEATS) || this.seats[seat]) throw new Error('Asiento no disponible');
    const chips = Math.max(this.bigBlind * 10, Math.min(Math.floor(buyIn) || this.buyIn, this.buyIn * 10));
    this.seats[seat] = {
      id, name, seat, chips, bet: 0, totalBet: 0, folded: false, allIn: false, acted: false,
      cards: [], inHand: false, connected: true, sitOut: false, leaving: false,
      lastAction: null, showCards: false, hand: null,
    };
    this.spectators.delete(id);
    this.say(`${name} se sentó en el asiento ${seat + 1} con ${chips} fichas`);
    this.update();
    if (this.started && this.phase === 'waiting') this.startHand();
  }

  stand(id) {
    const i = this.seatOf(id);
    if (i < 0) return;
    const p = this.seats[i];
    this.say(`${p.name} se levantó de la mesa`);
    this.spectators.set(id, p.name);
    if (p.inHand && this.inActiveHand() && !p.folded) {
      p.leaving = true; p.folded = true; p.lastAction = 'Fold';
      if (this.toAct === i) return this.afterAction();
      if (this.alive().length === 1) return this.finishByFold(this.alive()[0]);
    } else if (p.inHand && this.inActiveHand()) {
      p.leaving = true;
    } else {
      this.seats[i] = null;
    }
    this.update();
  }

  rebuy(id) {
    const p = this.seats[this.seatOf(id)];
    if (!p) throw new Error('No estás sentado');
    if (p.chips > 0) throw new Error('Solo puedes recomprar sin fichas');
    p.chips = this.buyIn;
    this.say(`${p.name} recompró ${this.buyIn} fichas`);
    this.update();
    if (this.started && this.phase === 'waiting') this.startHand();
  }

  startGame(id) {
    if (this.seatOf(id) < 0) throw new Error('Siéntate para iniciar la partida');
    this.started = true;
    if (this.phase === 'waiting') {
      if (!this.startHand()) throw new Error('Se necesitan al menos 2 jugadores con fichas');
    }
  }

  // ---------- inicio de mano ----------
  startHand() {
    this.clearTimers();
    // limpiar a quienes se levantaron
    this.seats.forEach((p, i) => { if (p && p.leaving) this.seats[i] = null; });
    const ready = this.seats.filter(p => p && p.chips > 0 && p.connected && !p.sitOut);
    if (ready.length < 2) { this.phase = 'waiting'; this.toAct = -1; this.update(); return false; }

    this.handNumber++;
    this.result = null;
    this.community = [];
    this.pot = 0;
    this.deck = shuffle(createDeck());
    for (const p of this.seats) {
      if (!p) continue;
      Object.assign(p, { bet: 0, totalBet: 0, folded: false, allIn: false, acted: false, cards: [],
        inHand: false, lastAction: null, showCards: false, hand: null });
    }
    ready.forEach(p => (p.inHand = true));
    this.dealer = this.next(this.dealer, p => p.inHand);
    let sb, bb;
    if (ready.length === 2) { sb = this.dealer; bb = this.next(this.dealer, p => p.inHand); }
    else { sb = this.next(this.dealer, p => p.inHand); bb = this.next(sb, p => p.inHand); }
    this.sbSeat = sb; this.bbSeat = bb;
    this.say(`— Mano #${this.handNumber} —`);
    this.post(sb, this.smallBlind, 'Ciega pequeña');
    this.post(bb, this.bigBlind, 'Ciega grande');
    this.currentBet = Math.max(...ready.map(p => p.bet));
    this.minRaise = this.bigBlind;
    for (let r = 0; r < 2; r++) for (const p of ready) p.cards.push(this.deck.pop());
    this.phase = 'preflop';
    this.toAct = this.nextToAct(bb);
    if (this.toAct === -1) this.endBettingRound();
    else { this.startTurn(); this.update(); }
    return true;
  }

  put(p, amount) {
    const a = Math.min(amount, p.chips);
    p.chips -= a; p.bet += a; p.totalBet += a;
    if (p.chips === 0) p.allIn = true;
    return a;
  }
  post(seat, amount, label) {
    const p = this.seats[seat];
    const a = this.put(p, amount);
    p.lastAction = label;
    this.say(`${p.name} pone ${label.toLowerCase()} (${a})`);
  }

  // ---------- turnos ----------
  startTurn() {
    clearTimeout(this.turnTimer);
    const p = this.seats[this.toAct];
    this.turnDeadline = Date.now() + TURN_MS;
    this.turnTimer = setTimeout(() => this.autoAct(), p.connected ? TURN_MS : 800);
  }

  autoAct() {
    const p = this.seats[this.toAct];
    if (!p) return;
    const toCall = this.currentBet - p.bet;
    try { this.act(p.id, toCall > 0 ? 'fold' : 'check'); } catch (e) { /* ignorar */ }
  }

  act(id, action, amount) {
    const seat = this.seatOf(id);
    if (seat < 0 || seat !== this.toAct || !this.inActiveHand()) throw new Error('No es tu turno');
    const p = this.seats[seat];
    const toCall = this.currentBet - p.bet;
    const maxTo = p.bet + p.chips;

    if (action === 'allin') { action = maxTo > this.currentBet ? 'raise' : 'call'; amount = maxTo; }

    if (action === 'fold') {
      p.folded = true; p.lastAction = 'Fold'; this.say(`${p.name} se retira`);
    } else if (action === 'check') {
      if (toCall > 0) throw new Error('No puedes pasar, hay una apuesta');
      p.lastAction = 'Check'; this.say(`${p.name} pasa`);
    } else if (action === 'call') {
      if (toCall <= 0) { p.lastAction = 'Check'; this.say(`${p.name} pasa`); }
      else {
        const a = this.put(p, toCall);
        p.lastAction = p.allIn ? 'All-in' : 'Call';
        this.say(`${p.name} iguala ${a}${p.allIn ? ' (all-in)' : ''}`);
      }
    } else if (action === 'raise') {
      const to = Math.min(Math.floor(Number(amount)), maxTo);
      if (!(to > this.currentBet)) {
        if (to === maxTo && toCall > 0) { this.put(p, toCall); p.lastAction = 'All-in'; this.say(`${p.name} iguala ${toCall} (all-in)`); }
        else throw new Error('Subida inválida');
      } else {
        const minTo = this.currentBet + this.minRaise;
        if (to < minTo && to < maxTo) throw new Error(`La subida mínima es a ${minTo}`);
        const size = to - this.currentBet;
        const verb = this.currentBet === 0 ? 'apuesta' : 'sube a';
        this.put(p, to - p.bet);
        if (size >= this.minRaise) {
          this.minRaise = size;
          this.seats.forEach(o => { if (o && o !== p) o.acted = false; });
        }
        this.currentBet = to;
        p.lastAction = p.allIn ? 'All-in' : (verb === 'apuesta' ? 'Bet' : 'Raise');
        this.say(`${p.name} ${verb} ${to}${p.allIn ? ' (all-in)' : ''}`);
      }
    } else throw new Error('Acción desconocida');

    p.acted = true;
    this.afterAction();
  }

  afterAction() {
    clearTimeout(this.turnTimer);
    const alive = this.alive();
    if (alive.length === 1) return this.finishByFold(alive[0]);
    const nxt = this.nextToAct(this.toAct);
    if (nxt !== -1) { this.toAct = nxt; this.startTurn(); return this.update(); }
    this.endBettingRound();
  }

  // ---------- rondas ----------
  collectBets() {
    for (const p of this.seats) if (p) { this.pot += p.bet; p.bet = 0; p.acted = false; p.lastAction = p.folded ? 'Fold' : (p.allIn ? 'All-in' : null); }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
  }

  dealStreet() {
    this.deck.pop(); // quemar carta
    if (this.phase === 'preflop') { this.phase = 'flop'; this.community.push(this.deck.pop(), this.deck.pop(), this.deck.pop()); }
    else if (this.phase === 'flop') { this.phase = 'turn'; this.community.push(this.deck.pop()); }
    else if (this.phase === 'turn') { this.phase = 'river'; this.community.push(this.deck.pop()); }
  }

  endBettingRound() {
    clearTimeout(this.turnTimer);
    this.turnDeadline = null;
    this.collectBets();
    if (this.phase === 'river') return this.showdown();
    this.dealStreet();
    const canAct = this.seats.filter(p => p && p.inHand && !p.folded && !p.allIn);
    if (canAct.length <= 1) {
      // nadie más puede apostar: se revelan las manos y se reparten las cartas restantes
      this.alive().forEach(p => (p.showCards = true));
      this.toAct = -1; this.update();
      this.schedule(() => this.continueRunout(), 1600);
    } else {
      this.toAct = this.nextToAct(this.dealer);
      this.startTurn(); this.update();
    }
  }

  continueRunout() {
    if (this.phase === 'river') return this.showdown();
    this.dealStreet(); this.update();
    this.schedule(() => this.continueRunout(), 1600);
  }

  // ---------- botes y showdown ----------
  buildPots() {
    const players = this.seats.filter(p => p && p.inHand);
    const levels = [...new Set(players.filter(p => p.totalBet > 0).map(p => p.totalBet))].sort((a, b) => a - b);
    const pots = []; let prev = 0;
    for (const lvl of levels) {
      let amount = 0;
      for (const p of players) amount += Math.max(0, Math.min(p.totalBet, lvl) - prev);
      const eligible = players.filter(p => !p.folded && p.totalBet >= lvl).map(p => p.seat);
      if (amount > 0) {
        if (!eligible.length && pots.length) pots[pots.length - 1].amount += amount;
        else pots.push({ amount, eligible });
      }
      prev = lvl;
    }
    return pots;
  }

  showdown() {
    this.phase = 'showdown'; this.toAct = -1;
    const contenders = this.alive();
    for (const p of contenders) {
      p.showCards = true;
      p.hand = bestHand([...p.cards, ...this.community]);
    }
    const won = new Map();
    for (const pot of this.buildPots()) {
      const el = pot.eligible.map(i => this.seats[i]);
      let best = null;
      for (const p of el) if (!best || compareScores(p.hand.score, best) > 0) best = p.hand.score;
      const winners = el.filter(p => compareScores(p.hand.score, best) === 0)
        .sort((a, b) => ((a.seat - this.dealer + SEATS) % SEATS) - ((b.seat - this.dealer + SEATS) % SEATS));
      const share = Math.floor(pot.amount / winners.length);
      let extra = pot.amount - share * winners.length;
      for (const w of winners) { const a = share + (extra-- > 0 ? 1 : 0); won.set(w.seat, (won.get(w.seat) || 0) + a); }
    }
    this.finishHand([...won].map(([seat, amount]) => ({ seat, amount, handName: this.seats[seat].hand.name })));
  }

  finishByFold(winner) {
    this.collectBets();
    this.phase = 'showdown'; this.toAct = -1;
    this.finishHand([{ seat: winner.seat, amount: this.pot, handName: null }]);
  }

  finishHand(winners) {
    clearTimeout(this.turnTimer); this.turnDeadline = null;
    for (const w of winners) {
      const p = this.seats[w.seat];
      p.chips += w.amount;
      w.name = p.name;
      this.say(`🏆 ${p.name} gana ${w.amount}${w.handName ? ' con ' + w.handName : ''}`);
    }
    this.pot = 0;
    this.result = { winners };
    this.update();
    this.schedule(() => this.startHand(), NEXT_HAND_MS);
  }

  // ---------- estado para cada cliente ----------
  getState(viewerId) {
    const me = this.seatOf(viewerId);
    const seats = this.seats.map((p, i) => {
      if (!p) return null;
      let cards = [];
      if (p.id === viewerId || p.showCards) cards = p.cards;
      else if (p.inHand && !p.folded) cards = [null, null];
      return {
        seat: i, name: p.name, chips: p.chips, bet: p.bet, folded: p.folded, allIn: p.allIn,
        inHand: p.inHand, connected: p.connected, lastAction: p.lastAction, cards,
        handName: p.showCards && p.hand ? p.hand.name : null,
        isDealer: i === this.dealer && this.phase !== 'waiting',
        isSB: i === this.sbSeat && this.phase !== 'waiting', isBB: i === this.bbSeat && this.phase !== 'waiting',
      };
    });
    let actions = null;
    if (me >= 0 && me === this.toAct) {
      const p = this.seats[me];
      const toCall = Math.min(this.currentBet - p.bet, p.chips);
      actions = {
        toCall, canCheck: toCall === 0,
        canRaise: p.chips > this.currentBet - p.bet,
        minRaiseTo: Math.min(this.currentBet + this.minRaise, p.bet + p.chips),
        maxRaiseTo: p.bet + p.chips,
      };
    }
    const bets = this.seats.reduce((s, p) => s + (p ? p.bet : 0), 0);
    return {
      you: viewerId, mySeat: me, started: this.started, phase: this.phase, community: this.community,
      pot: this.pot + bets, toAct: this.toAct, currentBet: this.currentBet,
      blinds: [this.smallBlind, this.bigBlind], buyIn: this.buyIn, handNumber: this.handNumber,
      seats, actions, result: this.result, turnDeadline: this.turnDeadline,
      log: this.log.slice(-25), chat: this.chat.slice(-40), serverTime: Date.now(),
    };
  }
}

module.exports = { Table, SEATS };
