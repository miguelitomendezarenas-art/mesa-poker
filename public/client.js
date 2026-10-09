// PASO 5 — Cliente: dibuja el estado que manda el servidor, con sonidos y animaciones.
const $ = s => document.querySelector(s);
const SUIT = { h: '♥', d: '♦', c: '♣', s: '♠' };
const RANK = r => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[r] || String(r));
const POS = [[50, 96], [6, 70], [10, 14], [50, 2], [90, 14], [94, 70]]; // posición fija de cada asiento
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
let ws, state = null, playerId = store.get('pid') || uid();
store.set('pid', playerId);
let raiseTo = null, actionSig = '';

// ================= SONIDO (sintetizado, sin archivos) =================
let actx = null, muted = store.get('mute') === '1';
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
['pointerdown', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, audio, { passive: true }));

function noise(t, dur, { type = 'bandpass', f0 = 2500, f1 = 900, q = 1, gain = 0.3 } = {}) {
  const c = actx, len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(c.destination); src.start(t);
}
function tone(t, freq, dur, { type = 'sine', gain = 0.12 } = {}) {
  const c = actx, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
}
const SOUNDS = {
  deal: t => { noise(t, 0.11, { f0: 3200, f1: 900, q: 0.8, gain: 0.35 }); noise(t, 0.02, { type: 'highpass', f0: 5000, f1: 5000, gain: 0.2 }); },
  flip: t => { noise(t, 0.14, { f0: 1800, f1: 700, q: 0.7, gain: 0.3 }); },
  fold: t => { noise(t, 0.22, { f0: 1400, f1: 350, q: 0.6, gain: 0.25 }); },
  check: t => { [0, 0.09].forEach(o => { tone(t + o, 170, 0.09, { gain: 0.35 }); noise(t + o, 0.04, { type: 'lowpass', f0: 900, f1: 300, gain: 0.3 }); }); },
  chips: t => { [[0, 2400], [0.045, 3100], [0.1, 2700], [0.14, 3500]].forEach(([o, f]) => { tone(t + o, f, 0.07, { type: 'triangle', gain: 0.09 }); noise(t + o, 0.03, { type: 'highpass', f0: 6000, f1: 6000, gain: 0.12 }); }); },
  turn: t => { tone(t, 880, 0.35, { gain: 0.12 }); tone(t + 0.12, 1320, 0.4, { gain: 0.1 }); },
  win: t => { [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.1, f, 0.45, { type: 'triangle', gain: 0.12 })); },
};
function play(name, delayMs = 0) {
  if (muted) return;
  const c = audio(); if (!c || c.state !== 'running') return;
  SOUNDS[name](c.currentTime + Math.max(0, delayMs) / 1000);
}

// ================= ANIMACIONES: registro para no repetirlas en cada render =================
const seen = new Map();
let seed = true; // primer render: no animar lo que ya estaba en mesa
function fresh(key, delay = 0, dur = 500) {
  let r = seen.get(key), created = false;
  if (!r) {
    created = !seed;
    r = { t: seed ? -1e9 : Date.now(), delay };
    seen.set(key, r);
    if (seen.size > 800) seen.delete(seen.keys().next().value);
  }
  const left = r.delay - (Date.now() - r.t);
  return { created, left, active: left > -dur };
}

// ================= FICHAS =================
const DEN = [[1000, '#d9b25f', '#7a5d1c'], [500, '#7b3fa0', '#4a2368'], [100, '#2a2a2a', '#000'], [25, '#2e8b57', '#175a37'], [5, '#c0392b', '#7a1f16'], [1, '#e6e6e6', '#9a9a9a']];
function chipsHTML(amount) {
  let rest = amount, cols = '';
  for (const [v, c, b] of DEN) {
    const n = Math.floor(rest / v); rest -= n * v;
    if (!n) continue;
    let st = '';
    for (let i = 0; i < Math.min(n, 8); i++) st += `<i class="chip" style="--c:${c};--b:${b};bottom:${i * 4}px"></i>`;
    cols += `<div class="stack">${st}</div>`;
  }
  return `<div class="stacks">${cols}</div>`;
}
const chipColor = a => (DEN.find(d => a >= d[0]) || DEN[5]);
const betPos = k => [POS[k][0] + (50 - POS[k][0]) * 0.4, POS[k][1] + (50 - POS[k][1]) * 0.4];

