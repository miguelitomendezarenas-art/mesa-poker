// PASO 5 — Cliente: dibuja el estado que manda el servidor y envía las acciones del jugador.
const $ = s => document.querySelector(s);
const SUIT = { h: '♥', d: '♦', c: '♣', s: '♠' };
const RANK = r => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[r] || String(r));
const POS = [[50, 96], [6, 70], [10, 14], [50, 2], [90, 14], [94, 70]]; // posición fija de cada asiento: todos ven la mesa igual

const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
let ws, state = null, playerId = store.get('pid') || uid();
store.set('pid', playerId);
let raiseTo = null, actionSig = '';

$('#name').value = store.get('pname') || '';
const urlRoom = new URLSearchParams(location.search).get('room');
$('#room').value = urlRoom || Math.random().toString(36).slice(2, 6).toUpperCase();

$('#lobbyForm').onsubmit = e => {
  e.preventDefault();
  store.set('pname', $('#name').value.trim());
  connect($('#name').value.trim(), $('#room').value.trim().toUpperCase());
};

function connect(name, room) {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room, name, playerId }));
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'joined') {
      $('#lobby').hidden = true; $('#app').hidden = false;
      $('#roomLabel').textContent = 'Mesa ' + m.room;
      history.replaceState(null, '', '?room=' + m.room);
    } else if (m.type === 'state') { state = m.state; state._off = Date.now() - state.serverTime; render(); }
    else if (m.type === 'error') toast(m.message);
  };
  ws.onclose = () => { toast('Conexión perdida, reconectando…'); setTimeout(() => connect(name, room), 1500); };
}

const send = o => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2500); }

function cardEl(c, mini) {
  const d = document.createElement('div');
  if (!c) { d.className = 'card back' + (mini ? ' mini' : ''); return d; }
  d.className = 'card' + (c.s === 'h' || c.s === 'd' ? ' red' : '') + (mini ? ' mini' : '');
  d.innerHTML = `<small>${RANK(c.r)}</small><span>${SUIT[c.s]}</span>`;
  return d;
}

function render() {
  const s = state, me = s.mySeat;
  $('#blindsLabel').textContent = `Ciegas ${s.blinds[0]}/${s.blinds[1]}`;
  $('#pot').textContent = s.pot ? `Bote ${s.pot}` : '';
  const com = $('#community'); com.innerHTML = '';
  s.community.forEach(c => com.appendChild(cardEl(c)));

  const winSeats = new Map((s.result?.winners || []).map(w => [w.seat, w]));
  $('#banner').textContent = s.phase === 'waiting'
    ? (s.started ? 'Esperando jugadores…' : 'Siéntate y pulsa «Iniciar partida» (mínimo 2 jugadores)')
    : (s.result ? s.result.winners.map(w => `${w.name} gana ${w.amount}${w.handName ? ' · ' + w.handName : ''}`).join('  |  ') : '');

  const seatsEl = $('#seats'); seatsEl.innerHTML = '';
  for (let k = 0; k < 6; k++) {
    const i = k, p = s.seats[i], [x, y] = POS[k];
    const el = document.createElement('div');
    el.style.left = x + '%'; el.style.top = y + '%';
    if (!p) {
      el.className = 'seat empty';
      el.innerHTML = `<div class="plate">Asiento ${i + 1}<br>${me < 0 ? 'Sentarme' : ''}</div>`;
      if (me < 0) el.onclick = () => {
        const v = prompt('¿Con cuántas fichas quieres sentarte?', s.buyIn);
        if (v) send({ type: 'sit', seat: i, buyIn: Number(v) });
      };
    } else {
      el.className = 'seat' + (i === me ? ' me' : '') + (p.folded ? ' folded' : '') + (i === s.toAct ? ' turn' : '') + (winSeats.has(i) ? ' win' : '');
      const hand = document.createElement('div'); hand.className = 'hand';
      p.cards.forEach(c => hand.appendChild(cardEl(c, true)));
      const status = winSeats.has(i) ? `+${winSeats.get(i).amount}` : (p.handName || (!p.connected ? 'desconectado' : p.lastAction || ''));
      const roles = [p.isSB && 'SB', p.isBB && 'BB'].filter(Boolean).join(' ');
      el.appendChild(hand);
      const plate = document.createElement('div'); plate.className = 'plate';
      plate.innerHTML = `${p.isDealer ? '<span class="dealer">D</span>' : ''}<div class="nm">${esc(p.name)}</div>
        <div class="ch">${p.chips}${p.allIn ? ' · all-in' : ''}</div><div class="st">${esc(status)}${roles && !status ? roles : ''}</div>
        ${i === s.toAct ? '<div class="timer" id="timer"></div>' : ''}`;
      el.appendChild(plate);
      if (p.bet) { const b = document.createElement('div'); b.className = 'bet'; b.textContent = p.bet; b.style.top = k >= 3 ? '112%' : '-30px'; if (k === 0) b.style.top = '-48px'; el.appendChild(b); }
    }
    seatsEl.appendChild(el);
  }

  const ready = s.seats.filter(p => p && p.chips > 0).length;
  $('#startBtn').hidden = !(me >= 0 && s.phase === 'waiting' && ready >= 2 && !s.started);
  $('#standBtn').hidden = me < 0;
  $('#log').innerHTML = s.log.map(l => `<div>${esc(l)}</div>`).join(''); $('#log').scrollTop = 1e9;
  $('#chat').innerHTML = s.chat.map(c => `<div><b>${esc(c.name)}:</b> ${esc(c.text)}</div>`).join(''); $('#chat').scrollTop = 1e9;
  renderActions();
}

