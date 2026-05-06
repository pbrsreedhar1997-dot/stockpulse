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
      // Unwrap {ok: true, data: ...} envelope used by Flask endpoints
      if (json && typeof json === 'object' && 'ok' in json && 'data' in json) {
        if (!json.ok) throw new Error(json.error || 'API error');
        return json.data;
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
