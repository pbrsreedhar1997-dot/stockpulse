import React, { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { useWatchlist } from '../../hooks/useWatchlist';
import { usePortfolio } from '../../hooks/usePortfolio';
import { useStocks } from '../../hooks/useStocks';
import PriceAlertPanel from '../PriceAlert/PriceAlertPanel';
import { fmtPrice, fmtMktCap } from '../../utils/currency';
import './StockHeader.scss';

/* ── Glanceable 30-day sparkline ─────────────────────────────────────────────── */
function Sparkline({ symbol }) {
  const { fetchHistory } = useStocks();
  const [pts, setPts] = useState(null);

  useEffect(() => {
    let alive = true;
    setPts(null);
    fetchHistory(symbol, '1mo')
      .then(d => { if (alive) setPts(d?.candles?.map(c => c.c).filter(v => v != null) ?? []); })
      .catch(() => { if (alive) setPts([]); });
    return () => { alive = false; };
  }, [symbol]);

  if (!pts) return <div className="sparkline sparkline--loading" />;
  if (pts.length < 3) return null;

  const W = 132, H = 40, P = 3;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const x = i => P + (i / (pts.length - 1)) * (W - 2 * P);
  const y = v => P + (1 - (v - min) / span) * (H - 2 * P);
  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  const up = pts[pts.length - 1] >= pts[0];
  const stroke = up ? 'var(--up)' : 'var(--down)';
  const gid = `spark-${up ? 'u' : 'd'}`;

  return (
    <div className="sparkline" title="30-day trend">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={stroke} strokeWidth="1.6"
          strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="2.4" fill={stroke} />
      </svg>
      <span className="sparkline__tag">30D</span>
    </div>
  );
}

function fmt(n, dec = 2) {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/* Live NSE market hours: Mon–Fri 09:15–15:30 IST */
function useMarketStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    function check() {
      const now = new Date();
      const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const day = ist.getDay();
      const h   = ist.getHours();
      const m   = ist.getMinutes();
      const mins = h * 60 + m;
      if (day === 0 || day === 6) { setStatus('closed'); return; }
      if (mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30) setStatus('open');
      else if (mins < 9 * 60 + 15) setStatus('pre');
      else setStatus('closed');
    }
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, []);
  return status;
}

