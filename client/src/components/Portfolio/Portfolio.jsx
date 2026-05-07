import React, { useEffect, useState } from 'react';
import { usePortfolio } from '../../hooks/usePortfolio';
import { useAppContext } from '../../contexts/AppContext';
import './Portfolio.scss';

const REC_META = {
  BUY_MORE:     { label: 'Buy More',     cls: 'buy'    },
  HOLD:         { label: 'Hold',         cls: 'hold'   },
  SELL_PARTIAL: { label: 'Sell Partial', cls: 'sell'   },
  SELL:         { label: 'Sell',         cls: 'sell'   },
  REVIEW:       { label: 'Review',       cls: 'review' },
};

function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtCr(n) {
  if (!n) return '—';
  const cr = n / 1e7;
  if (cr >= 1e5) return `₹${(cr / 1e5).toFixed(2)}L Cr`;
  if (cr >= 1e3) return `₹${(cr / 1e3).toFixed(2)}K Cr`;
  return `₹${cr.toFixed(0)} Cr`;
}

function HoldingModal({ holding, onClose, onSave, symbol, name }) {
  const [shares, setShares]     = useState(holding?.shares ?? '');
  const [avgPrice, setAvgPrice] = useState(holding?.avg_price ?? '');
  const [notes, setNotes]       = useState(holding?.notes ?? '');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    const s = parseFloat(shares), p = parseFloat(avgPrice);
    if (!s || s <= 0) { setError('Shares must be greater than 0'); return; }
    if (!p || p <= 0) { setError('Purchase price must be greater than 0'); return; }
    setSaving(true);
    try {
      await onSave({ symbol, name, shares: s, avg_price: p, notes: notes.trim() || null });
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pf-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pf-modal">
        <div className="pf-modal__header">
          <div>
            <div className="pf-modal__title">{holding ? 'Edit Holding' : 'Add to Portfolio'}</div>
            <div className="pf-modal__sym">{symbol.replace(/\.(NS|BO)$/i, '')}</div>
          </div>
          <button className="pf-modal__close" onClick={onClose}>×</button>
        </div>
        <form className="pf-modal__form" onSubmit={handleSave}>
          <label>
            <span>Number of Shares</span>
            <input
              type="number" step="0.0001" min="0.0001" placeholder="e.g. 10"
              value={shares} onChange={e => setShares(e.target.value)} required autoFocus
            />
          </label>
          <label>
            <span>Average Buy Price (₹)</span>
            <input
              type="number" step="0.01" min="0.01" placeholder="e.g. 1350.00"
              value={avgPrice} onChange={e => setAvgPrice(e.target.value)} required
            />
          </label>
          <label>
            <span>Notes <em>(optional)</em></span>
            <input
              type="text" placeholder="e.g. Long-term hold, SIP"
              value={notes} onChange={e => setNotes(e.target.value)}
              maxLength={200}
            />
          </label>
          {shares && avgPrice && parseFloat(shares) > 0 && parseFloat(avgPrice) > 0 && (
            <div className="pf-modal__preview">
              Total invested: <strong>₹{fmt(parseFloat(shares) * parseFloat(avgPrice))}</strong>
            </div>
          )}
          {error && <div className="pf-modal__error">{error}</div>}
          <div className="pf-modal__actions">
            <button type="button" className="pf-modal__btn pf-modal__btn--cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="pf-modal__btn pf-modal__btn--save" disabled={saving}>
              {saving ? 'Saving…' : holding ? 'Update' : 'Add Holding'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function HoldingCard({ h, onEdit, onRemove }) {
  const up  = h.pnl >= 0;
  const rec = REC_META[h.recommendation?.action] || REC_META.HOLD;

  return (
    <div className="pf-card">
      <div className="pf-card__top">
        <div className="pf-card__id">
          <div className="pf-card__symbol">{h.symbol.replace(/\.(NS|BO)$/i, '')}</div>
          <div className="pf-card__name">{h.name}</div>
        </div>
        <div className="pf-card__actions">
          <span className={`pf-rec pf-rec--${rec.cls}`}>{rec.label}</span>
          <button className="pf-card__btn pf-card__btn--edit" onClick={() => onEdit(h)} title="Edit holding">✎</button>
          <button className="pf-card__btn pf-card__btn--remove" onClick={() => onRemove(h.symbol)} title="Remove">×</button>
        </div>
      </div>

      <div className="pf-card__grid">
        <div className="pf-card__kv">
          <span>Shares</span>
          <strong>{h.shares}</strong>
        </div>
        <div className="pf-card__kv">
          <span>Avg Buy</span>
          <strong>₹{fmt(h.avg_price)}</strong>
        </div>
        <div className="pf-card__kv">
          <span>Current</span>
          <strong className={h.change_pct >= 0 ? 'up' : 'down'}>₹{fmt(h.current_price)}</strong>
        </div>
        <div className="pf-card__kv">
          <span>Invested</span>
          <strong>₹{fmt(h.invested)}</strong>
        </div>
        <div className="pf-card__kv">
          <span>Value</span>
          <strong>₹{fmt(h.current_value)}</strong>
        </div>
        <div className="pf-card__kv">
          <span>P&amp;L</span>
          <strong className={up ? 'up' : 'down'}>
            {up ? '+' : ''}₹{fmt(h.pnl)}
            <em> ({up ? '+' : ''}{fmt(h.pnl_pct)}%)</em>
          </strong>
        </div>
        {h.pe_ratio && (
          <div className="pf-card__kv">
            <span>P/E</span>
            <strong>{fmt(h.pe_ratio, 1)}</strong>
          </div>
        )}
        {h.week52_high && (
          <div className="pf-card__kv">
            <span>52W Range</span>
            <strong>₹{fmt(h.week52_low)} – ₹{fmt(h.week52_high)}</strong>
          </div>
        )}
      </div>

      {h.recommendation && (
        <div className="pf-card__advice">
          <div className="pf-card__advice-text">{h.recommendation.reason}</div>
          <div className="pf-card__advice-levels">
            <span>Target: <strong className="up">₹{fmt(h.recommendation.target_price)}</strong></span>
            <span>Stop Loss: <strong className="down">₹{fmt(h.recommendation.stop_loss)}</strong></span>
          </div>
        </div>
      )}

      {h.notes && <div className="pf-card__notes">📝 {h.notes}</div>}
    </div>
  );
}

export default function Portfolio() {
  const { state, dispatch } = useAppContext();
  const { portfolio, fetchPortfolio, addHolding, updateHolding, removeHolding } = usePortfolio();
  const [modal, setModal] = useState(null); // { symbol, name, holding? }
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!state.token) return;
    setLoading(true);
    fetchPortfolio().finally(() => setLoading(false));
  }, [state.token]);

  async function handleSave({ symbol, name, shares, avg_price, notes }) {
    const existing = portfolio?.holdings?.find(h => h.symbol === symbol);
    if (existing) {
      await updateHolding(symbol, { shares, avg_price, notes });
    } else {
      await addHolding({ symbol, name, shares, avg_price, notes });
    }
  }

  async function handleRemove(symbol) {
    if (!confirm(`Remove ${symbol.replace(/\.(NS|BO)$/i, '')} from portfolio?`)) return;
    await removeHolding(symbol);
  }

  if (!state.user) {
    return (
      <div className="pf-empty">
        <div className="pf-empty__icon">💼</div>
        <div className="pf-empty__title">Track Your Investments</div>
        <div className="pf-empty__sub">Log in to add your holdings and get personalised buy/sell recommendations.</div>
        <button className="pf-empty__cta" onClick={() => dispatch({ type: 'TOGGLE_AUTH_MODAL' })}>
          Sign in to get started
        </button>
      </div>
    );
  }

  if (loading && !portfolio) {
    return (
      <div className="pf-loading">
        <span className="spinner" />
        <span>Loading portfolio…</span>
      </div>
    );
  }

  const holdings   = portfolio?.holdings ?? [];
  const summary    = portfolio?.summary  ?? {};
  const totalUp    = (summary.total_pnl ?? 0) >= 0;

  return (
    <div className="pf-page">
      <div className="pf-header">
        <div className="pf-header__left">
          <h2 className="pf-header__title">My Portfolio</h2>
          {holdings.length > 0 && (
            <span className="pf-header__count">{holdings.length} holding{holdings.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        <button
          className="pf-add-btn"
          onClick={() => {
            const sym = state.currentSymbol;
            const prof = sym ? state.profiles[sym] : null;
            setModal({ symbol: sym || '', name: prof?.name || '' });
          }}
        >
          + Add Holding
        </button>
      </div>

      {holdings.length > 0 && (
        <div className="pf-summary">
          <div className="pf-summary__card">
            <span>Total Invested</span>
            <strong>₹{fmt(summary.total_invested)}</strong>
          </div>
          <div className="pf-summary__card">
            <span>Current Value</span>
            <strong>₹{fmt(summary.total_value)}</strong>
          </div>
          <div className={`pf-summary__card pf-summary__card--pnl ${totalUp ? 'up' : 'down'}`}>
            <span>Overall P&amp;L</span>
            <strong>
              {totalUp ? '+' : ''}₹{fmt(summary.total_pnl)}
            </strong>
          </div>
          <div className={`pf-summary__card pf-summary__card--pct ${totalUp ? 'up' : 'down'}`}>
            <span>Return</span>
            <strong>{totalUp ? '+' : ''}{fmt(summary.total_pnl_pct)}%</strong>
          </div>
        </div>
      )}

      {holdings.length === 0 ? (
        <div className="pf-empty pf-empty--inline">
          <div className="pf-empty__icon">📊</div>
          <div className="pf-empty__title">No holdings yet</div>
          <div className="pf-empty__sub">
            Select a stock from the dashboard and click "Add to Portfolio", or use the button above.
          </div>
        </div>
      ) : (
        <div className="pf-list">
          {holdings.map(h => (
            <HoldingCard
              key={h.symbol}
              h={h}
              onEdit={h => setModal({ symbol: h.symbol, name: h.name, holding: h })}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}

      {modal && (
        <HoldingModal
          symbol={modal.symbol}
          name={modal.name}
          holding={modal.holding}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
