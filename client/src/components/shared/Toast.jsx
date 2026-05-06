import React from 'react';
import { useAppContext } from '../../contexts/AppContext';
import './Toast.scss';

export default function Toast() {
  const { state, dispatch } = useAppContext();

  return (
    <div className="toast-container">
      {state.toasts.map(t => (
        <div key={t.id} className={`toast toast--${t.type}`}>
          <span className="toast__icon">
            {t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}
          </span>
          <span className="toast__message">{t.message}</span>
          <button
            className="toast__close"
            onClick={() => dispatch({ type: 'REMOVE_TOAST', payload: t.id })}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
