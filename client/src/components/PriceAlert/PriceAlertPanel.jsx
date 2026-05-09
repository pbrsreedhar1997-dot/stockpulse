import React, { useState, useEffect } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { usePriceAlert } from '../../hooks/usePriceAlert';
import { playSaveTone, playDismissTone } from '../../utils/audio';
import { fmtPrice } from '../../utils/currency';
import './PriceAlertPanel.scss';

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function PriceAlertPanel({ symbol, name, currentPrice, currency, onClose }) {
  const { state, dispatch } = useAppContext();
  const { requestPermission } = usePriceAlert();

  const [type, setType] = useState('above');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [permDenied, setPermDenied] = useState(false);

  const sym = symbol?.replace(/\.(NS|BO)$/i, '');
  const symbolAlerts = state.alerts.filter(a => a.symbol === symbol);
  // Helper: resolve currency for any alert symbol (fall back to suffix detection)
  const alertCurrency = (sym) =>
    state.quotes[sym]?.currency || (sym?.match(/\.(NS|BO)$/i) ? 'INR' : 'USD');

  // Pre-fill sensible defaults based on direction
  useEffect(() => {
    if (!currentPrice) return;
    const delta = type === 'above' ? 1.05 : 0.95;
    setPrice((currentPrice * delta).toFixed(2));
  }, [type, currentPrice]);

  async function handleSave(e) {
    e.preventDefault();
    const p = parseFloat(price);
    if (!p || p <= 0) { setError('Enter a valid price'); return; }
    if (type === 'above' && p <= currentPrice) { setError(`Must be above current ${fmtPrice(currentPrice, currency)}`); return; }
    if (type === 'below' && p >= currentPrice) { setError(`Must be below current ${fmtPrice(currentPrice, currency)}`); return; }

    const granted = await requestPermission();
    if (!granted) setPermDenied(true);

    const id = `pa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    dispatch({
      type: 'ADD_ALERT',
      payload: { id, symbol, name, type, targetPrice: p, note: note.trim(), triggered: false, createdAt: Date.now() },
    });
    playSaveTone();
    setPrice('');
    setNote('');
    setError('');
  }

  function removeAlert(id) {
    playDismissTone();
    dispatch({ type: 'REMOVE_ALERT', payload: id });
  }

  function resetAlert(id) {
    dispatch({ type: 'RESET_ALERT', payload: id });
  }

  return (
    <div className="ap-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ap-panel">
        {/* Header */}
        <div className="ap-panel__hdr">
          <div>
            <div className="ap-panel__title">🔔 Price Alerts</div>
            <div className="ap-panel__sym">{sym} · {fmtPrice(currentPrice, currency)}</div>
          </div>
          <button className="ap-panel__close" onClick={onClose}>×</button>
        </div>

        {/* Permission warning */}
        {permDenied && (
          <div className="ap-warn">
            ⚠ Notifications blocked — enable them in browser settings to receive alerts
          </div>
        )}

        {/* Create alert form */}
        <form className="ap-form" onSubmit={handleSave}>
          <div className="ap-form__label">Alert when price is</div>
          <div className="ap-type-toggle">
            <button
              type="button"
              className={`ap-type-btn ${type === 'above' ? 'ap-type-btn--active ap-type-btn--up' : ''}`}
              onClick={() => setType('above')}
            >
              <span>▲</span> Above
            </button>
            <button
              type="button"
              className={`ap-type-btn ${type === 'below' ? 'ap-type-btn--active ap-type-btn--down' : ''}`}
              onClick={() => setType('below')}
            >
              <span>▼</span> Below
            </button>
          </div>

          <div className="ap-price-row">
            <span className="ap-price-row__cur">
              {type === 'above' ? '≥' : '≤'}
            </span>
            <input
              className="ap-price-row__input"
              type="number"
              step="0.01"
              min="0.01"
              value={price}
              onChange={e => { setPrice(e.target.value); setError(''); }}
              placeholder="Target price"
              required
              autoFocus
            />
          </div>

          {currentPrice && price && !isNaN(parseFloat(price)) && (
            <div className={`ap-delta ${type === 'above' ? 'ap-delta--up' : 'ap-delta--down'}`}>
              {type === 'above' ? '▲' : '▼'}&nbsp;
              {Math.abs(((parseFloat(price) - currentPrice) / currentPrice) * 100).toFixed(2)}% from current
            </div>
          )}

          <input
            className="ap-note-input"
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Note (optional)"
            maxLength={60}
          />

          {error && <div className="ap-error">{error}</div>}

          <button type="submit" className={`ap-save-btn ${type === 'above' ? 'ap-save-btn--up' : 'ap-save-btn--down'}`}>
            Set Alert
          </button>
        </form>

        {/* Existing alerts for this stock */}
        {symbolAlerts.length > 0 && (
          <div className="ap-list">
            <div className="ap-list__header">Active alerts ({symbolAlerts.length})</div>
            {symbolAlerts.map(a => (
              <div key={a.id} className={`ap-alert-row ${a.triggered ? 'ap-alert-row--triggered' : ''}`}>
                <div className="ap-alert-row__left">
                  <span className={`ap-alert-row__badge ${a.type === 'above' ? 'badge--up' : 'badge--down'}`}>
                    {a.type === 'above' ? '▲' : '▼'} {fmtPrice(a.targetPrice, alertCurrency(a.symbol))}
                  </span>
                  {a.note && <span className="ap-alert-row__note">{a.note}</span>}
                  <span className="ap-alert-row__time">{timeAgo(a.createdAt)}</span>
                </div>
                <div className="ap-alert-row__right">
                  {a.triggered && (
                    <span className="ap-alert-row__triggered">
                      Triggered
                      <button className="ap-alert-row__reset" onClick={() => resetAlert(a.id)} title="Re-arm alert">↺</button>
                    </span>
                  )}
                  <button className="ap-alert-row__rm" onClick={() => removeAlert(a.id)} title="Remove">×</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* All other alerts summary */}
        {state.alerts.filter(a => a.symbol !== symbol).length > 0 && (
          <div className="ap-other">
            <div className="ap-other__title">Other alerts ({state.alerts.filter(a => a.symbol !== symbol).length})</div>
            {state.alerts.filter(a => a.symbol !== symbol).map(a => (
              <div key={a.id} className="ap-other__row">
                <span className="ap-other__sym">{a.symbol.replace(/\.(NS|BO)$/i, '')}</span>
                <span className={`ap-other__dir ${a.type === 'above' ? 'up' : 'down'}`}>
                  {a.type === 'above' ? '▲' : '▼'} {fmtPrice(a.targetPrice, alertCurrency(a.symbol))}
                </span>
                {a.triggered && <span className="ap-other__hit">✓</span>}
                <button className="ap-alert-row__rm" onClick={() => removeAlert(a.id)}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
