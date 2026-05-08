import { useEffect, useRef, useCallback } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { playAboveTone, playBelowTone } from '../utils/audio';

async function ensureNotifyPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

function fireNotification(alert, currentPrice) {
  const sym   = alert.symbol.replace(/\.(NS|BO)$/i, '');
  const dir   = alert.type === 'above' ? 'risen above' : 'fallen below';
  const title = `🔔 Price Alert: ${sym}`;
  const body  = `${alert.name || sym} has ${dir} your target ₹${alert.targetPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}. Current: ₹${currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  try {
    const n = new Notification(title, { body, icon: '/favicon.ico', tag: `pa-${alert.id}`, requireInteraction: true });
    n.onclick = () => { window.focus(); n.close(); };
  } catch {}
}

export function usePriceAlert() {
  const { state, dispatch } = useAppContext();
  const firedRef = useRef(new Set()); // ids that have already triggered in this session

  useEffect(() => {
    if (!state.user) return; // alerts only for logged-in users
    const activeAlerts = state.alerts.filter(a => !a.triggered);
    if (!activeAlerts.length) return;

    activeAlerts.forEach(async (alert) => {
      if (firedRef.current.has(alert.id)) return;
      const q = state.quotes[alert.symbol];
      if (!q?.price) return;

      const hit =
        (alert.type === 'above' && q.price >= alert.targetPrice) ||
        (alert.type === 'below' && q.price <= alert.targetPrice);

      if (!hit) return;

      firedRef.current.add(alert.id);
      dispatch({ type: 'TRIGGER_ALERT', payload: alert.id });

      // Play tone
      if (alert.type === 'above') playAboveTone();
      else playBelowTone();

      // Browser notification
      const canNotify = await ensureNotifyPermission();
      if (canNotify) fireNotification(alert, q.price);
    });
  }, [state.quotes, state.alerts, state.user]);

  const requestPermission = useCallback(() => ensureNotifyPermission(), []);

  return { requestPermission };
}
