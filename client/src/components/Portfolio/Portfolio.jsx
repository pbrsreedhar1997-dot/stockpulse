import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Chart, CategoryScale, LinearScale, TimeScale, Tooltip, Legend,
  LineController, LineElement, PointElement, Filler,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { usePortfolio } from '../../hooks/usePortfolio';
import { useAppContext } from '../../contexts/AppContext';
import { useApi } from '../../hooks/useApi';
import './Portfolio.scss';

Chart.register(CategoryScale, LinearScale, TimeScale, Tooltip, Legend, LineController, LineElement, PointElement, Filler);

const REC_META = {
  BUY_MORE:     { label: 'Buy More',     cls: 'buy'    },
  HOLD:         { label: 'Hold',         cls: 'hold'   },
  SELL_PARTIAL: { label: 'Sell Partial', cls: 'sell'   },
  SELL:         { label: 'Sell',         cls: 'sell'   },
  REVIEW:       { label: 'Review',       cls: 'review' },
};

const fmt = (n, d = 2) => {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
};

// ── Holding History Chart ──────────────────────────────────────────────────────
function HoldingHistoryChart({ symbol, onClose }) {
  const api     = useApi();
  const canvasRef  = useRef(null);
  const chartRef   = useRef(null);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    api.get(`/api/portfolio/history/${symbol}`)
      .then(res => {
        if (res?.ok) setData(res);
        else setError('No history available');
      })
      .catch(() => setError('Failed to load history'))
      .finally(() => setLoading(false));
  }, [symbol]);

  useEffect(() => {
    chartRef.current?.destroy(); chartRef.current = null;
    if (!data?.data?.length || !canvasRef.current) return;

    const isDark  = document.documentElement.getAttribute('data-theme') !== 'light';
    const pts     = data.data;
    const cost    = data.invested;
    const lastVal = pts[pts.length - 1]?.value ?? cost;
    const isUp    = lastVal >= cost;
    const accent  = isUp ? '#00c896' : '#ff4560';
    const grid    = isDark ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.055)';
    const txt     = isDark ? '#6b7a8d' : '#8693a4';
    const ctx     = canvasRef.current.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, 0, 220);
    grad.addColorStop(0,   isUp ? 'rgba(0,200,150,0.25)' : 'rgba(255,69,96,0.2)');
    grad.addColorStop(1,   'rgba(0,0,0,0)');

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Portfolio Value',
            data:  pts.map(p => ({ x: p.ts * 1000, y: p.value })),
            borderColor: accent,
            borderWidth: 2,
            backgroundColor: grad,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.3,
            order: 1,
          },
          {
            label: 'Cost Basis',
            data:  pts.map(p => ({ x: p.ts * 1000, y: cost })),
            borderColor: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)',
            borderWidth: 1.5,
            borderDash: [5, 5],
            backgroundColor: 'transparent',
            fill: false,
            pointRadius: 0,
            tension: 0,
            order: 2,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            labels: { color: txt, font: { size: 11 }, boxWidth: 14, padding: 16 },
          },
          tooltip: {
            backgroundColor: isDark ? 'rgba(10,14,26,0.96)' : 'rgba(255,255,255,0.97)',
            borderColor: isDark ? 'rgba(99,130,195,0.22)' : 'rgba(0,0,0,0.1)',
            borderWidth: 1,
            titleColor: isDark ? '#edf0f8' : '#0d1424',
            bodyColor: txt,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: c => `${c.dataset.label}: ₹${c.raw.y?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: pts.length > 200 ? 'month' : pts.length > 60 ? 'week' : 'day' },
            grid: { color: grid }, ticks: { color: txt, maxTicksLimit: 8, font: { size: 10 } },
            border: { display: false },
          },
          y: {
            position: 'right',
            grid: { color: grid },
            ticks: {
              color: txt, font: { size: 10 },
              callback: v => '₹' + v.toLocaleString('en-IN'),
            },
            border: { display: false },
          },
        },
      },
    });
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [data]);

  const lastVal  = data?.data?.[data.data.length - 1]?.value;
  const invested = data?.invested;
  const pnl      = lastVal != null && invested != null ? lastVal - invested : null;
  const pnlPct   = pnl != null && invested ? (pnl / invested) * 100 : null;

  return (
    <div className="pf-hist-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pf-hist-modal">
        <div className="pf-hist-header">
          <div>
            <div className="pf-hist-title">Investment History</div>
            <div className="pf-hist-sym">{symbol.replace(/\.(NS|BO)$/i, '')}</div>
          </div>
          {pnl != null && (
            <div className={`pf-hist-pnl ${pnl >= 0 ? 'up' : 'down'}`}>
              <span>{pnl >= 0 ? '▲' : '▼'} {pnl >= 0 ? '+' : ''}₹{fmt(pnl)}</span>
              <small>{pnlPct >= 0 ? '+' : ''}{fmt(pnlPct)}%</small>
            </div>
          )}
          <button className="pf-hist-close" onClick={onClose}>×</button>
        </div>
        <div className="pf-hist-body">
          {loading && <div className="pf-hist-load"><span className="spinner" /></div>}
          {error   && <div className="pf-hist-err">{error}</div>}
          {!loading && !error && data?.data?.length === 0 && (
            <div className="pf-hist-err">No historical data from purchase date.</div>
          )}
          <canvas ref={canvasRef} style={{ display: (!loading && !error && data?.data?.length > 0) ? 'block' : 'none' }} />
        </div>
      </div>
    </div>
  );
}

// ── Holding modal with symbol search ──────────────────────────────────────────
function HoldingModal({ holding, onClose, onSave, initialSymbol = '', initialName = '' }) {
  const api = useApi();
  const [symbol,      setSymbol]      = useState(holding?.symbol    ?? initialSymbol);
  const [shares,      setShares]      = useState(holding?.shares    ?? '');
  const [avgPrice,    setAvgPrice]    = useState(holding?.avg_price ?? '');
  const [stopLoss,    setStopLoss]    = useState(holding?.stop_loss ?? '');
  const [purchDate,   setPurchDate]   = useState(
    holding?.purchase_date
      ? new Date(holding.purchase_date * 1000).toISOString().split('T')[0]
      : ''
  );
  const [notes,       setNotes]       = useState(holding?.notes     ?? '');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [searchRes,   setSearchRes]   = useState([]);
  const [searching,   setSearching]   = useState(false);
  const searchTimer = useRef(null);
  const resolvedName = useRef(initialName || holding?.name || '');

  const searchSymbol = useCallback(async (q) => {
    if (q.length < 1) { setSearchRes([]); return; }
    setSearching(true);
    try {
      const res = await api.get(`/api/search?q=${encodeURIComponent(q)}`);
      setSearchRes(Array.isArray(res?.data) ? res.data.slice(0, 6) : []);
    } catch {}
    finally { setSearching(false); }
  }, [api]);

  function handleSymbolChange(v) {
    setSymbol(v.toUpperCase());
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchSymbol(v), 280);
  }

  function pickResult(r) {
    setSymbol(r.symbol);
    resolvedName.current = r.name || r.symbol;
    setSearchRes([]);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    const s = parseFloat(shares), p = parseFloat(avgPrice);
    if (!symbol.trim())   { setError('Symbol is required'); return; }
    if (!s || s <= 0)     { setError('Shares must be > 0'); return; }
    if (!p || p <= 0)     { setError('Buy price must be > 0'); return; }
    const sl = stopLoss ? parseFloat(stopLoss) : null;
    if (sl && sl <= 0)    { setError('Stop loss must be > 0'); return; }
    const pd = purchDate ? Math.floor(new Date(purchDate).getTime() / 1000) : null;
    setSaving(true);
    try {
      await onSave({
        symbol:        symbol.trim().toUpperCase(),
        name:          resolvedName.current || symbol.trim().toUpperCase(),
        shares:        s,
        avg_price:     p,
        stop_loss:     sl,
        purchase_date: pd,
        notes:         notes.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const invested = shares && avgPrice ? parseFloat(shares) * parseFloat(avgPrice) : null;

  return (
    <div className="pf-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pf-modal">
        <div className="pf-modal__header">
          <div>
            <div className="pf-modal__title">{holding ? 'Edit Holding' : 'Add to Portfolio'}</div>
            {symbol && <div className="pf-modal__sym">{symbol.replace(/\.(NS|BO)$/i, '')}</div>}
          </div>
          <button className="pf-modal__close" onClick={onClose}>×</button>
        </div>

        <form className="pf-modal__form" onSubmit={handleSave}>
          {/* Symbol field with search — only for new holdings */}
          {!holding && (
            <div className="pf-modal__search-wrap">
              <label>
                <span>Stock Symbol</span>
                <input
                  type="text"
                  placeholder="Search by name or symbol…"
                  value={symbol}
                  onChange={e => handleSymbolChange(e.target.value)}
                  autoFocus
                  autoComplete="off"
                />
              </label>
              {(searching || searchRes.length > 0) && (
                <div className="pf-modal__results">
                  {searching && <div className="pf-modal__results-loading">Searching…</div>}
                  {searchRes.map(r => (
                    <button
                      key={r.symbol}
                      type="button"
                      className="pf-modal__result"
                      onClick={() => pickResult(r)}
                    >
                      <span className="pf-modal__result-sym">{r.symbol.replace(/\.(NS|BO)$/i, '')}</span>
                      <span className="pf-modal__result-name">{r.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="pf-modal__row">
            <label>
              <span>Shares</span>
              <input type="number" step="0.0001" min="0.0001" placeholder="e.g. 10"
                value={shares} onChange={e => setShares(e.target.value)} required={!holding} />
            </label>
            <label>
              <span>Avg Buy Price (₹)</span>
              <input type="number" step="0.01" min="0.01" placeholder="e.g. 1350.00"
                value={avgPrice} onChange={e => setAvgPrice(e.target.value)} required={!holding} />
            </label>
          </div>

          <div className="pf-modal__row">
            <label>
              <span>Stop Loss (₹) <em>optional</em></span>
              <input type="number" step="0.01" min="0.01" placeholder="e.g. 1200.00"
                value={stopLoss} onChange={e => setStopLoss(e.target.value)} />
            </label>
            <label>
              <span>Purchase Date <em>optional</em></span>
              <input type="date" max={new Date().toISOString().split('T')[0]}
                value={purchDate} onChange={e => setPurchDate(e.target.value)} />
            </label>
          </div>

          <label>
            <span>Notes <em>optional</em></span>
            <input type="text" placeholder="e.g. Long-term hold, SIP"
              value={notes} onChange={e => setNotes(e.target.value)} maxLength={200} />
          </label>

          {invested != null && invested > 0 && (
            <div className="pf-modal__preview">
              Total invested: <strong>₹{fmt(invested)}</strong>
              {stopLoss && parseFloat(stopLoss) > 0 && (
                <span className="down"> · Stop Loss: ₹{fmt(parseFloat(stopLoss))}</span>
              )}
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

// ── Holding Card ──────────────────────────────────────────────────────────────
function HoldingCard({ h, onEdit, onRemove, onHistory }) {
  const up  = h.pnl >= 0;
  const rec = REC_META[h.recommendation?.action] || REC_META.HOLD;

  const range52 = h.week52_high && h.week52_low && h.week52_high > h.week52_low
    ? ((h.current_price - h.week52_low) / (h.week52_high - h.week52_low)) * 100
    : null;

  return (
    <div className="pf-card">
      <div className="pf-card__top">
        <div className="pf-card__id">
          <div className="pf-card__symbol">{h.symbol.replace(/\.(NS|BO)$/i, '')}</div>
          <div className="pf-card__name">{h.name}</div>
        </div>
        <div className="pf-card__badges">
          <span className={`pf-rec pf-rec--${rec.cls}`}>{rec.label}</span>
          {h.stop_loss && (
            <span className="pf-sl-pill">SL ₹{fmt(h.stop_loss)}</span>
          )}
        </div>
        <div className="pf-card__btns">
          <button className="pf-icon-btn" onClick={() => onHistory(h.symbol)} title="Investment history">📈</button>
          <button className="pf-icon-btn pf-icon-btn--edit" onClick={() => onEdit(h)} title="Edit">✎</button>
          <button className="pf-icon-btn pf-icon-btn--del" onClick={() => onRemove(h.symbol)} title="Remove">×</button>
        </div>
      </div>

      <div className="pf-card__grid">
        <div className="pf-card__kv"><span>Shares</span><strong>{h.shares}</strong></div>
        <div className="pf-card__kv"><span>Avg Buy</span><strong>₹{fmt(h.avg_price)}</strong></div>
        <div className="pf-card__kv"><span>Current</span>
          <strong className={h.change_pct >= 0 ? 'up' : 'down'}>₹{fmt(h.current_price)}</strong>
        </div>
        <div className="pf-card__kv"><span>Invested</span><strong>₹{fmt(h.invested)}</strong></div>
        <div className="pf-card__kv"><span>Value</span><strong>₹{fmt(h.current_value)}</strong></div>
        <div className="pf-card__kv pf-card__kv--pnl">
          <span>P&amp;L</span>
          <strong className={up ? 'up' : 'down'}>
            {up ? '+' : ''}₹{fmt(h.pnl)}
            <em> ({up ? '+' : ''}{fmt(h.pnl_pct)}%)</em>
          </strong>
        </div>
        {h.today_pnl != null && (
          <div className="pf-card__kv">
            <span>Today</span>
            <strong className={h.today_pnl_pct >= 0 ? 'up' : 'down'}>
              {h.today_pnl_pct >= 0 ? '+' : ''}{fmt(h.today_pnl_pct)}%
              <em> ({h.today_pnl >= 0 ? '+' : ''}₹{fmt(h.today_pnl)})</em>
            </strong>
          </div>
        )}
        {h.pe_ratio != null && (
          <div className="pf-card__kv"><span>P/E</span><strong>{fmt(h.pe_ratio, 1)}</strong></div>
        )}
      </div>

      {range52 != null && (
        <div className="pf-card__range">
          <span>52W Low ₹{fmt(h.week52_low)}</span>
          <div className="pf-range-bar">
            <div className="pf-range-bar__fill" style={{ width: `${Math.min(100, Math.max(0, range52))}%` }} />
            <div className="pf-range-bar__dot" style={{ left: `${Math.min(100, Math.max(0, range52))}%` }} />
          </div>
          <span>₹{fmt(h.week52_high)} High</span>
        </div>
      )}

      {h.recommendation && (
        <div className="pf-card__advice">
          <div className="pf-card__advice-text">{h.recommendation.reason}</div>
          <div className="pf-card__advice-levels">
            <span>Target <strong className="up">₹{fmt(h.recommendation.target_price)}</strong></span>
            <span>Stop Loss <strong className="down">₹{fmt(h.stop_loss || h.recommendation.stop_loss)}</strong></span>
          </div>
        </div>
      )}

      {h.notes && <div className="pf-card__notes">📝 {h.notes}</div>}
    </div>
  );
}

// ── Main Portfolio component ──────────────────────────────────────────────────
export default function Portfolio() {
  const { state, dispatch } = useAppContext();
  const { portfolio, fetchPortfolio, addHolding, updateHolding, removeHolding } = usePortfolio();
  const [modal,   setModal]   = useState(null); // {symbol, name, holding?}
  const [history, setHistory] = useState(null); // symbol string for history modal
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!state.token) return;
    setLoading(true);
    fetchPortfolio().finally(() => setLoading(false));
  }, [state.token]);

  async function handleSave(data) {
    const existing = portfolio?.holdings?.find(h => h.symbol === data.symbol);
    if (existing) await updateHolding(data.symbol, data);
    else          await addHolding(data);
  }

  async function handleRemove(symbol) {
    if (!confirm(`Remove ${symbol.replace(/\.(NS|BO)$/i, '')} from portfolio?`)) return;
    await removeHolding(symbol);
  }

  if (!state.user) {
    return (
      <div className="pf-gate">
        <div className="pf-gate__icon">💼</div>
        <h2 className="pf-gate__title">Track Your Investments</h2>
        <p className="pf-gate__sub">Log in to add holdings and get personalised buy/sell recommendations with target prices.</p>
        <button className="pf-gate__cta" onClick={() => dispatch({ type: 'TOGGLE_AUTH_MODAL' })}>
          Sign in to get started
        </button>
      </div>
    );
  }

  if (loading && !portfolio) {
    return <div className="pf-loading"><span className="spinner" /><span>Loading portfolio…</span></div>;
  }

  const holdings  = portfolio?.holdings ?? [];
  const summary   = portfolio?.summary  ?? {};
  const totalUp   = (summary.total_pnl ?? 0) >= 0;

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
          onClick={() => setModal({ symbol: '', name: '' })}
        >+ Add Holding</button>
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
            <strong>{totalUp ? '+' : ''}₹{fmt(summary.total_pnl)}</strong>
          </div>
          <div className={`pf-summary__card pf-summary__card--pct ${totalUp ? 'up' : 'down'}`}>
            <span>Return</span>
            <strong>{totalUp ? '+' : ''}{fmt(summary.total_pnl_pct)}%</strong>
          </div>
          {summary.total_today_pnl != null && (
            <div className={`pf-summary__card pf-summary__card--today ${(summary.total_today_pnl ?? 0) >= 0 ? 'up' : 'down'}`}>
              <span>Today's P&amp;L</span>
              <strong>{(summary.total_today_pnl ?? 0) >= 0 ? '+' : ''}₹{fmt(summary.total_today_pnl)}</strong>
              <em className={(summary.total_today_pct ?? 0) >= 0 ? 'up' : 'down'}>
                {(summary.total_today_pct ?? 0) >= 0 ? '+' : ''}{fmt(summary.total_today_pct)}%
              </em>
            </div>
          )}
        </div>
      )}

      {holdings.length === 0 ? (
        <div className="pf-empty">
          <div className="pf-empty__icon">📊</div>
          <div className="pf-empty__title">No holdings yet</div>
          <div className="pf-empty__sub">
            Click "+ Add Holding" above to track your first stock. You can search for any NSE stock directly.
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
              onHistory={sym => setHistory(sym)}
            />
          ))}
        </div>
      )}

      {modal && (
        <HoldingModal
          symbol={modal.symbol}
          name={modal.name}
          holding={modal.holding}
          initialSymbol={modal.symbol}
          initialName={modal.name}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {history && <HoldingHistoryChart symbol={history} onClose={() => setHistory(null)} />}
    </div>
  );
}
