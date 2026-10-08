// ═══════════════════════════════════════════════════════
//  ROCK DRIFT — SERVER
//  Express + Socket.io: room codes, solo / 2-pilot lobby,
//  tilt-input relay, host → phone messages, spectator broadcast
// ═══════════════════════════════════════════════════════
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ── ROOM STATE ──
// rooms[code] = {
//   hostSocketId,
//   mode: 'solo' | 'duo',
//   players: { A: socketId|null, B: socketId|null },   // A = Pilot 1, B = Pilot 2
//   ready:   { A: bool, B: bool },
//   started: false,
//   spectatorCount: 0,
//   lastLobby, lastState
// }
const rooms = {};
const ALL_SLOTS = ['A', 'B'];

function genCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms[code]);
  return code;
}

function neededSlots(room) {
  return room.mode === 'duo' ? ['A', 'B'] : ['A'];
}

function isSlot(s) {
  return ALL_SLOTS.includes(s);
}

function roomPresence(room) {
  return { A: !!room.players.A, B: !!room.players.B };
}

function spectatorRoom(code) {
  return code + ':watch';
}

function broadcastLobby(code) {
  const room = rooms[code];
  if (!room) return;
  const presence = roomPresence(room);
  const data = {
    mode: room.mode,
    A: presence.A, B: presence.B,
    readyA: room.ready.A, readyB: room.ready.B
  };
  room.lastLobby = data;
  if (room.hostSocketId) io.to(room.hostSocketId).emit('game_event', { event: 'lobby_ready_update', data });
  for (const s of ALL_SLOTS) {
    if (room.players[s]) io.to(room.players[s]).emit('game_event', { event: 'lobby_ready_update', data });
  }
  io.to(spectatorRoom(code)).emit('lobby_update', data);
}

// Put a socket into a pilot slot and tell everyone.
function seatPlayer(socket, code, slot) {
  const room = rooms[code];
  room.players[slot] = socket.id;
  socket.data.code = code;
  socket.data.slot = slot;
  socket.join(code);
  socket.emit('joined', { slot, code, mode: room.mode });
  const presence = roomPresence(room);
  io.to(code).emit('player_joined', { slot, players: presence });
  if (room.hostSocketId) io.to(room.hostSocketId).emit('player_joined', { slot, players: presence });
  broadcastLobby(code);
}

