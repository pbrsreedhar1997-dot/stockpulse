import webpush from 'web-push';
import { query } from '../db.js';
import log from '../log.js';
import { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CONTACT } from '../config.js';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    VAPID_CONTACT || 'mailto:support@stockpulse.in',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
  log.info('Web Push (VAPID) ready');
} else {
  log.warn('VAPID keys not configured — Web Push disabled');
}

export { VAPID_PUBLIC_KEY };
export const pushEnabled = () => !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

export async function saveSubscription(userId, subscription) {
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id=$1, p256dh=$3, auth=$4, created_at=$5`,
    [userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, Date.now()],
  );
}

export async function removeSubscription(endpoint) {
  await query('DELETE FROM push_subscriptions WHERE endpoint=$1', [endpoint]);
}

export async function sendPushToUser(userId, payload) {
  if (!pushEnabled()) return 0;

  let rows;
  try {
    const r = await query('SELECT * FROM push_subscriptions WHERE user_id=$1', [userId]);
    rows = r.rows;
  } catch (e) {
    log.warn(`Push DB query failed: ${e.message}`);
    return 0;
  }

  let sent = 0;
  await Promise.allSettled(
    rows.map(async row => {
      const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
        sent++;
      } catch (e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          await removeSubscription(row.endpoint).catch(() => {});
        } else {
          log.warn(`Push send failed uid=${userId}: ${e.message}`);
        }
      }
    }),
  );
  return sent;
}
