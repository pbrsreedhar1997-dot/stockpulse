import React, { useEffect, useState } from 'react';
import { useScreener } from '../../hooks/useScreener';
import { useScreenerAI } from '../../hooks/useScreenerAI';
import { useAppContext } from '../../contexts/AppContext';
import './Screener.scss';

function fmt(n, dec = 2) { if (n == null) return '—'; return typeof n === 'number' ? n.toFixed(dec) : n; }
function fmtCr(n) {
  if (!n) return '—';
  const cr = n / 1e7;
  if (cr >= 1e5) return `₹${(cr / 1e5).toFixed(1)}L Cr`;
  if (cr >= 1e3) return `₹${(cr / 1e3).toFixed(1)}K Cr`;
  return `₹${cr.toFixed(0)} Cr`;
}

// ─── Category config ────────────────────────────────────────────────────────
const CAT_META = {
  value:      { label: 'Value Buy',   color: '#10D98C', desc: 'Profitable & trading at a discount' },
  growth:     { label: 'Quality',     color: '#4B9EFF', desc: 'High ROE, strong margins'           },
  turnaround: { label: 'Turnaround',  color: '#E8A838', desc: 'Beaten-down, recovery potential'    },
};

// ─── Score bar ───────────────────────────────────────────────────────────────
function ScoreBar({ score }) {
  const pct = Math.min(100, Math.max(0, score ?? 0));
  const color = pct >= 70 ? '#10D98C' : pct >= 50 ? '#4B9EFF' : '#E8A838';
  return (
    <div className="sc-score-bar" title={`Score: ${pct}/100`}>
      <div className="sc-score-bar__track">
        <div className="sc-score-bar__fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="sc-score-bar__label">{pct}</span>
    </div>
  );
}