io.on('connection', (socket) => {

  // ── HOST: create a new game (solo or 2-player) ──
  socket.on('create_game', (opts) => {
    const mode = opts && opts.mode === 'duo' ? 'duo' : 'solo';
    const code = genCode();
    rooms[code] = {
      hostSocketId: socket.id,
      mode,
      players: { A: null, B: null },
      ready: { A: false, B: false },
      started: false,
      spectatorCount: 0,
      lastLobby: null,
      lastState: null
    };
    socket.data.hostCode = code;
    socket.emit('game_created', { code, mode });
  });

  // ── CONTROLLER: join a game by code ──
  // `slot` is optional: a phone that reloads sends the slot it had before so it
  // gets its own ship back (even after the game has started).
  socket.on('join_game', ({ code, slot } = {}) => {
    const room = rooms[code];
    if (!room) {
      socket.emit('join_error', 'room not found');
      return;
    }
    const allowed = neededSlots(room);

    // Returning pilot reclaiming their old seat (a stale connection may still be
    // holding it for a few seconds, so the newcomer simply takes over)
    if (isSlot(slot) && allowed.includes(slot)) {
      seatPlayer(socket, code, slot);
      if (room.started) socket.emit('game_start');
      return;
    }

    if (room.started) {
      socket.emit('join_error', 'game already started');
      return;
    }
    const free = allowed.find(s => !room.players[s]);
    if (!free) {
      socket.emit('join_error', 'room full');
      return;
    }
    seatPlayer(socket, code, free);
  });

  // ── CONTROLLER: rejoin after a network reconnect ──
  socket.on('rejoin_game', ({ code, slot } = {}) => {
    const room = rooms[code];
    if (!room) {
      socket.emit('join_error', 'room not found');
      return;
    }
    if (!isSlot(slot) || !neededSlots(room).includes(slot)) return;
    seatPlayer(socket, code, slot);
    if (room.started) socket.emit('game_start');
  });

  // ── CONTROLLER: ready up ──
  // Solo starts as soon as Pilot 1 is ready. Duo starts when both pilots are ready.
  socket.on('player_ready', ({ code } = {}) => {
    const room = rooms[code];
    if (!room) return;
    const slot = socket.data.slot;
    if (!isSlot(slot) || room.players[slot] !== socket.id) return;
    room.ready[slot] = true;
    broadcastLobby(code);

    const needed = neededSlots(room);
    const everyoneReady = needed.every(s => room.players[s] && room.ready[s]);
    if (everyoneReady && !room.started) {
      room.started = true;
      io.to(code).emit('game_start');
      if (room.hostSocketId) io.to(room.hostSocketId).emit('game_start');
    }
  });

  // ── CONTROLLER: tilt input stream — {fwd, strafe} each in [-1,1] ──
  // The slot comes from the socket itself, so a phone can only steer its own ship.
  socket.on('ctrl_input', ({ fwd, strafe } = {}) => {
    const code = socket.data.code;
    const slot = socket.data.slot;
    const room = rooms[code];
    if (!room || !room.hostSocketId || !isSlot(slot) || room.players[slot] !== socket.id) return;
    const f = Math.max(-1, Math.min(1, Number(fwd) || 0));
    const s = Math.max(-1, Math.min(1, Number(strafe) || 0));
    io.to(room.hostSocketId).emit('ctrl_input', { slot, fwd: f, strafe: s });
  });

  // ── HOST → PHONE: hull updates, round results, etc. ──
  socket.on('to_player', ({ slot, kind, data } = {}) => {
    const room = rooms[socket.data.hostCode];
    if (!room || !isSlot(slot)) return;
    const target = room.players[slot];
    if (target) io.to(target).emit('player_msg', { kind, data });
  });

  // ── WATCHER: join as a read-only spectator (no controls) ──
  socket.on('spectate_join', ({ code } = {}) => {
    const room = rooms[code];
    if (!room) {
      socket.emit('spectate_error', 'room not found');
      return;
    }
    socket.data.watchCode = code;
    socket.join(spectatorRoom(code));
    room.spectatorCount++;
    socket.emit('spectate_ok', { code, mode: room.mode });
    if (room.lastLobby) socket.emit('lobby_update', room.lastLobby);
    if (room.lastState) socket.emit('host_state', room.lastState);
    if (room.hostSocketId) io.to(room.hostSocketId).emit('spectator_count', { count: room.spectatorCount });
  });

  // ── HOST: live gameplay snapshot, broadcast at a throttled rate ──
  socket.on('host_state', (payload) => {
    const code = socket.data.hostCode;
    const room = rooms[code];
    if (!room) return;
    room.lastState = payload;
    io.to(spectatorRoom(code)).emit('host_state', payload);
  });

  // ── Latency diagnostic ──
  socket.on('ping_check', (cb) => {
    if (typeof cb === 'function') cb();
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    const code = socket.data.code;
    const hostCode = socket.data.hostCode;

    if (hostCode && rooms[hostCode]) {
      const room = rooms[hostCode];
      for (const s of ALL_SLOTS) {
        if (room.players[s]) io.to(room.players[s]).emit('host_disconnected');
      }
      io.to(spectatorRoom(hostCode)).emit('host_disconnected');
      delete rooms[hostCode];
    }

    const watchCode = socket.data.watchCode;
    if (watchCode && rooms[watchCode]) {
      rooms[watchCode].spectatorCount = Math.max(0, rooms[watchCode].spectatorCount - 1);
      const hostId = rooms[watchCode].hostSocketId;
      if (hostId) io.to(hostId).emit('spectator_count', { count: rooms[watchCode].spectatorCount });
    }

    if (code && rooms[code]) {
      const room = rooms[code];
      const slot = socket.data.slot;
      if (isSlot(slot) && room.players[slot] === socket.id) {
        room.players[slot] = null;
        room.ready[slot] = false;
        if (room.hostSocketId) io.to(room.hostSocketId).emit('player_left', { slot });
        io.to(code).emit('player_left', { slot });
        broadcastLobby(code);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ROCK DRIFT server running on http://localhost:${PORT}`);
  console.log(`Host display: http://localhost:${PORT}/`);
  console.log(`Controller (phone): http://localhost:${PORT}/controller.html`);
});
