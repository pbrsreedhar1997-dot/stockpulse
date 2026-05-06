import React, { useState } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { useAuth } from '../../hooks/useAuth';
import './AuthModal.scss';

export default function AuthModal() {
  const { dispatch } = useAppContext();
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const close = () => dispatch({ type: 'TOGGLE_AUTH_MODAL' });

  const handle = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (mode === 'login') {
        await login(form.email, form.password);
      } else {
        await register(form.name, form.email, form.password);
      }
      close();
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h2>
          <button className="modal__close" onClick={close}>×</button>
        </div>

        <div className="modal__tabs">
          <button
            className={`modal__tab ${mode === 'login' ? 'modal__tab--active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
          >
            Log in
          </button>
          <button
            className={`modal__tab ${mode === 'register' ? 'modal__tab--active' : ''}`}
            onClick={() => { setMode('register'); setError(''); }}
          >
            Sign up
          </button>
        </div>

        <form className="modal__form" onSubmit={handle}>
          {mode === 'register' && (
            <div className="field">
              <label className="field__label">Name</label>
              <input
                className="field__input"
                type="text"
                placeholder="Your name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
          )}

          <div className="field">
            <label className="field__label">Email</label>
            <input
              className="field__input"
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              required
            />
          </div>

          <div className="field">
            <label className="field__label">Password</label>
            <input
              className="field__input"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              required
              minLength={6}
            />
          </div>

          {error && <p className="modal__error">{error}</p>}

          <button className="modal__submit" type="submit" disabled={loading}>
            {loading ? <span className="spinner" /> : (mode === 'login' ? 'Log in' : 'Create account')}
          </button>
        </form>
      </div>
    </div>
  );
}
