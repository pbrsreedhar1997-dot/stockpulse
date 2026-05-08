import { useEffect, useRef } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { useApi } from './useApi';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export function usePushSubscription() {
  const { state } = useAppContext();
  const api = useApi();
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!state.user || subscribedRef.current) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    subscribedRef.current = true;

    (async () => {
      try {
        /* 1. Register (or reuse) the service worker */
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;

        /* 2. Fetch the server VAPID public key */
        const { data: kd } = await api.get('/api/push/vapid-key').catch(() => ({ data: null }));
        if (!kd?.enabled || !kd?.key) return; // push not configured on server

        /* 3. Create (or retrieve existing) push subscription */
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(kd.key),
          });
        }

        /* 4. Send subscription to server */
        await api.post('/api/push/subscribe', { subscription: sub.toJSON() });
      } catch (e) {
        // Permission denied or browser doesn't support — silently skip
      }
    })();
  }, [state.user]);
}