// ─── Streaming AI Insights panel ─────────────────────────────────────────────
function AIInsightsPanel({ stocks }) {
  const { text, status, cached, ageMin, generate } = useScreenerAI();

  // Auto-load on first mount if screener data is ready
  useEffect(() => {
    if (stocks.length > 0 && status === 'idle') generate();
  }, [stocks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function renderMarkdown(raw) {
    if (!raw) return null;
    return raw.split('\n').map((line, i) => {
      if (line.startsWith('## ')) return <h3 key={i} className="sc-ai__h3">{line.slice(3)}</h3>;
      const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
        p.startsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : p
      );
      return <p key={i} className="sc-ai__line">{parts}</p>;
    });
  }

  const cacheLabel = cached && ageMin != null
    ? `Cached · ${ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`}`
    : null;

  return (
    <div className="sc-ai">
      <div className="sc-ai__header">
        <div>
          <div className="sc-ai__title">AI Market Intelligence</div>
          <div className="sc-ai__sub">
            Live screener data → AI analysis · Value buys · Boom sectors · Turnarounds
            {cacheLabel && <span className="sc-ai__cache-badge">{cacheLabel}</span>}
          </div>
        </div>
        <button
          className={`sc-ai__btn ${status === 'loading' ? 'sc-ai__btn--loading' : ''}`}
          onClick={() => generate(true)}
          disabled={status === 'loading'}
          title="Force fresh analysis"
        >
          {status === 'loading' ? (
            <><span className="spinner" /> Analysing…</>
          ) : (
            '↻ Refresh'
          )}
        </button>
      </div>

      {status === 'idle' && (
        <div className="sc-ai__idle">
          <div className="sc-ai__idle-icon">✦</div>
          <div className="sc-ai__idle-title">Loading analysis…</div>
          <div className="sc-ai__idle-sub">
            {stocks.length === 0
              ? 'Waiting for screener data. The scan takes 2–4 minutes on first load.'
              : 'Fetching AI insights for the current screener picks.'}
          </div>
        </div>
      )}

      {status === 'loading' && !text && (
        <div className="sc-ai__thinking">
          <span className="sc-ai__dot" /><span className="sc-ai__dot" /><span className="sc-ai__dot" />
          <span className="sc-ai__think-label">
            {stocks.length > 0
              ? `Analysing ${stocks.length} stocks — value, growth, macro…`
              : 'Connecting to AI…'}
          </span>
        </div>
      )}

      {text && (
        <div className="sc-ai__body">
          {renderMarkdown(text)}
          {status === 'loading' && <span className="sc-ai__cursor" />}
        </div>
      )}

      {status === 'error' && !text && (
        <div className="sc-ai__error">
          Analysis failed. Check that the AI service is configured and try again.
          <button className="sc-ai__retry" onClick={() => generate(true)}>Retry</button>
        </div>
      )}
    </div>
  );
}

// ─── Sector skeleton loader ───────────────────────────────────────────────────
function SectorSkeleton() {
  return (
    <div className="sc-sector-grid">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="sc-sector-card" style={{ '--sector-accent': 'var(--border2)', cursor: 'default' }}>
          <div className="sc-sector-card__head" style={{ gap: 12 }}>
            <div className="sc-sector-card__head-left">
              <div className="sc-skel sc-skel--title" />
              <div className="sc-sector-card__meta" style={{ gap: 6, marginTop: 5 }}>
                <div className="sc-skel sc-skel--tag" />
                <div className="sc-skel sc-skel--tag" style={{ width: 56 }} />
              </div>
            </div>
            <div className="sc-skel sc-skel--num" />
          </div>
          <div className="sc-sector-card__stocks">
            {[0, 1, 2].map(j => (
              <div key={j} className="sc-sector-row" style={{ cursor: 'default' }}>
                <div className="sc-sector-row__left">
                  <div className="sc-skel sc-skel--sym" />
                  <div className="sc-skel sc-skel--name" />
                </div>
                <div className="sc-skel sc-skel--chg" />
              </div>
            ))}
          </div>
          <div className="sc-sector-card__more"><div className="sc-skel sc-skel--more" /></div>
        </div>
      ))}
    </div>
  );
}

// ─── Sector detail (drill-down) ──────────────────────────────────────────────
function SectorDetail({ sector, stocks, accentColor, onBack, onPick }) {
  const [search, setSearch] = useState('');
  const sorted = [...stocks].sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0));
  const displayed = search.trim()
    ? sorted.filter(s =>
        s.symbol.toLowerCase().includes(search.toLowerCase()) ||
        (s.name || '').toLowerCase().includes(search.toLowerCase())
      )
    : sorted;
  const avgChg = stocks
    .filter(s => s.change_pct != null)
    .reduce((a, s, _, arr) => a + s.change_pct / arr.length, 0);
  const sectorUp = avgChg >= 0;

  return (
    <div className="sc-sector-detail">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="sc-sector-detail__header" style={{ '--sector-accent': accentColor }}>
        <button className="sc-sector-detail__back" onClick={onBack}>
          ← Sectors
        </button>
        <div className="sc-sector-detail__info">
          <span className="sc-sector-detail__name">{sector}</span>
          <span className="sc-sector-detail__count">{stocks.length} stocks</span>
        </div>
        <span className={`sc-sector-detail__avg ${sectorUp ? 'up' : 'down'}`}>
          {sectorUp ? '+' : ''}{avgChg.toFixed(2)}% avg
        </span>
        <input
          className="sc-sector-detail__search"
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* ── Stock list ─────────────────────────────────────────────────────── */}
      <div className="sc-sector-detail__list">
        {displayed.length === 0 ? (
          <div className="sc-sector-detail__empty">No stocks match "{search}"</div>
        ) : displayed.map((s, i) => {
          const up = (s.change_pct ?? 0) >= 0;
          const cat = CAT_META[s.category];
          const score = Math.min(100, Math.max(0, s.composite_score || 0));
          return (
            <div key={s.symbol} className="sc-sector-detail__row" onClick={() => onPick(s)}>
              <span className="sc-sector-detail__rank">#{i + 1}</span>

              <div className="sc-sector-detail__left">
                <span className="sc-sector-detail__sym">
                  {s.symbol.replace(/\.(NS|BO)$/i, '')}
                </span>
                <span className="sc-sector-detail__company">{s.name}</span>
              </div>

              <div className="sc-sector-detail__score">
                <div className="sc-sector-detail__score-track">
                  <div
                    className="sc-sector-detail__score-fill"
                    style={{ width: `${score}%`, background: cat?.color || '#4B9EFF' }}
                  />
                </div>
                <span className="sc-sector-detail__score-val">{score}</span>
              </div>

              {cat && (
                <span
                  className="sc-sector-detail__cat"
                  style={{ background: cat.color + '1A', color: cat.color, borderColor: cat.color + '40' }}
                >
                  {cat.label}
                </span>
              )}

              <span className="sc-sector-detail__price">₹{fmt(s.price)}</span>
              <span className={`sc-sector-detail__chg ${up ? 'up' : 'down'}`}>
                {up ? '+' : ''}{fmt(s.change_pct)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sector insight cards ─────────────────────────────────────────────────────
function SectorGrid({ stocks, onPick }) {
  const [activeSector, setActiveSector] = useState(null);
  const [accentColor,  setAccentColor]  = useState('#4B9EFF');

  const grouped = {};
  for (const s of stocks) {
    const key = s.sector || s.theme || 'Other';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(s);
  }

  const sectorList = Object.entries(grouped)
    .sort((a, b) => b[1].length - a[1].length);

  // Drill into a sector
  const openSector = (sector, color) => {
    setActiveSector(sector);
    setAccentColor(color);
  };

  if (activeSector) {
    return (
      <SectorDetail
        sector={activeSector}
        stocks={grouped[activeSector] || []}
        accentColor={accentColor}
        onBack={() => setActiveSector(null)}
        onPick={(stock) => onPick(stock, activeSector)}
      />
    );
  }

  return (
    <div className="sc-sector-grid">
      {sectorList.map(([sector, sectorStocks]) => {
        const top = [...sectorStocks].sort((a, b) => b.composite_score - a.composite_score).slice(0, 3);
        const avgChg = sectorStocks
          .filter(s => s.change_pct != null)
          .reduce((a, s, _, arr) => a + s.change_pct / arr.length, 0);
        const sectorUp = avgChg >= 0;
        const catCounts = sectorStocks.reduce((acc, s) => {
          acc[s.category] = (acc[s.category] || 0) + 1;
          return acc;
        }, {});
        const dominantCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
        const color = CAT_META[dominantCat]?.color || (sectorUp ? '#10D98C' : '#FF4560');

        return (
          <div
            key={sector}
            className="sc-sector-card"
            style={{ '--sector-accent': color }}
            onClick={() => openSector(sector, color)}
          >
            <div className="sc-sector-card__head">
              <div className="sc-sector-card__head-left">
                <div className="sc-sector-card__name">{sector}</div>
                <div className="sc-sector-card__meta">
                  <span className="sc-sector-card__count">{sectorStocks.length} stocks</span>
                  {dominantCat && (
                    <span
                      className="sc-sector-card__cat-pill"
                      style={{
                        background: CAT_META[dominantCat].color + '1A',
                        color: CAT_META[dominantCat].color,
                        borderColor: CAT_META[dominantCat].color + '40',
                      }}
                    >
                      {CAT_META[dominantCat].label}
                    </span>
                  )}
                </div>
              </div>
              <div className={`sc-sector-card__chg-block ${sectorUp ? 'up' : 'down'}`}>
                <span className="sc-sector-card__chg">
                  {sectorUp ? '+' : ''}{avgChg.toFixed(2)}%
                </span>
                <span className="sc-sector-card__chg-label">avg today</span>
              </div>
            </div>

            {/* Top 3 preview — non-interactive, clicking card drills in */}
            <div className="sc-sector-card__stocks">
              {top.map(s => {
                const up = (s.change_pct ?? 0) >= 0;
                const cat = CAT_META[s.category];
                const score = Math.min(100, Math.max(0, s.composite_score || 0));
                return (
                  <div key={s.symbol} className="sc-sector-row">
                    <div className="sc-sector-row__left">
                      <span className="sc-sector-row__sym">
                        {s.symbol.replace(/\.(NS|BO)$/i, '')}
                      </span>
                      <span className="sc-sector-row__name">{s.name}</span>
                    </div>
                    <div className="sc-sector-row__right">
                      <div className="sc-sector-row__score-mini" title={`Score: ${score}`}>
                        <div
                          className="sc-sector-row__score-fill"
                          style={{ width: `${score}%`, background: cat?.color || '#4B9EFF' }}
                        />
                      </div>
                      <span className={`sc-sector-row__chg ${up ? 'up' : 'down'}`}>
                        {up ? '+' : ''}{fmt(s.change_pct)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="sc-sector-card__more">
              View all {sectorStocks.length} stocks →
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── All Picks table ──────────────────────────────────────────────────────────
const SORT_OPTS = [
  { label: 'Score',        value: 'composite_score' },
  { label: '52W Below',    value: 'decline_pct'     },
  { label: 'P/E Ratio',    value: 'pe_ratio'        },
  { label: 'Market Cap',   value: 'mkt_cap_cr'      },
  { label: 'Today %',      value: 'change_pct'      },
];

function AllPicksTable({ stocks, onPick }) {
  const [sector,   setSector]   = useState('All');
  const [category, setCategory] = useState('All');
  const [sortBy,   setSortBy]   = useState('composite_score');
  const [sortDir,  setSortDir]  = useState('desc');

  const sectors = ['All', ...new Set(stocks.map(s => s.sector).filter(Boolean))].sort();

  const filtered = stocks
    .filter(s => sector   === 'All' || s.sector   === sector)
    .filter(s => category === 'All' || s.category === category)
    .sort((a, b) => {
      const av = a[sortBy] ?? (sortDir === 'desc' ? -Infinity : Infinity);
      const bv = b[sortBy] ?? (sortDir === 'desc' ? -Infinity : Infinity);
      return sortDir === 'desc' ? bv - av : av - bv;
    });

  const toggleSort = (field) => {
    if (sortBy === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(field); setSortDir(field === 'pe_ratio' ? 'asc' : 'desc'); }
  };

  return (
    <>
      <div className="screener__toolbar">
        {/* Category filter */}
        <div className="screener__filters">
          <span className="screener__filter-label">Type:</span>
          {['All', 'value', 'growth', 'turnaround'].map(c => (
            <button
              key={c}
              className={`sc-chip ${category === c ? 'sc-chip--active' : ''} ${c !== 'All' ? `sc-chip--cat sc-chip--${c}` : ''}`}
              onClick={() => setCategory(c)}
            >
              {c === 'All' ? 'All Types' : CAT_META[c]?.label}
            </button>
          ))}
        </div>

        {/* Sector filter */}
        <div className="screener__sectors">
          <span className="screener__filter-label">Sector:</span>
          {sectors.map(s => (
            <button
              key={s}
              className={`sc-chip ${sector === s ? 'sc-chip--active' : ''}`}
              onClick={() => setSector(s)}
            >{s}</button>
          ))}
        </div>

        {/* Sort */}
        <div className="screener__sort">
          <span className="screener__filter-label">Sort:</span>
          {SORT_OPTS.map(o => (
            <button
              key={o.value}
              className={`sc-chip ${sortBy === o.value ? 'sc-chip--active' : ''}`}
              onClick={() => toggleSort(o.value)}
            >
              {o.label}
              {sortBy === o.value && <span className="sc-sort-arrow">{sortDir === 'desc' ? ' ↓' : ' ↑'}</span>}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="screener__empty">No stocks match the current filters.</div>
      ) : (
        <div className="sc-table-wrap">
          <table className="sc-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Company</th>
                <th className="sc-th--num">Score</th>
                <th className="sc-th--num">Price</th>
                <th className="sc-th--num">Today</th>
                <th className="sc-th--num">Discount</th>
                <th className="sc-th--num">P/E</th>
                <th className="sc-th--num">Mkt Cap</th>
                <th>Type</th>
                <th>Theme</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(stock => {
                const todayUp = (stock.change_pct ?? 0) >= 0;
                const peColor = stock.pe_ratio < 15 ? 'up' : stock.pe_ratio > 50 ? 'down' : '';
                const cat     = CAT_META[stock.category];

                return (
                  <tr key={stock.symbol} className="sc-row" onClick={() => onPick(stock)}>
                    <td className="sc-td--symbol">
                      {stock.symbol.replace(/\.(NS|BO)$/i, '')}
                    </td>
                    <td className="sc-td--name">{stock.name}</td>
                    <td className="sc-td--num">
                      <ScoreBar score={stock.composite_score} />
                    </td>
                    <td className="sc-td--num">₹{fmt(stock.price)}</td>
                    <td className="sc-td--num">
                      {stock.change_pct != null ? (
                        <span className={`sc-chg ${todayUp ? 'sc-chg--up' : 'sc-chg--down'}`}>
                          {todayUp ? '+' : ''}{fmt(stock.change_pct)}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="sc-td--num">
                      <span className="sc-below">-{fmt(stock.decline_pct)}%</span>
                    </td>
                    <td className={`sc-td--num ${peColor}`}>
                      {stock.pe_ratio ? `${fmt(stock.pe_ratio)}x` : '—'}
                    </td>
                    <td className="sc-td--num sc-dim">
                      {stock.mkt_cap_cr ? fmtCr(stock.mkt_cap_cr * 1e7) : '—'}
                    </td>
                    <td>
                      {cat && (
                        <span
                          className="sc-cat-badge"
                          style={{ background: cat.color + '20', color: cat.color, borderColor: cat.color + '40' }}
                        >
                          {cat.label}
                        </span>
                      )}
                    </td>
                    <td className="sc-td--theme">
                      {stock.theme ? <span className="sc-theme-tag">{stock.theme}</span> : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ─── Scan progress bar ───────────────────────────────────────────────────────
function ScanProgress({ scanStatus, stockCount }) {
  if (!scanStatus) return null;
  const { done, total, found } = scanStatus;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="sc-scan-bar">
      <div className="sc-scan-bar__track">
        <div className="sc-scan-bar__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="sc-scan-bar__label">
        Scanning {done}/{total} stocks · {found ?? stockCount} found · {pct}%
      </span>
    </div>
  );
}

// ─── Main Screener ────────────────────────────────────────────────────────────
const MODES = [
  { v: 'all',    label: 'All Picks'       },
  { v: 'sector', label: 'Sector Insights' },
  { v: 'ai',     label: '✦ AI Analysis'   },
];

export default function Screener() {
  const { stocks, loading, scanning, scanStatus, error, load, refresh } = useScreener();
  const { dispatch } = useAppContext();
  const [mode, setMode] = useState('all');

  useEffect(() => { load(); }, []);

  const pickStock = (stock, sector = null) => {
    const navBack = sector
      ? { view: 'screener', label: 'Sector Insights', sector }
      : { view: 'screener', label: 'Value Picks' };
    dispatch({ type: 'SET_NAV_BACK', payload: navBack });
    dispatch({ type: 'SET_CURRENT_SYMBOL', payload: stock.symbol });
    dispatch({ type: 'SET_VIEW', payload: 'stock' });
  };

  const valueCnt      = stocks.filter(s => s.category === 'value').length;
  const growthCnt     = stocks.filter(s => s.category === 'growth').length;
  const turnaroundCnt = stocks.filter(s => s.category === 'turnaround').length;

  return (
    <div className="screener">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="screener__header">
        <div className="screener__header-left">
          <h2 className="screener__title">Value Picks</h2>
          <p className="screener__sub">
            {loading && stocks.length === 0
              ? 'Scanning 180+ stocks across all sectors…'
              : stocks.length > 0
                ? `${stocks.length} stocks · ${valueCnt} value · ${growthCnt} quality · ${turnaroundCnt} turnaround${scanning ? ' · updating…' : ''}`
                : 'AI-powered stock screener — India large & mid-cap universe'}
          </p>
        </div>
        <div className="screener__header-right">
          {scanning && (
            <span className="sc-live-badge">
              <span className="sc-live-badge__dot" /> Scanning
            </span>
          )}
          <button className="screener__refresh" onClick={refresh} disabled={loading && stocks.length === 0}>
            {loading && stocks.length === 0 ? <span className="spinner" /> : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* ── Scan progress ──────────────────────────────────────────────────── */}
      {scanning && <ScanProgress scanStatus={scanStatus} stockCount={stocks.length} />}

      {/* ── Mode tabs ──────────────────────────────────────────────────────── */}
      <div className="screener__mode-tabs">
        {MODES.map(m => (
          <button
            key={m.v}
            className={`sc-mode-tab ${mode === m.v ? 'sc-mode-tab--active' : ''} ${m.v === 'ai' ? 'sc-mode-tab--ai' : ''}`}
            onClick={() => setMode(m.v)}
          >
            {m.label}
          </button>
        ))}

        {/* Summary pills */}
        {stocks.length > 0 && (
          <div className="screener__pills">
            {Object.entries(CAT_META).map(([k, v]) => {
              const cnt = stocks.filter(s => s.category === k).length;
              return cnt > 0 ? (
                <span key={k} className="sc-summary-pill" style={{ color: v.color, borderColor: v.color + '40', background: v.color + '12' }}>
                  {cnt} {v.label}
                </span>
              ) : null;
            })}
          </div>
        )}
      </div>

      {error && <div className="screener__error">{error}</div>}

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      {mode === 'all' && (
        loading && stocks.length === 0
          ? <div className="screener__loading">
              <span className="spinner" />
              <p>Scanning 180+ stocks — fetching live prices, fundamentals &amp; sector data…</p>
              <p className="screener__loading-sub">Results appear progressively as each stock is scanned.</p>
            </div>
          : <AllPicksTable stocks={stocks} onPick={(s) => pickStock(s, null)} />
      )}

      {mode === 'sector' && (
        stocks.length === 0
          ? loading
              ? <SectorSkeleton />
              : <div className="screener__empty">
                  <span className="screener__empty-icon">⊙</span>
                  <p>No sector data yet.</p>
                  <p className="screener__loading-sub">Click Refresh to start scanning stocks.</p>
                </div>
          : <SectorGrid stocks={stocks} onPick={pickStock} />
      )}

      {mode === 'ai' && (
        <AIInsightsPanel stocks={stocks} />
      )}
    </div>
  );
}
