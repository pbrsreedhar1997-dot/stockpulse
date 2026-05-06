import React, { useState, useEffect } from 'react';
import { useStocks } from '../../hooks/useStocks';
import StockHeader from './StockHeader';
import OverviewTab from './tabs/OverviewTab';
import NewsTab from './tabs/NewsTab';
import FinancialsTab from './tabs/FinancialsTab';
import CompanyTab from './tabs/CompanyTab';
import InsightsTab from './tabs/InsightsTab';
import PerformanceTab from './tabs/PerformanceTab';
import './StockDetail.scss';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'news', label: 'News' },
  { id: 'financials', label: 'Financials' },
  { id: 'company', label: 'Company' },
  { id: 'insights', label: 'Insights' },
  { id: 'performance', label: 'Performance' },
];

export default function StockDetail({ symbol }) {
  const [activeTab, setActiveTab] = useState('overview');
  const { fetchQuote, fetchProfile, fetchFinancials } = useStocks();

  useEffect(() => {
    fetchQuote(symbol);
    fetchProfile(symbol);
    fetchFinancials(symbol);
    setActiveTab('overview');
  }, [symbol]);

  return (
    <div className="stock-detail">
      <StockHeader symbol={symbol} />

      <div className="tab-bar">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-bar__tab ${activeTab === t.id ? 'tab-bar__tab--active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {activeTab === 'overview' && <OverviewTab symbol={symbol} />}
        {activeTab === 'news' && <NewsTab symbol={symbol} />}
        {activeTab === 'financials' && <FinancialsTab symbol={symbol} />}
        {activeTab === 'company' && <CompanyTab symbol={symbol} />}
        {activeTab === 'insights' && <InsightsTab symbol={symbol} />}
        {activeTab === 'performance' && <PerformanceTab symbol={symbol} />}
      </div>
    </div>
  );
}
