// PASO 1 — Baraja: 52 cartas, mezcla Fisher-Yates con aleatoriedad criptográfica.
const crypto = require('crypto');

const SUITS = ['h', 'd', 'c', 's']; // corazones, diamantes, tréboles, picas

function createDeck() {
  const deck = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push({ r, s });
  return deck;
}

function shuffle(deck) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { createDeck, shuffle };
