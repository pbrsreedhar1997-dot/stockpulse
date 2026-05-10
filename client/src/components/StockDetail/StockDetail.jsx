import React, { useState, useEffect } from 'react';
import { useStocks } from '../../hooks/useStocks';
import { useAppContext } from '../../contexts/AppContext';
import StockHeader from './StockHeader';
import OverviewTab from './tabs/OverviewTab';
import NewsTab from './tabs/NewsTab';
import FinancialsTab from './tabs/FinancialsTab';
import CompanyTab from './tabs/CompanyTab';
import InsightsTab from './tabs/InsightsTab';
import PerformanceTab from './tabs/PerformanceTab';
import './StockDetail.scss';

const TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'news',        label: 'News' },
  { id: 'financials',  label: 'Financials' },
  { id: 'company',     label: 'Company' },
  { id: 'insights',    label: 'Insights' },
  { id: 'performance', label: 'Performance' },
];

const TAB_KEY = sym => `sp_tab_${sym}`;

export default function StockDetail({ symbol }) {
  const [activeTab, setActiveTab] = useState(
    () => sessionStorage.getItem(TAB_KEY(symbol)) || 'overview'
  );
  const { fetchQuote, fetchProfile, fetchFinancials } = useStocks();
  const { state, dispatch } = useAppContext();

  // When symbol changes, restore saved tab (default to overview for new symbols)
  useEffect(() => {
    fetchQuote(symbol);
    fetchProfile(symbol);
    fetchFinancials(symbol);
    const saved = sessionStorage.getItem(TAB_KEY(symbol));
    setActiveTab(saved || 'overview');
  }, [symbol]);

  // Re-fetch missing data whenever backend comes online (handles Render cold-start)
  useEffect(() => {
    if (state.backendOk !== true) return;
    if (!state.quotes[symbol])     fetchQuote(symbol);
    if (!state.profiles[symbol])   fetchProfile(symbol);
    if (!state.financials[symbol]) fetchFinancials(symbol);
  }, [state.backendOk, symbol]);

  const navBack = state.navBack;

  return (
    <div className="stock-detail">
      {/* ── Back breadcrumb (set when navigating from Value Picks / Sector Insights) */}
      {navBack?.view === 'screener' && (
        <div className="sd-breadcrumb">
          <button
            className="sd-breadcrumb__btn"
            onClick={() => dispatch({ type: 'SET_VIEW', payload: 'screener' })}
          >
            ←
            {navBack.sector
              ? <><span className="sd-breadcrumb__section"> Value Picks</span>
                  <span className="sd-breadcrumb__sep"> / </span>
                  <span className="sd-breadcrumb__section">Sector Insights</span>
                  <span className="sd-breadcrumb__sep"> / </span>
                  <span className="sd-breadcrumb__leaf">{navBack.sector}</span></>
              : <span className="sd-breadcrumb__section"> Value Picks</span>
            }
          </button>
        </div>
      )}

      <StockHeader symbol={symbol} />

      <div className="tab-bar">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-bar__tab ${activeTab === t.id ? 'tab-bar__tab--active' : ''}`}
            onClick={() => {
              setActiveTab(t.id);
              sessionStorage.setItem(TAB_KEY(symbol), t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {activeTab === 'overview'    && <OverviewTab    symbol={symbol} />}
        {activeTab === 'news'        && <NewsTab        symbol={symbol} />}
        {activeTab === 'financials'  && <FinancialsTab  symbol={symbol} />}
        {activeTab === 'company'     && <CompanyTab     symbol={symbol} />}
        {activeTab === 'insights'    && <InsightsTab    symbol={symbol} />}
        {activeTab === 'performance' && <PerformanceTab symbol={symbol} />}
      </div>
    </div>
  );
}
