import { useEffect, useRef, useCallback } from 'react';

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playAlertBeep() {
  try {
    const ctx  = getAudioCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    // Two-tone urgent beep
    [880, 1100].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.connect(gain);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.35, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  } catch {}
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const p = await Notification.requestPermission();
  return p === 'granted';
}

function fireNotification(symbol, price, stopLoss) {
  const title = `⚠️ Stop Loss Hit: ${symbol.replace(/\.(NS|BO)$/i, '')}`;
  const body  = `Price ₹${price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} has fallen to/below your stop loss of ₹${stopLoss.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  try {
    new Notification(title, { body, icon: '/favicon.ico', tag: `stop-loss-${symbol}` });
  } catch {}
}

export function useStopLossAlert({ portfolio, quotes }) {
  const alertedRef   = useRef(new Set()); // symbols currently in alert state
  const permGranted  = useRef(false);

  const ensurePermission = useCallback(async () => {
    if (!permGranted.current) {
      permGranted.current = await requestNotificationPermission();
    }
    return permGranted.current;
  }, []);

  useEffect(() => {
    const holdings = portfolio?.holdings;
    if (!holdings?.length || !quotes) return;

    holdings.forEach(async h => {
      if (!h.stop_loss) return;
      const q = quotes[h.symbol];
      if (!q?.price) return;

      const hitStopLoss = q.price <= h.stop_loss;

      if (!hitStopLoss) {
        alertedRef.current.delete(h.symbol); // price recovered, allow re-alert
        return;
      }
      if (alertedRef.current.has(h.symbol)) return; // already alerted
      alertedRef.current.add(h.symbol);

      // Fire alerts
      playAlertBeep();
      const canNotify = await ensurePermission();
      if (canNotify) fireNotification(h.symbol, q.price, h.stop_loss);
    });
  }, [quotes, portfolio]);

  return { ensurePermission };
}