function fly(from, to, delay = 0, count = 3, amount = 25) {
  const [, c, b] = chipColor(amount), layer = $('#fx');
  for (let i = 0; i < count; i++) {
    const el = document.createElement('i');
    el.className = 'chip fly'; el.style.setProperty('--c', c); el.style.setProperty('--b', b);
    layer.appendChild(el);
    if (!el.animate) { el.remove(); continue; }
    const a = el.animate([
      { left: from[0] + '%', top: from[1] + '%', opacity: 0 },
      { opacity: 1, offset: 0.15 },
      { left: to[0] + '%', top: to[1] + '%', opacity: 1 },
    ], { duration: 650, delay: delay + i * 90, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' });
    a.onfinish = () => el.remove();
  }
}

// ================= CONEXIÓN =================
$('#name').value = store.get('pname') || '';
const urlRoom = new URLSearchParams(location.search).get('room');
$('#room').value = urlRoom || Math.random().toString(36).slice(2, 6).toUpperCase();

$('#lobbyForm').onsubmit = e => {
  e.preventDefault();
  audio(); // el navegador exige un gesto del usuario para activar el sonido
  store.set('pname', $('#name').value.trim());
  connect($('#name').value.trim(), $('#room').value.trim().toUpperCase());
};

function connect(name, room) {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', room, name, playerId }));
    clearInterval(connect.ka); // mensaje periódico: evita que el hosting gratuito duerma el servidor
    connect.ka = setInterval(() => send({ type: 'ping' }), 25000);
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'joined') {
      $('#lobby').hidden = true; $('#app').hidden = false;
      $('#roomLabel').textContent = 'Mesa ' + m.room;
      history.replaceState(null, '', '?room=' + m.room);
    } else if (m.type === 'state') {
      const old = state;
      state = m.state; state._off = Date.now() - state.serverTime;
      render(old);
    } else if (m.type === 'error') toast(m.message);
  };
  ws.onclose = () => { toast('Conexión perdida, reconectando…'); setTimeout(() => connect(name, room), 1500); };
}

const send = o => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2500); }

// ================= DIBUJO =================
function cardEl(c, mini, fx) {
  const d = document.createElement('div');
  if (!c) d.className = 'card back' + (mini ? ' mini' : '');
  else {
    d.className = 'card' + (c.s === 'h' || c.s === 'd' ? ' red' : '') + (mini ? ' mini' : '');
    d.innerHTML = `<small>${RANK(c.r)}</small><span>${SUIT[c.s]}</span>`;
  }
  if (fx && fx.active) {
    d.classList.add(fx.cls);
    d.style.animationDelay = Math.round(fx.left) + 'ms';
    if (fx.dx !== undefined) { d.style.setProperty('--dx', fx.dx + 'px'); d.style.setProperty('--dy', fx.dy + 'px'); }
  }
  return d;
}

const ACTION_SOUND = { Fold: 'fold', Check: 'check', Call: 'chips', Raise: 'chips', Bet: 'chips', 'All-in': 'chips', 'Ciega pequeña': 'chips', 'Ciega grande': 'chips' };

