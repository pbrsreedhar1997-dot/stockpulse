import { WebSocket } from 'ws';
import { getQuote } from './services/yahoo.js';
import { streamChat } from './services/ai.js';
import { query } from './db.js';
import log from './log.js';

const clients = new Map(); // ws → { symbols: Set<string>, userId: null|number }
let priceTimer = null;

function safeSend(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}

function startPriceTick() {
  if (priceTimer) return;
  priceTimer = setInterval(async () => {
    const allSymbols = new Set();
    for (const [, info] of clients) info.symbols.forEach(s => allSymbols.add(s));
    if (!allSymbols.size) return;

    for (const symbol of allSymbols) {
      try {
        const data = await getQuote(symbol);
        if (!data) continue;
        const msg = JSON.stringify({ type: 'price', symbol, ...data });
        for (const [ws, info] of clients) {
          if (info.symbols.has(symbol) && ws.readyState === WebSocket.OPEN) ws.send(msg);
        }
      } catch {}
    }
  }, 30000);
}

async function resolveToken(token) {
  if (!token) return null;
  try {
    const now = Math.floor(Date.now() / 1000);
    const r = await query('SELECT user_id FROM user_sessions WHERE token=$1 AND expires_at>$2', [token, now]);
    return r.rows[0]?.user_id ?? null;
  } catch { return null; }
}

export async function handleWsConnection(ws) {
  const info = { symbols: new Set(), userId: null };
  clients.set(ws, info);
  log.info(`WS connected (clients: ${clients.size})`);

  safeSend(ws, { type: 'connected', version: '3.0.0' });
  startPriceTick();

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'subscribe': {
        const syms = (msg.symbols || []).map(s => String(s).toUpperCase()).filter(Boolean);
        syms.forEach(s => info.symbols.add(s));
        for (const sym of syms) {
          try {
            const data = await getQuote(sym);
            if (data) safeSend(ws, { type: 'price', symbol: sym, ...data });
          } catch {}
        }
        break;
      }
      case 'unsubscribe':
        (msg.symbols || []).forEach(s => info.symbols.delete(String(s).toUpperCase()));
        break;

      case 'chat': {
        const { id, question, symbols = [], history = [], token } = msg;
        if (!id || !question?.trim()) break;
        if (token && !info.userId) info.userId = await resolveToken(token);
        streamChat({
          question:  String(question),
          symbols:   symbols.map(s => String(s).toUpperCase()),
          history:   Array.isArray(history) ? history : [],
          onDelta:   text => safeSend(ws, { type: 'chat_delta', id, text }),
          onDone:    ()   => safeSend(ws, { type: 'chat_done',  id }),
          onError:   err  => safeSend(ws, { type: 'chat_error', id, error: String(err) }),
        }).catch(e  => safeSend(ws, { type: 'chat_error', id, error: e.message }));
        break;
      }
      case 'ping':
        safeSend(ws, { type: 'pong' });
        break;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    log.info(`WS disconnected (clients: ${clients.size})`);
    if (!clients.size) { clearInterval(priceTimer); priceTimer = null; }
  });

  ws.on('error', err => log.error('WS error:', err.message));
}
