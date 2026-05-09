/**
 * Returns the currency symbol for a given ISO currency code.
 * Defaults to the code itself if not recognised.
 */
export function currencySymbol(currency) {
  switch ((currency || '').toUpperCase()) {
    case 'INR': return '₹';
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'GBP': return '£';
    case 'JPY': return '¥';
    case 'CNY':
    case 'CNH': return '¥';
    case 'HKD': return 'HK$';
    case 'SGD': return 'S$';
    case 'AUD': return 'A$';
    case 'CAD': return 'CA$';
    default:    return currency || '$';
  }
}

/**
 * Format a price value with the correct currency symbol and locale.
 * INR uses en-IN formatting; everything else uses en-US.
 */
export function fmtPrice(value, currency, decimals = 2) {
  if (value == null || isNaN(value)) return '—';
  const sym = currencySymbol(currency);
  const isINR = (currency || '').toUpperCase() === 'INR';
  const locale = isINR ? 'en-IN' : 'en-US';
  return sym + value.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format large market-cap numbers.
 * INR: ₹X Cr / ₹X L Cr  |  Others: $XB / $XM
 */
export function fmtMktCap(value, currency) {
  if (!value) return '—';
  const isINR = (currency || '').toUpperCase() === 'INR';
  const sym = currencySymbol(currency);
  if (isINR) {
    const cr = value / 1e7;
    if (cr >= 1e5) return `${sym}${(cr / 1e5).toFixed(2)}L Cr`;
    if (cr >= 1e3) return `${sym}${(cr / 1e3).toFixed(2)}K Cr`;
    if (cr >= 1)   return `${sym}${cr.toFixed(0)} Cr`;
    return `${sym}${value.toLocaleString('en-IN')}`;
  }
  const b = value / 1e9;
  if (Math.abs(b) >= 1)  return `${sym}${b.toFixed(2)}B`;
  const m = value / 1e6;
  if (Math.abs(m) >= 1)  return `${sym}${m.toFixed(0)}M`;
  return `${sym}${value.toLocaleString('en-US')}`;
}
