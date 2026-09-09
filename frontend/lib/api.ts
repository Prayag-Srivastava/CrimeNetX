/**
 * Axios instance for the CrimeNetX Node backend.
 * Attaches the JWT from localStorage and handles
 * refresh-token rotation on 401s for both API clients.
 */
import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

export const AI_API_URL =
  process.env.NEXT_PUBLIC_AI_API_URL || "http://localhost:5000/api/ai";

export const api = axios.create({
  baseURL: API_URL,
  timeout: 180000,
});

export const aiApi = axios.create({
  baseURL: AI_API_URL,
  timeout: 180000,
});

const TOKEN_KEY = "crimenetx_access_token";
const REFRESH_KEY = "crimenetx_refresh_token";

export const tokenStore = {
  getAccess: () =>
    typeof window !== "undefined"
      ? localStorage.getItem(TOKEN_KEY)
      : null,

  getRefresh: () =>
    typeof window !== "undefined"
      ? localStorage.getItem(REFRESH_KEY)
      : null,

  set: (access: string, refresh: string) => {
    localStorage.setItem(TOKEN_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },

  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

const attachToken = (config: InternalAxiosRequestConfig) => {
  const token = tokenStore.getAccess();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
};

// Attach JWT to both API clients.
api.interceptors.request.use(attachToken);
aiApi.interceptors.request.use(attachToken);

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = tokenStore.getRefresh();

  if (!refreshToken) {
    return null;
  }

  try {
    const { data } = await axios.post(
      `${API_URL}/auth/refresh`,
      { refreshToken }
    );

    tokenStore.set(data.accessToken, data.refreshToken);

    return data.accessToken as string;
  } catch {
    tokenStore.clear();
    return null;
  }
}

async function handleAuthError(
  error: AxiosError,
  client: typeof api
) {
  const original = error.config as
    | (InternalAxiosRequestConfig & { _retry?: boolean })
    | undefined;

  if (
    error.response?.status === 401 &&
    original &&
    !original._retry &&
    tokenStore.getRefresh()
  ) {
    original._retry = true;

    refreshing = refreshing ?? refreshAccessToken();

    const newToken = await refreshing;
    refreshing = null;

    if (newToken) {
      original.headers.Authorization = `Bearer ${newToken}`;

      return client(original);
    }
  }

  return Promise.reject(error);
}

// Handle expired JWTs for the normal Node API.
api.interceptors.response.use(
  (res) => res,
  (error: AxiosError) => handleAuthError(error, api)
);

// Handle expired JWTs for AI/proxied endpoints too.
aiApi.interceptors.response.use(
  (res) => res,
  (error: AxiosError) => handleAuthError(error, aiApi)
);

export function extractErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: string }
      | undefined;

    return data?.error || err.message || "Request failed";
  }

  return err instanceof Error ? err.message : "Unknown error";
}