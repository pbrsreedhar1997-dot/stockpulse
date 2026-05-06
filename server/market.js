const NSE_HOLIDAYS = new Set([
  '2025-01-26','2025-02-19','2025-03-14','2025-03-31','2025-04-14',
  '2025-04-18','2025-05-01','2025-08-15','2025-08-27','2025-10-02',
  '2025-10-20','2025-10-21','2025-11-05','2025-12-25',
  '2026-01-26','2026-02-19','2026-03-03','2026-03-20','2026-04-03',
  '2026-04-14','2026-05-01','2026-06-19','2026-08-15','2026-10-02',
  '2026-11-13','2026-11-24','2026-12-25',
]);

export function isNseOpen() {
  const now  = new Date();
  const fmt  = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const dow = now.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' });

  if (dow === 'Sat' || dow === 'Sun') return false;
  if (NSE_HOLIDAYS.has(dateStr)) return false;

  const totalMin = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
  return totalMin >= 9 * 60 + 15 && totalMin < 15 * 60 + 30;
}

export function quoteTtl(symbol) {
  const isIndian = symbol.endsWith('.NS') || symbol.endsWith('.BO');
  return (isIndian && !isNseOpen()) ? 300 : 60;
}
