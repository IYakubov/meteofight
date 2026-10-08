// ═══════════════════════════════════════════════════════
//  ROCK DRIFT — SERVER
//  Express + Socket.io: room codes, solo / 2-pilot lobby,
//  QR join link, one phone = one slot, joystick relay
// ═══════════════════════════════════════════════════════
const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ── ROOM STATE ──
// rooms[code] = {
//   hostSocketId,
//   mode:      'solo' | 'duo',
//   players:   { A: socketId|null, B: socketId|null },
//   clientIds: { A: string|null,   B: string|null },   // one phone = one slot
//   ready:     { A: false, B: false },
//   started:   false,
//   lastUi:    null                                     // mirrored menu for (re)joining phones
// }
const rooms = {};

function genCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms[code]);
  return code;
}

function lanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return null;
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || /^127\./.test(hostname);
}

// Build the controller link. If the host page was opened on localhost the
// phones can't reach that, so swap in this machine's LAN IP.
function buildJoinUrl(origin, base, code) {
  let url;
  try { url = new URL(origin); } catch (e) { url = new URL('http://localhost:' + PORT); }
  if (isLocalHost(url.hostname)) {
    const ip = lanIP();
    if (ip) url.hostname = ip;
  }
  let b = typeof base === 'string' && base.startsWith('/') ? base : '/';
  if (!b.endsWith('/')) b += '/';
  return url.origin + b + 'controller.html?code=' + code;
}

function neededSlots(room) {
  return room.mode === 'duo' ? ['A', 'B'] : ['A'];
}

function lobbyPayload(room) {
  return { mode: room.mode, A: !!room.players.A, B: !!room.players.B, readyA: room.ready.A, readyB: room.ready.B };
}

function toPlayers(room, event, payload) {
  if (room.players.A) io.to(room.players.A).emit(event, payload);
  if (room.players.B) io.to(room.players.B).emit(event, payload);
}

function broadcastLobby(code) {
  const room = rooms[code];
  if (!room) return;
  const payload = lobbyPayload(room);
  if (room.hostSocketId) io.to(room.hostSocketId).emit('lobby_update', payload);
  toPlayers(room, 'lobby_update', payload);
}

// Is this socket the current owner of its slot?
function playerRoom(socket) {
  const code = socket.data.code, slot = socket.data.slot;
  const room = rooms[code];
  if (!room || !slot || room.players[slot] !== socket.id) return null;
  return { room, code, slot };
}

// Shared by join_game and rejoin_game. A phone (clientId) keeps its slot;
// a socket never holds two slots; nobody can take a slot another phone owns.
function claimSlot(socket, code, clientId) {
  const room = rooms[code];
  if (!room) { socket.emit('join_error', 'Room not found'); return; }
  const cid = typeof clientId === 'string' && clientId.length <= 64 ? clientId : null;
  const allowed = neededSlots(room);

  // already seated here
  if (socket.data.code === code && socket.data.slot && room.players[socket.data.slot] === socket.id) {
    socket.emit('joined', { slot: socket.data.slot, code, mode: room.mode });
    if (room.started) socket.emit('game_start');
    if (room.lastUi) socket.emit('host_ui', room.lastUi);
    return;
  }

  let slot = null;
  if (cid) {
    for (const s of allowed) if (room.clientIds[s] === cid) slot = s;
  }

  if (slot) {
    // same phone opened the link again — the old tab gets replaced
    const old = room.players[slot];
    if (old && old !== socket.id) {
      const oldSock = io.sockets.sockets.get(old);
      if (oldSock) {
        oldSock.emit('replaced');
        oldSock.data.code = null; oldSock.data.slot = null;
        oldSock.leave(code);
      }
    }
  } else {
    if (room.started) { socket.emit('join_error', 'Game already started'); return; }
    slot = allowed.find(s => !room.players[s]) || null;
    if (!slot) { socket.emit('join_error', 'Room is full'); return; }
    room.ready[slot] = false;
  }

  room.players[slot] = socket.id;
  room.clientIds[slot] = cid;
  socket.data.code = code;
  socket.data.slot = slot;
  socket.join(code);

  console.log(`[${code}] slot ${slot} ← ${socket.handshake.headers['user-agent'] || 'unknown device'}`);

  socket.emit('joined', { slot, code, mode: room.mode });
  if (room.hostSocketId) io.to(room.hostSocketId).emit('player_joined', { slot, players: lobbyPayload(room) });
  broadcastLobby(code);
  if (room.started) socket.emit('game_start');
  if (room.lastUi) socket.emit('host_ui', room.lastUi);
}

