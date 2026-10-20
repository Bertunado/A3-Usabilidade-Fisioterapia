/*
 * Cliente da API do PhysioEdu.
 * - Se a página foi aberta pelo servidor Node (npm start), usa a API real com SQLite.
 * - Se está rodando estática (GitHub Pages / arquivo local), usa o LocalBackend do navegador.
 *
 * Para apontar o site estático para um backend hospedado em outro endereço,
 * defina antes deste script:  <script>window.PHYSIOEDU_API_URL = 'https://minha-api.com/';</script>
 */
(function () {
  const TOKEN_KEY = 'physioedu_token';
  const state = { mode: null, base: '' };

  class ApiError extends Error {
    constructor(message, status, field) {
      super(message);
      this.status = status;
      this.field = field;
    }
  }

  function safeStorage(kind) {
    try {
      return window[kind];
    } catch (err) {
      return null;
    }
  }

  async function detectMode() {
    const configured = window.PHYSIOEDU_API_URL || '';
    const base = configured ? configured.replace(/\/?$/, '/') : '';

    // GitHub Pages e arquivo aberto direto não têm backend: nem tenta (evita um 404 no console)
    const staticHost = location.protocol === 'file:' || location.hostname.endsWith('github.io');

    if (configured || !staticHost) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${base}api/health`, { signal: controller.signal, cache: 'no-store' });
        clearTimeout(timer);
        const data = res.ok ? await res.json() : null;
        if (data && data.status === 'ok' && data.mode === 'server') {
          state.mode = 'server';
          state.base = base;
          return state.mode;
        }
      } catch (err) {
        /* sem servidor disponível: segue no modo local */
      }
    }

    state.mode = 'local';
    return state.mode;
  }

  // Cada aba guarda o próprio token no sessionStorage (permite estudante e professor
  // logados em abas diferentes). Com "manter conectado", ele também vai para o
  // localStorage, para que novas abas/visitas já entrem logadas.
  function getToken() {
    const session = safeStorage('sessionStorage');
    const local = safeStorage('localStorage');
    const sessionToken = session && session.getItem(TOKEN_KEY);
    if (sessionToken) return sessionToken;

    const localToken = local && local.getItem(TOKEN_KEY);
    if (localToken && session) session.setItem(TOKEN_KEY, localToken);
    return localToken || null;
  }

  function clearToken() {
    const token = getToken();
    const session = safeStorage('sessionStorage');
    const local = safeStorage('localStorage');
    if (session) session.removeItem(TOKEN_KEY);
    if (local && local.getItem(TOKEN_KEY) === token) local.removeItem(TOKEN_KEY);
  }

  function setToken(token, remember) {
    const session = safeStorage('sessionStorage');
    const local = safeStorage('localStorage');
    if (session) session.setItem(TOKEN_KEY, token);
    if (local) {
      if (remember) local.setItem(TOKEN_KEY, token);
      else local.removeItem(TOKEN_KEY);
    }
  }

  async function request(method, path, body) {
    if (!state.mode) await detectMode();
    const token = getToken();

    try {
      if (state.mode === 'local') {
        return await window.LocalBackend.handle(method, path, body, token);
      }

      let res;
      try {
        res = await fetch(`${state.base}api${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: body ? JSON.stringify(body) : undefined
        });
      } catch (err) {
        throw new ApiError('Não foi possível conectar ao servidor. Verifique sua conexão.', 0);
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(data.message || `Erro ${res.status} no servidor.`, res.status, data.field);
      return data;
    } catch (err) {
      const error = err instanceof ApiError ? err : new ApiError(err.message || 'Erro inesperado.', err.status || 500, err.field);
      if (error.status === 401 && !path.startsWith('/auth/login') && typeof Api.onUnauthorized === 'function') {
        Api.onUnauthorized();
      }
      throw error;
    }
  }

  const Api = {
    detectMode,
    get mode() {
      return state.mode;
    },
    get: path => request('GET', path),
    post: (path, body) => request('POST', path, body || {}),
    put: (path, body) => request('PUT', path, body || {}),
    patch: (path, body) => request('PATCH', path, body || {}),
    del: path => request('DELETE', path),
    getToken,
    setToken,
    clearToken,
    onUnauthorized: null,
    ApiError
  };

  window.Api = Api;
})();
