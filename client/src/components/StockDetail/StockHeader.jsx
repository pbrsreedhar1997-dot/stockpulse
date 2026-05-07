import React, { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { usePortfolio } from '../../hooks/usePortfolio';
import './StockHeader.scss';

function fmt(n, dec = 2) {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtCr(n) {
  if (!n) return '—';
  const cr = n / 1e7;
  if (cr >= 1e5) return `₹${(cr / 1e5).toFixed(2)}L Cr`;
  if (cr >= 1e3) return `₹${(cr / 1e3).toFixed(2)}K Cr`;
  return `₹${cr.toFixed(0)} Cr`;
}

// ── Inline holding modal (used directly from the header) ─────────────────────
function QuickAddModal({ symbol, name, holding, onClose, onSave }) {
  const [shares,   setShares]   = useState(holding?.shares   ?? '');
  const [avgPrice, setAvgPrice] = useState(holding?.avg_price ?? '');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  async function submit(e) {
    e.preventDefault();
    const s = parseFloat(shares), p = parseFloat(avgPrice);
    if (!s || s <= 0)  { setError('Shares must be > 0'); return; }
    if (!p || p <= 0)  { setError('Price must be > 0');  return; }
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
            <span>Avg Buy Price (₹)</span>
            <input type="number" step="0.01" min="0.01" placeholder="e.g. 1350.00"
              value={avgPrice} onChange={e => setAvgPrice(e.target.value)} required />
          </label>
          {shares && avgPrice && parseFloat(shares) > 0 && parseFloat(avgPrice) > 0 && (
            <div className="sh-modal__preview">
              Invested: <strong>₹{(parseFloat(shares) * parseFloat(avgPrice)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
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
  const { getHolding, addHolding, updateHolding } = usePortfolio();
  const holding = getHolding(symbol);
  const [showModal, setShowModal] = useState(false);

  async function handleSave(data) {
    if (holding) await updateHolding(symbol, data);
    else         await addHolding(data);
  }

  const prevPriceRef = useRef(null);
  const [flash, setFlash] = useState('');

  // Flash the price green/red when a live tick arrives with a new price
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

  const stats = [
    { label: 'Open',       value: q?.open       ? `₹${fmt(q.open)}`       : '—' },
    { label: 'High',       value: q?.high       ? `₹${fmt(q.high)}`       : '—', cls: 'up' },
    { label: 'Low',        value: q?.low        ? `₹${fmt(q.low)}`        : '—', cls: 'down' },
    { label: 'Prev Close', value: q?.prev_close ? `₹${fmt(q.prev_close)}` : '—' },
    { label: 'Volume',     value: q?.volume     ? `${(q.volume / 1e5).toFixed(2)}L` : '—' },
    { label: 'Mkt Cap',    value: fmtCr(mktCp) },
    { label: '52W High',   value: w52h ? `₹${fmt(w52h)}` : '—', cls: 'up' },
    { label: '52W Low',    value: w52l ? `₹${fmt(w52l)}` : '—', cls: 'down' },
    { label: 'P/E',        value: pe  != null ? `${fmt(pe)}x` : '—' },
    { label: 'EPS',        value: eps != null ? `₹${fmt(eps)}` : '—' },
  ];

  return (
    <div className="stock-header">
      <div className="stock-header__top">
        {p?.logo_url && (
          <img
            className="stock-header__logo"
            src={p.logo_url}
            alt=""
            onError={e => (e.target.style.display = 'none')}
          />
        )}

        <div className="stock-header__name-block">
          <h1 className="stock-header__name">{p?.name || symbol}</h1>
          <div className="stock-header__meta">
            <span className="badge badge--neutral">
              {symbol.replace(/\.(NS|BO)$/i, '')}
            </span>
            {p?.exchange && <span className="badge badge--neutral">{p.exchange}</span>}
            {p?.sector   && <span className="badge badge--accent">{p.sector}</span>}
          </div>
        </div>

        <div className="stock-header__price-block">
          {q ? (
            <>
              <div className={`stock-header__price ${flash}`}>₹{fmt(q.price)}</div>
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

      <div className="stock-header__stats">
        {stats.map(s => (
          <div key={s.label} className="stat">
            <span className="stat__label">{s.label}</span>
            <span className={`stat__value${s.cls ? ` ${s.cls}` : ''}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {state.user && (
        <div className="stock-header__portfolio-bar">
          {holding ? (
            <div className="sh-holding-pill">
              <span className="sh-holding-pill__label">Your Holding:</span>
              <span>{holding.shares} shares @ ₹{holding.avg_price?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              {holding.pnl != null && (
                <span className={holding.pnl >= 0 ? 'up' : 'down'}>
                  {holding.pnl >= 0 ? '+' : ''}₹{holding.pnl?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  &nbsp;({holding.pnl_pct >= 0 ? '+' : ''}{holding.pnl_pct?.toFixed(2)}%)
                </span>
              )}
              <button className="sh-pf-btn sh-pf-btn--edit" onClick={() => setShowModal(true)}>Edit</button>
            </div>
          ) : (
            <button className="sh-pf-btn sh-pf-btn--add" onClick={() => setShowModal(true)}>
              + Add to Portfolio
            </button>
          )}
        </div>
      )}

      {showModal && (
        <QuickAddModal
          symbol={symbol}
          name={p?.name || symbol}
          holding={holding}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