function renderActions() {
  const s = state, a = s.actions, box = $('#actions'), me = s.mySeat >= 0 ? s.seats[s.mySeat] : null;
  const sig = JSON.stringify([a, s.toAct, s.handNumber, s.phase, me && me.chips]);
  if (sig === actionSig) return; actionSig = sig;
  if (me && me.chips === 0 && (!me.inHand || s.phase === 'showdown' || s.phase === 'waiting')) {
    box.innerHTML = '<button id="rebuy" class="raise">Recomprar fichas</button>'; $('#rebuy').onclick = () => send({ type: 'rebuy' }); return;
  }
  if (!a) { box.innerHTML = `<span class="wait">${me ? (s.toAct >= 0 ? 'Turno de ' + esc(s.seats[s.toAct].name) : '') : 'Estás mirando la mesa'}</span>`; return; }
  if (raiseTo === null || raiseTo < a.minRaiseTo || raiseTo > a.maxRaiseTo) raiseTo = a.minRaiseTo;
  const pot = s.pot;
  box.innerHTML = `<button class="fold" data-a="fold">Retirarme</button>
    <button class="call" data-a="${a.canCheck ? 'check' : 'call'}">${a.canCheck ? 'Pasar' : 'Igualar ' + a.toCall}</button>
    ${a.canRaise ? `<span class="rz"><button class="quick" data-q="${Math.ceil(pot / 2)}">½ bote</button> <button class="quick" data-q="${pot}">Bote</button>
    <input type="range" id="rs" min="${a.minRaiseTo}" max="${a.maxRaiseTo}" value="${raiseTo}">
    <input type="number" id="rn" min="${a.minRaiseTo}" max="${a.maxRaiseTo}" value="${raiseTo}">
    <button class="raise" id="rb">${s.currentBet ? 'Subir a' : 'Apostar'} <span id="rv">${raiseTo}</span></button>
    <button class="raise" data-a="allin">All-in</button></span>` : ''}`;
  box.querySelectorAll('[data-a]').forEach(b => b.onclick = () => send({ type: 'action', action: b.dataset.a }));
  if (a.canRaise) {
    const sync = v => { raiseTo = Math.max(a.minRaiseTo, Math.min(a.maxRaiseTo, Math.round(+v) || a.minRaiseTo)); $('#rs').value = $('#rn').value = raiseTo; $('#rv').textContent = raiseTo; };
    $('#rs').oninput = e => sync(e.target.value);
    $('#rn').onchange = e => sync(e.target.value);
    box.querySelectorAll('[data-q]').forEach(b => b.onclick = () => sync(Math.max(+b.dataset.q + s.currentBet, a.minRaiseTo)));
    $('#rb').onclick = () => send({ type: 'action', action: 'raise', amount: raiseTo });
  }
}

setInterval(() => {
  const t = $('#timer'); if (!t || !state?.turnDeadline) return;
  const left = state.turnDeadline - (Date.now() - state._off);
  t.style.width = Math.max(0, Math.min(100, left / 400)) + '%'; // 40 s = 100 %
}, 250);

$('#startBtn').onclick = () => send({ type: 'start' });
$('#standBtn').onclick = () => send({ type: 'stand' });
$('#copyLink').onclick = () => {
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(location.href).then(() => toast('Enlace copiado'));
  else prompt('Copia este enlace y envíalo a tus amigos:', location.href);
};
$('#chatForm').onsubmit = e => { e.preventDefault(); const v = $('#chatInput').value.trim(); if (v) send({ type: 'chat', text: v }); $('#chatInput').value = ''; };
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