io.on('connection', (socket) => {

  // ── HOST: create a new game (solo or 2-player) ──
  socket.on('create_game', async (opts) => {
    const old = socket.data.hostCode;
    if (old && rooms[old]) { toPlayers(rooms[old], 'host_disconnected'); delete rooms[old]; }

    const mode = opts && opts.mode === 'duo' ? 'duo' : 'solo';
    const code = genCode();
    rooms[code] = {
      hostSocketId: socket.id,
      mode,
      players: { A: null, B: null },
      clientIds: { A: null, B: null },
      ready: { A: false, B: false },
      started: false,
      lastUi: null
    };
    socket.data.hostCode = code;

    const origin = (opts && opts.origin) || ('http://' + (socket.handshake.headers.host || 'localhost:' + PORT));
    const joinUrl = buildJoinUrl(origin, opts && opts.base, code);
    let qrSvg = '';
    try {
      qrSvg = await QRCode.toString(joinUrl, {
        type: 'svg', margin: 0, errorCorrectionLevel: 'M',
        color: { dark: '#1b1b1a', light: '#00000000' }
      });
    } catch (e) { console.error('QR failed', e); }
    socket.emit('game_created', { code, mode, joinUrl, qrSvg });
  });

  // ── HOST: close the room (Esc in the lobby) ──
  socket.on('close_game', () => {
    const code = socket.data.hostCode;
    if (code && rooms[code] && rooms[code].hostSocketId === socket.id) {
      toPlayers(rooms[code], 'host_disconnected');
      delete rooms[code];
    }
    socket.data.hostCode = null;
  });

  // ── CONTROLLER: join / rejoin ──
  socket.on('join_game', (p) => claimSlot(socket, String((p && p.code) || ''), p && p.clientId));
  socket.on('rejoin_game', (p) => claimSlot(socket, String((p && p.code) || ''), p && p.clientId));

  // ── CONTROLLER: ready up. Solo starts with Pilot A, duo needs both ──
  socket.on('player_ready', () => {
    const pr = playerRoom(socket);
    if (!pr) return;
    const { room, code, slot } = pr;
    room.ready[slot] = true;
    broadcastLobby(code);
    const everyone = neededSlots(room).every(s => room.players[s] && room.ready[s]);
    if (everyone && !room.started) {
      room.started = true;
      toPlayers(room, 'game_start');
      if (room.hostSocketId) io.to(room.hostSocketId).emit('game_start');
    }
  });

  // ── HOST: back to lobby — phones stay connected, ready state resets ──
  socket.on('host_back_to_lobby', () => {
    const room = rooms[socket.data.hostCode];
    if (!room || room.hostSocketId !== socket.id) return;
    room.started = false;
    room.ready = { A: false, B: false };
    room.lastUi = null;
    toPlayers(room, 'back_to_lobby');
    broadcastLobby(socket.data.hostCode);
  });

  // ── HOST → PHONES: mirrored menu state ──
  socket.on('host_ui', (ui) => {
    const room = rooms[socket.data.hostCode];
    if (!room || room.hostSocketId !== socket.id) return;
    room.lastUi = ui || null;
    toPlayers(room, 'host_ui', ui || null);
  });

  // ── HOST → ONE PHONE: hull, hits, round result ──
  socket.on('to_player', ({ slot, kind, data } = {}) => {
    const room = rooms[socket.data.hostCode];
    if (!room || room.hostSocketId !== socket.id) return;
    if (slot !== 'A' && slot !== 'B') return;
    if (room.players[slot]) io.to(room.players[slot]).emit('player_msg', { kind, data });
  });

  // ── CONTROLLER: input relay (slot always comes from the server socket) ──
  // ctrl_input: the full joystick state {up,down,left,right}, sent on change and every 80 ms
  socket.on('ctrl_input', (p = {}) => {
    const pr = playerRoom(socket);
    if (!pr || !pr.room.hostSocketId) return;
    io.to(pr.room.hostSocketId).emit('ctrl_input', {
      slot: pr.slot, up: !!p.up, down: !!p.down, left: !!p.left, right: !!p.right
    });
  });
  socket.on('ctrl_fire', () => {
    const pr = playerRoom(socket);
    if (!pr || !pr.room.hostSocketId) return;
    io.to(pr.room.hostSocketId).emit('ctrl_fire', { slot: pr.slot });
  });
  socket.on('ctrl_menu', ({ index } = {}) => {
    const pr = playerRoom(socket);
    if (!pr || !pr.room.hostSocketId) return;
    io.to(pr.room.hostSocketId).emit('ctrl_menu', { slot: pr.slot, index: index | 0 });
  });

  // ── Latency diagnostic ──
  socket.on('ping_check', (cb) => { if (typeof cb === 'function') cb(); });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    const hostCode = socket.data.hostCode;
    if (hostCode && rooms[hostCode] && rooms[hostCode].hostSocketId === socket.id) {
      toPlayers(rooms[hostCode], 'host_disconnected');
      delete rooms[hostCode];
    }
    const pr = playerRoom(socket);
    if (pr) {
      const { room, code, slot } = pr;
      room.players[slot] = null;
      room.ready[slot] = false;
      // clientIds[slot] is kept so the same phone can come back to its ship
      if (room.hostSocketId) io.to(room.hostSocketId).emit('player_left', { slot });
      broadcastLobby(code);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const ip = lanIP();
  console.log(`ROCK DRIFT server running on http://localhost:${PORT}`);
  if (ip) console.log(`On your network:  http://${ip}:${PORT}`);
});
