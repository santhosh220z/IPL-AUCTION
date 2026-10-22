import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './events.js';
import { rooms } from './rooms.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CLIENT_DIST = path.join(ROOT, 'client', 'dist');
const INDEX_HTML = path.join(CLIENT_DIST, 'index.html');
const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.disable('x-powered-by');

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, rooms: rooms.size, uptimeSec: Math.round(process.uptime()) });
});

if (fs.existsSync(INDEX_HTML)) {
  app.use(express.static(CLIENT_DIST));
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api') || request.path.startsWith('/socket.io')) {
      next();
      return;
    }
    response.sendFile(INDEX_HTML);
  });
} else {
  app.get('/', (_request, response) => {
    response
      .status(200)
      .type('text/plain')
      .send('IPL Auction server is running. Start the Vite client with "npm run dev" for development.');
  });
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true },
});

registerSocketHandlers(io);

server.listen(PORT, '0.0.0.0', () => {
  const networkInterfaces = os.networkInterfaces();
  const addresses = Object.values(networkInterfaces)
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);

  console.log(`IPL Auction server listening on http://localhost:${PORT}`);
  for (const address of addresses) {
    console.log(`LAN: http://${address}:${PORT}`);
  }
  if (!fs.existsSync(INDEX_HTML)) {
    console.log('Client build not found. Run "npm run lan" to build and serve the client from this server.');
  }
});

function shutdown(signal) {
  console.log(`${signal} received. Closing server...`);
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
