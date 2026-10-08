// Pruebas: evaluador de manos + simulación de miles de manos verificando que las fichas se conservan.
const assert = require('assert');
const { bestHand, compareScores } = require('./handEvaluator');
const { Table } = require('./game');

const C = s => s.split(' ').map(x => ({ r: '23456789TJQKA'.indexOf(x[0]) + 2, s: x[1] }));
const name = s => bestHand(C(s)).name;
assert.strictEqual(name('Ah Kh Qh Jh Th 2c 3d'), 'Escalera de color');
assert.strictEqual(name('9h 9d 9c 9s 2h 3c 4d'), 'Póker');
assert.strictEqual(name('9h 9d 9c 2s 2h 3c 4d'), 'Full house');
assert.strictEqual(name('Ah 3h 9h Jh 2h 5c 4d'), 'Color');
assert.strictEqual(name('Ah 2d 3c 4s 5h 9c 9d'), 'Escalera'); // rueda
assert.strictEqual(name('9h 9d 9c 2s 5h 3c Kd'), 'Trío');
assert.strictEqual(name('9h 9d 3c 3s 5h 2c Kd'), 'Doble pareja');
assert.strictEqual(name('9h 9d 3c 7s 5h 2c Kd'), 'Pareja');
assert.strictEqual(name('Ah 9d 3c 7s 5h 2c Kd'), 'Carta alta');
assert(compareScores(bestHand(C('Ah Ad 2c 3d 4s 9h Kc')).score, bestHand(C('Kh Kd 2c 3d 4s 9h Ac')).score) > 0);
console.log('✓ Evaluador de manos');

// Simulación: jugadores aleatorios
let hands = 0;
for (let g = 0; g < 300; g++) {
  const t = new Table({ smallBlind: 10, bigBlind: 20, buyIn: 1000 });
  t.update = () => {};
  const n = 2 + (g % 5);
  const stacks = [];
  for (let i = 0; i < n; i++) { t.sit('p' + i, 'P' + i, i, 400 + Math.floor(Math.random() * 1600)); }
  const total = () => t.seats.reduce((s, p) => s + (p ? p.chips + p.bet : 0), 0) + t.pot;
  const start = total();
  // las pausas entre fases se saltan ejecutando los timers manualmente
  t.schedule = fn => { t.pending = fn; };
  t.startTurn = () => {};
  t.started = true; t.startHand();
  let guard = 0;
  while (guard++ < 3000) {
    if (t.toAct >= 0) {
      const p = t.seats[t.toAct];
      const toCall = t.currentBet - p.bet, r = Math.random();
      try {
        if (r < 0.15) t.act(p.id, 'fold');
        else if (r < 0.65) t.act(p.id, toCall > 0 ? 'call' : 'check');
        else if (r < 0.95) t.act(p.id, 'raise', t.currentBet + t.minRaise + Math.floor(Math.random() * 100));
        else t.act(p.id, 'allin');
      } catch (e) { t.act(p.id, toCall > 0 ? 'call' : 'check'); }
    } else if (t.pending) {
      const f = t.pending; t.pending = null;
      if (t.phase === 'showdown' && t.result) { hands++; assert.strictEqual(total(), start, 'Las fichas no se conservan'); if (hands % 40 === 0 && t.seats.filter(p => p && p.chips > 0).length < 2) break; }
      f();
      if (t.phase === 'waiting') break;
    } else break;
  }
}
console.log(`✓ Simulación: ${hands} manos, fichas siempre conservadas`);
