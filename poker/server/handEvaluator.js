// PASO 2 — Evaluador de manos: mejor mano de 5 cartas entre 7.
// score = [categoría, desempates...]  (se compara lexicográficamente)
const NAMES = ['Carta alta', 'Pareja', 'Doble pareja', 'Trío', 'Escalera', 'Color', 'Full house', 'Póker', 'Escalera de color'];

function score5(cards) {
  const ranks = cards.map(c => c.r).sort((a, b) => b - a);
  const flush = cards.every(c => c.s === cards[0].s);
  const uniq = [...new Set(ranks)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks.join() === '14,5,4,3,2') straightHigh = 5; // rueda A-2-3-4-5
  }
  const counts = {};
  ranks.forEach(r => (counts[r] = (counts[r] || 0) + 1));
  // grupos ordenados por cantidad y luego por valor
  const groups = Object.entries(counts).map(([r, n]) => [n, +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const shape = groups.map(g => g[0]).join('');
  const tie = groups.map(g => g[1]);

  if (straightHigh && flush) return [8, straightHigh];
  if (shape === '41') return [7, ...tie];
  if (shape === '32') return [6, ...tie];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (shape === '311') return [3, ...tie];
  if (shape === '221') return [2, ...tie];
  if (shape === '2111') return [1, ...tie];
  return [0, ...ranks];
}

function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

function combos(arr, k, start = 0, cur = [], out = []) {
  if (cur.length === k) { out.push(cur.slice()); return out; }
  for (let i = start; i < arr.length; i++) {
    cur.push(arr[i]); combos(arr, k, i + 1, cur, out); cur.pop();
  }
  return out;
}

function bestHand(cards) {
  let best = null, bestCards = null;
  for (const c of combos(cards, 5)) {
    const s = score5(c);
    if (!best || compareScores(s, best) > 0) { best = s; bestCards = c; }
  }
  return { score: best, name: NAMES[best[0]], cards: bestCards };
}

module.exports = { bestHand, compareScores, score5, NAMES };
