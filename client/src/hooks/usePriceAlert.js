import { useEffect, useRef, useCallback } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { useApi } from './useApi';
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
  const api     = useApi();
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

      // In-browser notification
      const canNotify = await ensureNotifyPermission();
      if (canNotify) fireNotification(alert, q.price);

      // Server-side push to ALL user devices (mobile, locked screen, other tabs)
      const sym  = alert.symbol.replace(/\.(NS|BO)$/i, '');
      const dir  = alert.type === 'above' ? '▲ rose above' : '▼ fell below';
      const pStr = q.price.toLocaleString('en-IN', { minimumFractionDigits: 2 });
      const tStr = alert.targetPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 });
      api.post('/api/push/send-alert', {
        title: `🔔 ${sym} Alert`,
        body:  `${alert.name || sym} ${dir} your target ₹${tStr}. Now ₹${pStr}`,
        tag:   `pa-${alert.id}`,
      }).catch(() => {});
    });
  }, [state.quotes, state.alerts, state.user]);

  const requestPermission = useCallback(() => ensureNotifyPermission(), []);

  return { requestPermission };
}