/* Inline holding modal */
function QuickAddModal({ symbol, name, holding, currency, onClose, onSave }) {
  const [shares,   setShares]   = useState(holding?.shares   ?? '');
  const [avgPrice, setAvgPrice] = useState(holding?.avg_price ?? '');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  async function submit(e) {
    e.preventDefault();
    const s = parseFloat(shares), p = parseFloat(avgPrice);
    if (!s || s <= 0) { setError('Shares must be > 0'); return; }
    if (!p || p <= 0) { setError('Price must be > 0');  return; }
    setSaving(true);
    try { await onSave({ symbol, name, shares: s, avg_price: p }); onClose(); }
    catch (err) { setError(err?.message || 'Failed'); }
    finally { setSaving(false); }
  }

  return (
    <div className="sh-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sh-modal">
        <div className="sh-modal__hdr">
          <div>
            <div className="sh-modal__title">{holding ? 'Edit Holding' : 'Add to Portfolio'}</div>
            <div className="sh-modal__sym">{symbol.replace(/\.(NS|BO)$/i, '')}</div>
          </div>
          <button className="sh-modal__x" onClick={onClose}>×</button>
        </div>
        <form className="sh-modal__form" onSubmit={submit}>
          <label>
            <span>Shares</span>
            <input type="number" step="0.0001" min="0.0001" placeholder="e.g. 10"
              value={shares} onChange={e => setShares(e.target.value)} required autoFocus />
          </label>
          <label>
            <span>Avg Buy Price</span>
            <input type="number" step="0.01" min="0.01" placeholder="e.g. 1350.00"
              value={avgPrice} onChange={e => setAvgPrice(e.target.value)} required />
          </label>
          {shares && avgPrice && parseFloat(shares) > 0 && parseFloat(avgPrice) > 0 && (
            <div className="sh-modal__preview">
              Invested: <strong>{fmtPrice(parseFloat(shares) * parseFloat(avgPrice), currency)}</strong>
            </div>
          )}
          {error && <div className="sh-modal__error">{error}</div>}
          <div className="sh-modal__btns">
            <button type="button" className="sh-modal__btn sh-modal__btn--cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="sh-modal__btn sh-modal__btn--save" disabled={saving}>
              {saving ? 'Saving…' : holding ? 'Update' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function StockHeader({ symbol }) {
  const { state } = useAppContext();
  const q = state.quotes[symbol];
  const p = state.profiles[symbol];
  const f = state.financials[symbol];
  const { add: addToWatchlist, remove: removeFromWatchlist } = useWatchlist();
  const { getHolding, addHolding, updateHolding } = usePortfolio();
  const holding      = getHolding(symbol);
  const [showModal,  setShowModal]  = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const marketStatus = useMarketStatus();

  const inWatchlist = state.watchlist.some(s => s.symbol === symbol);
  const alertCount  = state.alerts.filter(a => a.symbol === symbol && !a.triggered).length;
  const triggeredCount = state.alerts.filter(a => a.symbol === symbol && a.triggered).length;

  function toggleWatchlist() {
    if (inWatchlist) removeFromWatchlist(symbol);
    else addToWatchlist(symbol, p?.name || symbol, p?.exchange || 'NSE');
  }

  async function handleSave(data) {
    if (holding) await updateHolding(symbol, data);
    else         await addHolding(data);
  }

  const prevPriceRef = useRef(null);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    if (q?.price == null) return;
    if (prevPriceRef.current != null && prevPriceRef.current !== q.price) {
      const cls = q.price > prevPriceRef.current ? 'price-flash--up' : 'price-flash--down';
      setFlash(cls);
      const t = setTimeout(() => setFlash(''), 700);
      prevPriceRef.current = q.price;
      return () => clearTimeout(t);
    }
    prevPriceRef.current = q.price;
  }, [q?.price]);

  const up = q?.change_pct >= 0;

  const w52h  = f?.week52_high || q?.week52_high;
  const w52l  = f?.week52_low  || q?.week52_low;
  const pe    = f?.pe_ratio    ?? q?.pe_ratio;
  const eps   = f?.eps         ?? q?.eps;
  const mktCp = q?.mkt_cap || f?.market_cap;

  const cur = q?.currency || (symbol.match(/\.(NS|BO)$/i) ? 'INR' : 'USD');
  const isINR = cur === 'INR';

  const stats = [
    { label: 'Open',       value: q?.open       ? fmtPrice(q.open,       cur) : '—' },
    { label: 'High',       value: q?.high       ? fmtPrice(q.high,       cur) : '—', cls: 'up' },
    { label: 'Low',        value: q?.low        ? fmtPrice(q.low,        cur) : '—', cls: 'down' },
    { label: 'Prev Close', value: q?.prev_close ? fmtPrice(q.prev_close, cur) : '—' },
    { label: 'Volume',     value: q?.volume     ? (isINR ? `${(q.volume / 1e5).toFixed(2)}L` : `${(q.volume / 1e6).toFixed(2)}M`) : '—' },
    { label: 'Mkt Cap',    value: fmtMktCap(mktCp, cur) },
    { label: '52W High',   value: w52h ? fmtPrice(w52h, cur) : '—', cls: 'up' },
    { label: '52W Low',    value: w52l ? fmtPrice(w52l, cur) : '—', cls: 'down' },
    { label: 'P/E',        value: pe  != null ? `${fmt(pe)}x` : '—', cls: pe < 15 ? 'up' : pe > 45 ? 'down' : '' },
    { label: 'EPS',        value: eps != null ? fmtPrice(eps, cur) : '—', cls: eps > 0 ? 'up' : eps < 0 ? 'down' : '' },
  ];

  const mktStatusMeta = {
    open:   { cls: 'mst--open',   dot: true,  label: 'NSE Open'    },
    pre:    { cls: 'mst--pre',    dot: false, label: 'Pre-market'   },
    closed: { cls: 'mst--closed', dot: false, label: 'NSE Closed'  },
  };
  const mst = mktStatusMeta[marketStatus] || mktStatusMeta.closed;

  return (
    <div className="stock-header">
      {/* ── Top row ─────────────────────────────────────────────────────────── */}
      <div className="stock-header__top">
        {p?.logo_url && (
          <img className="stock-header__logo" src={p.logo_url} alt=""
            onError={e => (e.target.style.display = 'none')} />
        )}

        <div className="stock-header__name-block">
          <h1 className="stock-header__name">{p?.name || symbol}</h1>
          <div className="stock-header__meta">
            <span className="badge badge--neutral">{symbol.replace(/\.(NS|BO)$/i, '')}</span>
            {p?.exchange && <span className="badge badge--neutral">{p.exchange}</span>}
            {p?.sector   && <span className="badge badge--accent">{p.sector}</span>}
            {marketStatus && (
              <span className={`mst-pill ${mst.cls}`}>
                {mst.dot && <span className="mst-pill__dot" />}
                {mst.label}
              </span>
            )}
          </div>
        </div>

        <Sparkline symbol={symbol} />

        <div className="stock-header__price-block">
          {q ? (
            <>
              <div className={`stock-header__price ${flash}`}>{fmtPrice(q.price, cur)}</div>
              <div className={`stock-header__change ${up ? 'up' : 'down'}`}>
                {up ? '▲' : '▼'}&nbsp;
                {up ? '+' : ''}{fmt(q.change)}&nbsp;
                ({up ? '+' : ''}{q.change_pct?.toFixed(2)}%)
              </div>
            </>
          ) : (
            <>
              <div className="skeleton" style={{ width: 160, height: 30 }} />
              <div className="skeleton" style={{ width: 110, height: 16, marginTop: 6 }} />
            </>
          )}
        </div>
      </div>

      {/* ── Stats bar ─────────────────────────────────────────────────────── */}
      <div className="stock-header__stats">
        {stats.map(s => (
          <div key={s.label} className="stat">
            <span className="stat__label">{s.label}</span>
            <span className={`stat__value${s.cls ? ` ${s.cls}` : ''}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* ── Actions bar ─────────────────────────────────────────────────────── */}
      <div className="stock-header__actions-bar">
        <button
          className={`sh-wl-btn ${inWatchlist ? 'sh-wl-btn--added' : ''}`}
          onClick={toggleWatchlist}
        >
          {inWatchlist ? '★ In Watchlist' : '☆ Add to Watchlist'}
        </button>

        {/* Alert bell — only for logged-in users */}
        {state.user && (
          <button
            className={`sh-alert-btn ${alertCount > 0 ? 'sh-alert-btn--active' : ''} ${triggeredCount > 0 ? 'sh-alert-btn--triggered' : ''}`}
            onClick={() => setShowAlerts(true)}
            title="Set price alerts"
          >
            🔔
            {alertCount > 0 && <span className="sh-alert-btn__badge">{alertCount}</span>}
            {triggeredCount > 0 && <span className="sh-alert-btn__badge sh-alert-btn__badge--hit">{triggeredCount}✓</span>}
            Alerts
          </button>
        )}

        {holding ? (
          <div className="sh-holding-pill">
            <span className="sh-holding-pill__label">Holding:</span>
            <span>{holding.shares} @ {fmtPrice(holding.avg_price, cur)}</span>
            {holding.pnl != null && (
              <span className={`sh-pnl ${holding.pnl >= 0 ? 'up' : 'down'}`}>
                {holding.pnl >= 0 ? '+' : ''}{fmtPrice(holding.pnl, cur)}
                &nbsp;({holding.pnl_pct >= 0 ? '+' : ''}{holding.pnl_pct?.toFixed(2)}%)
              </span>
            )}
            <button className="sh-pf-btn sh-pf-btn--edit" onClick={() => setShowModal(true)}>Edit</button>
          </div>
        ) : state.user ? (
          <button className="sh-pf-btn sh-pf-btn--add" onClick={() => setShowModal(true)}>
            + Add to Portfolio
          </button>
        ) : null}
      </div>

      {showModal && (
        <QuickAddModal
          symbol={symbol} name={p?.name || symbol} holding={holding} currency={cur}
          onClose={() => setShowModal(false)} onSave={handleSave}
        />
      )}

      {showAlerts && (
        <PriceAlertPanel
          symbol={symbol} name={p?.name || symbol} currentPrice={q?.price} currency={cur}
          onClose={() => setShowAlerts(false)}
        />
      )}
    </div>
  );
}
