import React, { createContext, useContext, useEffect, useRef, useCallback } from 'react';

const Ctx = createContext(null);

export function WebSocketProvider({ children }) {
  const wsRef      = useRef(null);
  const listeners  = useRef(new Map()); // type → Set<fn>
  const reconnTimer = useRef(null);
  const readyRef   = useRef(false);
  const queueRef   = useRef([]); // messages queued before connection opens

  const emit = useCallback((obj) => {
    const msg = JSON.stringify(obj);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(msg);
    } else {
      queueRef.current.push(msg); // queue until connected
    }
  }, []);

  const on = useCallback((type, cb) => {
    if (!listeners.current.has(type)) listeners.current.set(type, new Set());
    listeners.current.get(type).add(cb);
    return () => listeners.current.get(type)?.delete(cb);
  }, []);

  function connect() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url   = `${proto}//${window.location.host}/ws`;
    const ws    = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      readyRef.current = true;
      // Drain queued messages
      while (queueRef.current.length) {
        try { ws.send(queueRef.current.shift()); } catch {}
      }
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        listeners.current.get(msg.type)?.forEach(cb => {
          try { cb(msg); } catch {}
        });
      } catch {}
    };

    ws.onclose = () => {
      readyRef.current = false;
      reconnTimer.current = setTimeout(connect, 5000);
    };

    ws.onerror = () => ws.close();
  }

  useEffect(() => {
    connect();
    // Keepalive ping every 25s so the connection isn't killed by idle timeouts
    const ping = setInterval(() => emit({ type: 'ping' }), 25000);
    return () => {
      clearInterval(ping);
      clearTimeout(reconnTimer.current);
      wsRef.current?.close();
    };
  }, []);

  return <Ctx.Provider value={{ emit, on }}>{children}</Ctx.Provider>;
}

export function useWebSocket() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWebSocket must be inside WebSocketProvider');
  return ctx;
}
