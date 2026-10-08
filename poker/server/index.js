// PASO 4 — Servidor: HTTP (archivos del cliente) + WebSocket (partida en tiempo real).
const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Table } = require('./game');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map(); // código -> { table, clients: Map(playerId -> ws) }

function getRoom(code) {
  if (!rooms.has(code)) {
    const room = { table: new Table({ smallBlind: 10, bigBlind: 20, buyIn: 1000 }), clients: new Map() };
    room.table.onUpdate = () => broadcast(room);
    rooms.set(code, room);
  }
  return rooms.get(code);
}

function broadcast(room) {
  for (const [id, ws] of room.clients) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'state', state: room.table.getState(id) }));
  }
}

const send = (ws, obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  let room = null, pid = null, name = '';

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    try {
      if (m.type === 'join') {
        const code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
        pid = String(m.playerId || '').slice(0, 64);
        name = String(m.name || 'Jugador').trim().slice(0, 16) || 'Jugador';
        if (!code || !pid) throw new Error('Datos de entrada inválidos');
        room = getRoom(code);
        const old = room.clients.get(pid);
        if (old && old !== ws) old.close(); // misma persona reconectando
        room.clients.set(pid, ws);
        room.table.join(pid, name);
        send(ws, { type: 'joined', room: code });
        return;
      }
      if (!room) return;
      const t = room.table;
      switch (m.type) {
        case 'sit': t.sit(pid, name, m.seat, m.buyIn); break;
        case 'stand': t.stand(pid); break;
        case 'start': t.startGame(pid); break;
        case 'rebuy': t.rebuy(pid); break;
        case 'action': t.act(pid, m.action, m.amount); break;
        case 'chat': {
          const text = String(m.text || '').slice(0, 200).trim();
          if (text) { t.chat.push({ name, text }); t.update(); }
          break;
        }
      }
    } catch (e) {
      send(ws, { type: 'error', message: e.message });
    }
  });

  ws.on('close', () => {
    if (room && pid && room.clients.get(pid) === ws) {
      room.clients.delete(pid);
      room.table.disconnect(pid);
      if (room.clients.size === 0 && room.table.seats.every(s => !s || !s.connected)) {
        room.table.clearTimers();
        setTimeout(() => {
          if (room.clients.size === 0) for (const [k, v] of rooms) if (v === room) rooms.delete(k);
        }, 10 * 60 * 1000);
      }
    }
  });
});

// detectar conexiones muertas
setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 20000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n♠ Mesa de póker lista`);
  console.log(`  En esta PC:      http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  En tu red local: http://${i.address}:${PORT}`);
  console.log('');
});
