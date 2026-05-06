import { useAppContext } from '../contexts/AppContext';

const API_TIMEOUT_MS = 25000;

export function useApi() {
  const { state } = useAppContext();

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

    try {
      const res = await fetch(path, { ...options, headers, signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }

      const json = await res.json();
      // Throw on explicit server-side errors ({ok: false, error: "..."})
      if (json && typeof json === 'object' && json.ok === false) {
        throw new Error(json.error || 'API error');
      }
      return json;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  function get(path) { return request(path); }

  function post(path, body) {
    return request(path, { method: 'POST', body: JSON.stringify(body) });
  }

  function del(path) {
    return request(path, { method: 'DELETE' });
  }

  return { get, post, del, request };
}
