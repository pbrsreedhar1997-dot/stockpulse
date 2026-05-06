import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

import { PORT, REDIS_URL } from './config.js';
import { initDb } from './db.js';
import { initCache } from './cache.js';
import { verifyToken } from './middleware/auth.js';
import { handleWsConnection } from './ws.js';
import log from './log.js';

import pingRouter     from './routes/ping.js';
import authRouter     from './routes/auth.js';
import stocksRouter   from './routes/stocks.js';
import screenerRouter from './routes/screener.js';
import watchlistRouter from './routes/watchlist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/ws' });

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(verifyToken);

// ── REST API ─────────────────────────────────────────────────────────────────
app.use('/api',           pingRouter);
app.use('/api/auth',      authRouter);
app.use('/api',           stocksRouter);
app.use('/api/screener',  screenerRouter);
app.use('/api/watchlist', watchlistRouter);

// ── Static React build ────────────────────────────────────────────────────────
const staticDir = path.join(__dirname, '..', 'static', 'dist', 'browser');
app.use(express.static(staticDir));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws'))
    return res.status(404).json({ ok: false, error: 'Not found' });
  res.sendFile(path.join(staticDir, 'index.html'));
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
wss.on('connection', handleWsConnection);

// ── Startup ───────────────────────────────────────────────────────────────────
async function start() {
  await initDb();
  await initCache(REDIS_URL);
  server.listen(PORT, () => log.info(`StockPulse v3 (Node.js) on port ${PORT}`));
}

start().catch(err => { console.error('Startup failed:', err); process.exit(1); });
