import axios from 'axios';

/**
 * Central HTTP client.
 *
 * Responsibilities:
 *  - attach the access token to every request
 *  - attach a step-up token when one is held (sensitive actions)
 *  - refresh the access token once on a 401 and replay the request
 *  - surface a consistent error shape to the UI
 */

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

const STORAGE = {
  access: 'mg.accessToken',
  refresh: 'mg.refreshToken',
  user: 'mg.user'
};

export const tokenStore = {
  get access() {
    return localStorage.getItem(STORAGE.access);
  },
  get refresh() {
    return localStorage.getItem(STORAGE.refresh);
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE.user) || 'null');
    } catch {
      return null;
    }
  },
  save({ accessToken, refreshToken, user }) {
    if (accessToken) localStorage.setItem(STORAGE.access, accessToken);
    if (refreshToken) localStorage.setItem(STORAGE.refresh, refreshToken);
    if (user) localStorage.setItem(STORAGE.user, JSON.stringify(user));
  },
  clear() {
    Object.values(STORAGE).forEach((key) => localStorage.removeItem(key));
    sessionStorage.removeItem('mg.stepUpToken');
    sessionStorage.removeItem('mg.stepUpExpiry');
  }
};

/**
 * Step-up tokens live in sessionStorage: they are short lived by design and
 * should not survive the browser being closed.
 */
export const stepUpStore = {
  get() {
    const token = sessionStorage.getItem('mg.stepUpToken');
    const expiry = Number(sessionStorage.getItem('mg.stepUpExpiry') || 0);
    if (!token || Date.now() > expiry) return null;
    return token;
  },
  save(token, expiresInMinutes = 10) {
    sessionStorage.setItem('mg.stepUpToken', token);
    sessionStorage.setItem(
      'mg.stepUpExpiry',
      String(Date.now() + expiresInMinutes * 60 * 1000 - 5000)
    );
  },
  clear() {
    sessionStorage.removeItem('mg.stepUpToken');
    sessionStorage.removeItem('mg.stepUpExpiry');
  }
};

const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  timeout: 30000
});

api.interceptors.request.use((config) => {
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // Attach a step-up token to any request that might need one; the server
  // simply ignores it where it is not required.
  const stepUp = stepUpStore.get();
  if (stepUp) config.headers['x-step-up-token'] = stepUp;

  return config;
});

let refreshing = null;
let onUnauthorised = () => {};

/** Lets AuthContext react to a session that could not be recovered. */
export function setUnauthorisedHandler(handler) {
  onUnauthorised = handler;
}

async function refreshAccessToken() {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) throw new Error('No refresh token');

  const { data } = await axios.post(
    `${BASE_URL}/auth/refresh`,
    { refreshToken },
    { withCredentials: true }
  );
  tokenStore.save(data.data);
  return data.data.accessToken;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;

    // A step-up requirement is a normal outcome, not a session failure.
    if (response?.status === 401 && response?.data?.code === 'STEP_UP_REQUIRED') {
      stepUpStore.clear();
      return Promise.reject(normaliseError(error));
    }

    const isAuthCall = config?.url?.includes('/auth/login') ||
      config?.url?.includes('/auth/register') ||
      config?.url?.includes('/auth/refresh');

    if (response?.status === 401 && !config._retried && !isAuthCall && tokenStore.refresh) {
      config._retried = true;
      try {
        refreshing = refreshing || refreshAccessToken();
        const accessToken = await refreshing;
        refreshing = null;
        config.headers.Authorization = `Bearer ${accessToken}`;
        return api(config);
      } catch {
        refreshing = null;
        tokenStore.clear();
        onUnauthorised();
        return Promise.reject(normaliseError(error));
      }
    }

    return Promise.reject(normaliseError(error));
  }
);

/** Turns any axios failure into `{ message, status, code, details }`. */
export function normaliseError(error) {
  if (error.response) {
    const { status, data } = error.response;
    return Object.assign(new Error(data?.message || `Request failed (${status})`), {
      status,
      code: data?.code,
      details: data?.details || [],
      isApiError: true
    });
  }
  if (error.code === 'ECONNABORTED') {
    return Object.assign(new Error('The request timed out. Please try again.'), {
      status: 0,
      isApiError: true
    });
  }
  return Object.assign(
    new Error('Could not reach the MedGuardian server. Check your connection and try again.'),
    { status: 0, isApiError: true }
  );
}

/** Unwraps the API's `{ success, data }` envelope. */
export const unwrap = (response) => response.data?.data ?? response.data;

export default api;
