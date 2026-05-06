import React, { useState, useEffect } from 'react';
import { useStocks } from '../../../hooks/useStocks';
import './tabs.scss';

const CATEGORIES = ['all', 'results', 'contract', 'acquisition', 'partnership', 'general'];

function timeAgo(dt) {
  const diff = Date.now() - new Date(dt).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NewsTab({ symbol }) {
  const { fetchNews } = useStocks();
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState('all');

  useEffect(() => {
    setLoading(true);
    fetchNews(symbol)
      .then(d => setNews(d?.news || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [symbol]);

  const filtered = category === 'all' ? news : news.filter(n => n.category === category);

  const sentimentColor = (r) => r === 'high' ? 'badge--up' : 'badge--neutral';

  return (
    <div className="tab-panel">
      <div className="news-filters">
        {CATEGORIES.map(c => (
          <button
            key={c}
            className={`filter-btn ${category === c ? 'filter-btn--active' : ''}`}
            onClick={() => setCategory(c)}
          >
            {c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 12 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>No news available</div>
      ) : (
        <div className="news-list">
          {filtered.map((item, i) => (
            <a key={i} className="news-item" href={item.url} target="_blank" rel="noopener noreferrer">
              <div className="news-item__header">
                <div className="news-item__title">{item.title}</div>
                <div className="news-item__badges">
                  {item.relevance && (
                    <span className={`badge ${sentimentColor(item.relevance)}`}>
                      {item.relevance}
                    </span>
                  )}
                  {item.category && item.category !== 'general' && (
                    <span className="badge badge--accent">{item.category}</span>
                  )}
                </div>
              </div>
              {item.summary && <div className="news-item__summary">{item.summary}</div>}
              <div className="news-item__meta">
                <span>{item.source}</span>
                <span>{timeAgo(item.published)}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
