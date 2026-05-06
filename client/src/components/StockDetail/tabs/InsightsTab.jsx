import React, { useState, useEffect } from 'react';
import { useAppContext } from '../../../contexts/AppContext';
import './tabs.scss';

function parseMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/^\- (.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br/>');
}

export default function InsightsTab({ symbol }) {
  const { state } = useAppContext();
  const [insights, setInsights] = useState('');
  const [loading, setLoading] = useState(false);

  const q = state.quotes[symbol];
  const f = state.financials[symbol];
  const p = state.profiles[symbol];

  useEffect(() => {
    if (q && f) generateInsights();
  }, [symbol, q?.price, f?.pe_ratio]);

  function generateInsights() {
    if (!q || !f) return;
    setLoading(true);

    const lines = [];
    lines.push(`## ${p?.name || symbol} — Quick Analysis\n`);

    // Price vs 52W
    if (f.week52_high && f.week52_low) {
      const fromHigh = ((q.price - f.week52_high) / f.week52_high * 100).toFixed(1);
      const fromLow = ((q.price - f.week52_low) / f.week52_low * 100).toFixed(1);
      const momentum = parseFloat(fromHigh) > -10 ? '**Near 52W High** — strong momentum' : parseFloat(fromHigh) < -30 ? '**Well below 52W High** — potential value opportunity' : 'Trading in mid-range';
      lines.push(`### Price Position\n${momentum}. Currently **${fromHigh}%** from 52W high and **+${fromLow}%** from 52W low.\n`);
    }

    // Valuation
    if (f.pe_ratio) {
      const peComment = f.pe_ratio < 15 ? 'attractively valued (P/E < 15)' : f.pe_ratio < 25 ? 'fairly valued (P/E 15–25)' : f.pe_ratio < 40 ? 'moderately premium (P/E 25–40)' : 'highly premium (P/E > 40)';
      lines.push(`### Valuation\nThe stock appears **${peComment}** with a P/E ratio of **${f.pe_ratio.toFixed(1)}x**. EPS stands at ₹${f.eps?.toFixed(2) || '—'}.\n`);
    }

    // Margins
    if (f.gross_margin) {
      const marginComment = f.gross_margin > 40 ? 'strong pricing power' : f.gross_margin > 20 ? 'moderate margins' : 'thin margins — watch for cost pressures';
      lines.push(`### Profitability\nGross margin of **${f.gross_margin.toFixed(1)}%** indicates **${marginComment}**.\n`);
    }

    // Beta / Risk
    if (f.beta) {
      const riskComment = f.beta < 0.8 ? 'low-volatility (defensive)' : f.beta > 1.3 ? 'high-volatility (aggressive)' : 'market-correlated';
      lines.push(`### Risk Profile\nBeta of **${f.beta.toFixed(2)}** — stock is **${riskComment}**.\n`);
    }

    // Dividend
    if (f.dividend_yield) {
      lines.push(`### Income\nDividend yield of **${f.dividend_yield.toFixed(2)}%** provides income support.\n`);
    }

    if (p?.sector) {
      lines.push(`### Sector\nOperates in the **${p.sector}** sector${p.industry ? `, specifically ${p.industry}` : ''}.\n`);
    }

    lines.push('\n*This is an automated summary. Not financial advice.*');
    setInsights(lines.join('\n'));
    setLoading(false);
  }

  if (!q || !f) {
    return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>Load stock data to see insights.</div>;
  }

  return (
    <div className="tab-panel">
      <div className="insights-block">
        <div className="insights-block__title">AI Analysis</div>
        {loading ? (
          <span className="spinner" />
        ) : (
          <div dangerouslySetInnerHTML={{ __html: parseMarkdown(insights) }} />
        )}
      </div>
    </div>
  );
}
