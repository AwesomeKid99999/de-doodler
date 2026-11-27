const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT) || 3000;

function resolvePublicFile() {
  const candidates = [
    process.env.GAME_FILE ? path.resolve(process.env.GAME_FILE) : null,
    path.resolve(__dirname, 'de doodler.html'),
    path.resolve(__dirname, '..', 'de doodler.html'),
    path.resolve(__dirname, 'public', 'de doodler.html')
  ].filter(Boolean);

  return candidates.find(filePath => fs.existsSync(filePath)) || candidates[0];
}

const PUBLIC_FILE = resolvePublicFile();
const rooms = new Map();

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      alphabet[Math.floor(Math.random() * alphabet.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room, message, except) {
  for (const client of room.clients) {
    if (client.ws !== except) send(client.ws, message);
  }
}

function broadcastGameState(room, state, except) {
  const payload = JSON.stringify({ type: 'game-state', state });
  for (const client of room.clients) {
    const ws = client.ws;
    if (ws === except || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 0) continue;

    ws.send(payload);
  }
}

function getLobby(room) {
  return room.clients.map(client => client.peer);
}

function sanitizeColor(color, fallback = '#60a5fa') {
  return /^#[0-9a-f]{6}$/i.test(String(color || '')) ? String(color).toLowerCase() : fallback;
}

function normalizeCode(code) {
  return String(code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function removeClient(ws) {
  for (const [code, room] of rooms) {
    const index = room.clients.findIndex(client => client.ws === ws);
    if (index === -1) continue;

    const removed = room.clients.splice(index, 1)[0];
    if (ws.roomCode === code) ws.roomCode = null;

    if (room.host === ws) {
      if (room.clients.length > 0) {
        room.host = room.clients[0].ws;
        room.hostId = room.clients[0].peer.id;
        broadcast(room, { type: 'host-changed', hostId: room.hostId });
        send(room.host, {
          type: 'player-left',
          playerId: removed.peer.id,
          name: removed.peer.name
        });
        broadcast(room, {
          type: 'lobby',
          players: getLobby(room),
          bots: room.bots,
          hostId: room.hostId
        });
      } else {
        rooms.delete(code);
      }
    } else {
      send(room.host, {
        type: 'player-left',
        playerId: removed.peer.id,
        name: removed.peer.name
      });
      broadcast(room, {
        type: 'lobby',
        players: getLobby(room),
        bots: room.bots,
        hostId: room.hostId
      });
    }
    send(ws, { type: 'left', playerId: removed.peer.id });
  }
}

const server = http.createServer((req, res) => {
  let requestPath;
  try {
    requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request');
    return;
  }

  if (requestPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }

  if (requestPath !== '/' && requestPath !== '/index.html' && requestPath !== '/de doodler.html') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  fs.readFile(PUBLIC_FILE, (error, content) => {
    if (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Unable to load the game');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  });
});

const wss = new WebSocketServer({ server });

wss.on('error', err => {
  console.error('WebSocket server error:', err);
});

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => removeClient(ws));

  ws.on('message', raw => {
    ws.isAlive = true;

    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', message: 'Invalid message' });
      return;
    }

    if (message.type === 'ping') {
      send(ws, { type: 'pong' });
      return;
    }

    if (message.type === 'create') {
      if (ws.roomCode) removeClient(ws);
      const code = makeCode();
      const peer = {
        id: String(message.peer?.id || 'p_0'),
        name: String(message.peer?.name || 'You').trim().slice(0, 16) || 'You',
        color: sanitizeColor(message.peer?.color, '#ef4444')
      };
      const room = {
        host: ws,
        hostId: peer.id,
        bots: [],
        activeGame: false,
        clients: [{ ws, peer }]
      };
      rooms.set(code, room);
      ws.roomCode = code;
      send(ws, { type: 'room-created', code, hostId: peer.id });
      send(ws, { type: 'lobby', players: getLobby(room), bots: room.bots, hostId: peer.id });
      return;
    }

    if (message.type === 'check-room') {
      const code = normalizeCode(message.code);
      const room = rooms.get(code);
      if (!room) {
        send(ws, { type: 'error', message: 'Room not found' });
        return;
      }
      send(ws, { type: 'room-check', code, activeGame: Boolean(room.activeGame) });
      return;
    }

    if (message.type === 'join') {
      if (ws.roomCode) removeClient(ws);
      const code = normalizeCode(message.code);
      const room = rooms.get(code);
      if (!room) {
        send(ws, { type: 'error', message: 'Room not found' });
        return;
      }
      let peerId = String(message.peer?.id || `p_${room.clients.length}`);
      if (room.clients.some(c => c.peer.id === peerId)) {
        peerId = `p_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      }
      const peer = {
        id: peerId,
        name: String(message.peer?.name || `Player ${room.clients.length + 1}`).trim().slice(0, 16) || `Player ${room.clients.length + 1}`,
        color: sanitizeColor(message.peer?.color, '#60a5fa')
      };
      room.clients.push({ ws, peer });
      ws.roomCode = code;
      send(ws, { type: 'room-joined', code, hostId: room.hostId, playerId: peer.id });
      broadcast(room, {
        type: 'lobby',
        players: getLobby(room),
        bots: room.bots,
        hostId: room.hostId
      });
      return;
    }

    if (!ws.roomCode) {
      send(ws, { type: 'error', message: 'Join or create a room first' });
      return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room) return;

    if (message.type === 'lobby') {
      if (room.host === ws) {
        room.bots = Array.isArray(message.bots) ? message.bots : [];
        broadcast(room, {
          type: 'lobby',
          players: getLobby(room),
          bots: room.bots,
          hostId: room.hostId
        }, ws);
      } else {
        send(ws, {
          type: 'lobby',
          players: getLobby(room),
          bots: room.bots,
          hostId: room.hostId
        });
      }
      return;
    }

    if (message.type === 'update-profile') {
      const client = room.clients.find(entry => entry.ws === ws);
      const name = String(message.name || '').trim().slice(0, 16);
      if (!client || !name || String(message.playerId || '') !== client.peer.id) return;
      client.peer.name = name;
      client.peer.color = sanitizeColor(message.color, client.peer.color);
      broadcast(room, {
        type: 'lobby',
        players: getLobby(room),
        bots: room.bots,
        hostId: room.hostId
      });
      return;
    }

    if (message.type === 'chat') {
      const text = String(message.text || '').trim().slice(0, 240);
      if (!text) return;
      const sender = room.clients.find(client => client.ws === ws);
      broadcast(room, {
        type: 'chat',
        playerId: sender?.peer.id || room.hostId,
        name: sender?.peer.name || 'Player',
        text
      });
      return;
    }

    if (message.type === 'end-game') {
      if (room.host === ws) {
        room.activeGame = false;
        broadcast(room, { type: 'end-game' }, ws);
      }
      return;
    }

    if (message.type === 'kick') {
      if (room.host !== ws) {
        send(ws, { type: 'error', message: 'Only the host can remove players.' });
        return;
      }
      const target = room.clients.find(client => client.peer.id === String(message.playerId));
      if (!target || target.ws === room.host) return;
      send(target.ws, { type: 'kicked' });
      target.ws.close();
      return;
    }

    if (message.type === 'game-state') {
      if (room.host === ws) {
        room.activeGame = true;
        broadcastGameState(room, message.state, ws);
      }
      return;
    }

    if (message.type === 'room-event') {
      if (room.host === ws) {
        broadcast(room, { type: 'room-event', event: message.event }, ws);
      }
      return;
    }

    if (message.type === 'action') {
      if (room.host !== ws) {
        const sender = room.clients.find(client => client.ws === ws);
        send(room.host, {
          type: 'action',
          action: message.action,
          playerId: sender?.peer.id || message.playerId
        });
      }
      return;
    }

    if (message.type === 'leave') {
      removeClient(ws);
    }
  });

  ws.on('close', () => removeClient(ws));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DE DOODLER server running at http://0.0.0.0:${PORT}`);
});