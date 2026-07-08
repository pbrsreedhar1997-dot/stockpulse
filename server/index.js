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
import watchlistRouter  from './routes/watchlist.js';
import portfolioRouter  from './routes/portfolio.js';
import pushRouter       from './routes/push.js';
import chatRouter       from './routes/chat.js';

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
app.use('/api/portfolio', portfolioRouter);
app.use('/api/push',     pushRouter);
app.use('/api/chat',     chatRouter);

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

// ── Keep-warm — prevents Render free-tier cold starts ─────────────────────────
// Render spins the instance down after ~15 min without inbound traffic, making
// the next request take ~50s. A self-ping to the public URL every 12 min counts
// as inbound traffic and keeps the app instantly responsive.
function startKeepWarm() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url) return; // only on Render
  const ping = () => fetch(`${url}/api/ping`, { signal: AbortSignal.timeout(10000) })
    .catch(() => { /* best-effort */ });
  setInterval(ping, 12 * 60 * 1000);
  log.info(`Keep-warm enabled → ${url}/api/ping every 12m`);
}

// ── Startup ───────────────────────────────────────────────────────────────────
async function start() {
  await initDb();
  await initCache(REDIS_URL);
  server.listen(PORT, () => {
    log.info(`StockPulse v3 (Node.js) on port ${PORT}`);
    startKeepWarm();
  });
}

start().catch(err => { console.error('Startup failed:', err); process.exit(1); });