function render(P) {
  const s = state, me = s.mySeat;
  seed = !P;
  const tw = $('#table').offsetWidth, th = $('#table').offsetHeight;

  $('#blindsLabel').textContent = `Ciegas ${s.blinds[0]}/${s.blinds[1]}`;
  const betsTotal = s.seats.reduce((a, p) => a + (p ? p.bet : 0), 0);
  $('#pot').textContent = s.pot ? `Bote ${s.pot}` : '';
  $('#potChips').innerHTML = s.pot - betsTotal > 0 ? chipsHTML(s.pot - betsTotal) : '';

  // cartas comunitarias (con animación al salir cada calle)
  const com = $('#community'); com.innerHTML = '';
  const prevCount = P && P.handNumber === s.handNumber ? P.community.length : 0;
  s.community.forEach((c, ci) => {
    const f = fresh(`c${s.handNumber}-${ci}`, Math.max(0, ci - prevCount) * 260, 550);
    if (f.created) play('deal', f.left);
    com.appendChild(cardEl(c, false, { ...f, cls: 'streetIn' }));
  });

  const winSeats = new Map((s.result?.winners || []).map(w => [w.seat, w]));
  $('#banner').textContent = s.phase === 'waiting'
    ? (s.started ? 'Esperando jugadores…' : 'Siéntate y pulsa «Iniciar partida» (mínimo 2 jugadores)')
    : (s.result ? s.result.winners.map(w => `${w.name} gana ${w.amount}${w.handName ? ' · ' + w.handName : ''}`).join('  |  ') : '');

  // orden de reparto: desde la izquierda del dealer
  const dIdx = s.seats.findIndex(p => p && p.isDealer), order = [];
  for (let k = 1; k <= 6; k++) { const i = (((dIdx + k) % 6) + 6) % 6; if (s.seats[i] && s.seats[i].cards.length) order.push(i); }

  const seatsEl = $('#seats'); seatsEl.innerHTML = '';
  let betsHTML = '', collected = false;
  for (let i = 0; i < 6; i++) {
    const p = s.seats[i], [x, y] = POS[i];
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
      const pos = order.indexOf(i);
      p.cards.forEach((c, ci) => {
        let fx = null;
        const rvKey = `rv${s.handNumber}-${i}-${ci}`;
        const was = P && P.handNumber === s.handNumber && P.seats[i] && P.seats[i].cards[ci] === null;
        if (c && (was || seen.has(rvKey))) {
          const f = fresh(rvKey, 0, 450);
          if (f.created) play('flip', 0);
          if (f.active) fx = { ...f, cls: 'reveal' };
        }
        if (!fx && pos >= 0) {
          const f = fresh(`h${s.handNumber}-${i}-${ci}`, 250 + (ci * order.length + pos) * 170, 550);
          if (f.created) play('deal', f.left);
          if (f.active) fx = { ...f, cls: 'dealIn', dx: Math.round((50 - x) / 100 * tw), dy: Math.round((50 - y) / 100 * th) };
        }
        hand.appendChild(cardEl(c, true, fx));
      });
      const status = winSeats.has(i) ? `+${winSeats.get(i).amount}` : (p.handName || (!p.connected ? 'desconectado' : p.lastAction || ''));
      const roles = [p.isSB && 'SB', p.isBB && 'BB'].filter(Boolean).join(' ');
      el.appendChild(hand);
      const plate = document.createElement('div'); plate.className = 'plate';
      plate.innerHTML = `${p.isDealer ? '<span class="dealer">D</span>' : ''}<div class="nm">${esc(p.name)}</div>
        <div class="ch">${p.chips}${p.allIn ? ' · all-in' : ''}</div><div class="st">${esc(status)}${roles && !status ? roles : ''}</div>
        ${i === s.toAct ? '<div class="timer" id="timer"></div>' : ''}`;
      el.appendChild(plate);

      // fichas apostadas frente al jugador
      if (p.bet > 0) {
        const f = fresh(`b${s.handNumber}-${i}-${p.bet}`, 0, 350);
        const [bx, by] = betPos(i);
        betsHTML += `<div class="betspot${f.active ? ' pop' : ''}" style="left:${bx}%;top:${by}%">${chipsHTML(p.bet)}<span class="amt">${p.bet}</span></div>`;
      }
      // sonido por acción de otros jugadores
      const pp = P && P.seats[i];
      if (!seed && pp && p.lastAction && p.lastAction !== pp.lastAction && ACTION_SOUND[p.lastAction]) play(ACTION_SOUND[p.lastAction]);
      // las apuestas se recogen al bote al terminar la ronda
      if (!seed && P && P.handNumber === s.handNumber && pp && pp.bet > 0 && p.bet === 0) {
        fly(betPos(i), [50, 50], 0, Math.min(4, 2 + Math.floor(pp.bet / 100)), pp.bet); collected = true;
      }
    }
    seatsEl.appendChild(el);
  }
  $('#bets').innerHTML = betsHTML;
  if (collected) play('chips', 150);

  // el bote viaja hacia el ganador
  if (s.result) {
    const rf = fresh('res' + s.handNumber, 0, 100);
    if (rf.created) {
      const wait = collected ? 750 : 0;
      s.result.winners.forEach(w => fly([50, 50], [POS[w.seat][0], POS[w.seat][1] - 6], wait, 5, w.amount));
      play('win', wait + 200); play('chips', wait + 500);
    }
  }
  // aviso de turno
  if (!seed && me >= 0 && s.toAct === me && (!P || P.toAct !== s.toAct)) play('turn');

  const ready = s.seats.filter(p => p && p.chips > 0).length;
  $('#startBtn').hidden = !(me >= 0 && s.phase === 'waiting' && ready >= 2 && !s.started);
  $('#standBtn').hidden = me < 0;
  $('#log').innerHTML = s.log.map(l => `<div>${esc(l)}</div>`).join(''); $('#log').scrollTop = 1e9;
  $('#chat').innerHTML = s.chat.map(c => `<div><b>${esc(c.name)}:</b> ${esc(c.text)}</div>`).join(''); $('#chat').scrollTop = 1e9;
  renderActions();
  seed = false;
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
$('#muteBtn').textContent = muted ? '🔇' : '🔊';
$('#muteBtn').onclick = () => { muted = !muted; store.set('mute', muted ? '1' : '0'); $('#muteBtn').textContent = muted ? '🔇' : '🔊'; if (!muted) { audio(); play('chips'); } };
$('#copyLink').onclick = () => {
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(location.href).then(() => toast('Enlace copiado'));
  else prompt('Copia este enlace y envíalo a tus amigos:', location.href);
};
$('#chatForm').onsubmit = e => { e.preventDefault(); const v = $('#chatInput').value.trim(); if (v) send({ type: 'chat', text: v }); $('#chatInput').value = ''; };
