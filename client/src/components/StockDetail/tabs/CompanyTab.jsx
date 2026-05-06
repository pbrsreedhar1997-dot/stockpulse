import React from 'react';
import { useAppContext } from '../../../contexts/AppContext';
import './tabs.scss';

export default function CompanyTab({ symbol }) {
  const { state } = useAppContext();
  const p = state.profiles[symbol];

  if (!p) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>Loading profile...</div>;

  return (
    <div className="tab-panel">
      <div className="company-block">
        <h3 className="company-block__title">About</h3>
        <p className="company-block__desc">{p.description || 'No description available.'}</p>
      </div>

      <div className="card-grid">
        <div className="info-card">
          <h3 className="info-card__title">Details</h3>
          <div className="info-card__rows">
            <div className="kv"><span>Sector</span><strong>{p.sector || '—'}</strong></div>
            <div className="kv"><span>Industry</span><strong>{p.industry || '—'}</strong></div>
            <div className="kv"><span>Exchange</span><strong>{p.exchange || '—'}</strong></div>
            <div className="kv"><span>Country</span><strong>{p.country || '—'}</strong></div>
            <div className="kv"><span>Currency</span><strong>{p.currency || '—'}</strong></div>
            <div className="kv">
              <span>Employees</span>
              <strong>{p.employees ? p.employees.toLocaleString() : '—'}</strong>
            </div>
          </div>
        </div>

        <div className="info-card">
          <h3 className="info-card__title">Links</h3>
          <div className="info-card__rows">
            {p.website && (
              <div className="kv">
                <span>Website</span>
                <a href={p.website} target="_blank" rel="noopener noreferrer">
                  {p.website.replace(/^https?:\/\//, '')}
                </a>
              </div>
            )}
            <div className="kv">
              <span>NSE</span>
              <a href={`https://www.nseindia.com/get-quotes/equity?symbol=${symbol.replace('.NS', '')}`} target="_blank" rel="noopener noreferrer">
                NSEIndia
              </a>
            </div>
            <div className="kv">
              <span>Screener</span>
              <a href={`https://www.screener.in/company/${symbol.replace('.NS', '').replace('.BO', '')}/`} target="_blank" rel="noopener noreferrer">
                Screener.in
              </a>
            </div>
            <div className="kv">
              <span>Moneycontrol</span>
              <a href={`https://www.moneycontrol.com/india/stockpricequote/${symbol.replace('.NS', '')}`} target="_blank" rel="noopener noreferrer">
                Moneycontrol
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
