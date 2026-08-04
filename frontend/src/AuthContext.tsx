import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { storage } from '@/src/utils/storage';

const TOKEN_KEY = 'jaleter_auth_token';
const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export type AuthUser = {
  user_id: string;
  name: string;
  email: string;
  provider: 'password' | 'google';
  picture?: string | null;
  is_admin?: boolean;
};

type AuthState = {
  loading: boolean;
  user: AuthUser | null;
  token: string | null;
  register: (name: string, email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithApple: (payload: { identity_token: string; name?: string | null; email?: string | null }) => Promise<void>;
  logout: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ delivered: boolean; reset_token?: string }>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
};

const Ctx = createContext<AuthState | undefined>(undefined);

async function callApi(path: string, options: RequestInit = {}, token?: string | null): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = 'Request failed';
    try {
      const body = await res.json();
      detail = body?.detail || detail;
    } catch {}
    const err = new Error(detail) as any;
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export { callApi as apiCall };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const persist = useCallback(async (t: string, u: AuthUser) => {
    await storage.secureSet(TOKEN_KEY, t);
    setToken(t);
    setUser(u);
  }, []);

  // Restore existing session, and consume ?session_id / #session_id from a Google web redirect
  useEffect(() => {
    (async () => {
      try {
        // 1) On web, check whether we just came back from the Emergent Google flow
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const hash = window.location.hash || '';
          const search = window.location.search || '';
          let sessionId: string | null = null;
          if (hash.includes('session_id=')) sessionId = new URLSearchParams(hash.replace(/^#/, '')).get('session_id');
          if (!sessionId && search.includes('session_id=')) sessionId = new URLSearchParams(search).get('session_id');
          if (sessionId) {
            try {
              const data = await callApi('/api/auth/emergent/session', {
                method: 'POST',
                body: JSON.stringify({ session_id: sessionId }),
              });
              await persist(data.token, data.user);
              // Clean the URL so refresh doesn't reprocess it
              window.history.replaceState(null, '', window.location.pathname);
              return; // Skip stored-token restore, we're authenticated
            } catch {
              // fall through to stored-token restore
            }
          }
        }

        // 2) Fallback: restore existing session from secure storage
        const stored = await storage.secureGet(TOKEN_KEY, '' as string);
        if (stored && typeof stored === 'string' && stored.length > 0) {
          try {
            const me = await callApi('/api/auth/me', { method: 'GET' }, stored);
            setToken(stored);
            setUser(me);
          } catch {
            await storage.secureRemove(TOKEN_KEY);
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [persist]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const data = await callApi('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
    await persist(data.token, data.user);
  }, [persist]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await callApi('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    await persist(data.token, data.user);
  }, [persist]);

  const loginWithGoogle = useCallback(async () => {
    const redirectUrl = Platform.OS === 'web'
      ? (typeof window !== 'undefined' ? `${window.location.origin}/` : '')
      : Linking.createURL('');
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

    let sessionId: string | null = null;

    if (Platform.OS === 'web') {
      // On web we cannot open an in-app browser; navigate away and process on return
      if (typeof window !== 'undefined') {
        window.location.href = authUrl;
      }
      return;
    }

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    if (result.type !== 'success' || !result.url) return;
    const parsed = Linking.parse(result.url);
    sessionId = (parsed.queryParams?.session_id as string) || null;
    // Also try the URL fragment (# session_id=...)
    if (!sessionId && result.url.includes('#')) {
      const frag = result.url.split('#')[1] || '';
      const params = new URLSearchParams(frag);
      sessionId = params.get('session_id');
    }
    if (!sessionId) throw new Error('Google sign-in did not return a session');
    const data = await callApi('/api/auth/emergent/session', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    });
    await persist(data.token, data.user);
  }, [persist]);

  const loginWithApple = useCallback(async (payload: { identity_token: string; name?: string | null; email?: string | null }) => {
    const data = await callApi('/api/auth/apple', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await persist(data.token, data.user);
  }, [persist]);

  const logout = useCallback(async () => {
    try {
      if (token) await callApi('/api/auth/logout', { method: 'POST' }, token);
    } catch {}
    await storage.secureRemove(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, [token]);

  const requestPasswordReset = useCallback(async (email: string) => {
    const data = await callApi('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    return { delivered: !!data?.delivered, reset_token: data?.reset_token };
  }, []);

  const resetPassword = useCallback(async (resetToken: string, newPassword: string) => {
    const data = await callApi('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: resetToken, new_password: newPassword }),
    });
    await persist(data.token, data.user);
  }, [persist]);

  return <Ctx.Provider value={{ loading, user, token, register, login, loginWithGoogle, loginWithApple, logout, requestPasswordReset, resetPassword }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
}

// Handle the ?session_id=... fragment on web after Google returns to `/`
export async function consumeWebSessionIfPresent(persist: (t: string, u: AuthUser) => Promise<void>) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  let sessionId: string | null = null;
  if (hash.includes('session_id=')) sessionId = new URLSearchParams(hash.replace(/^#/, '')).get('session_id');
  if (!sessionId && search.includes('session_id=')) sessionId = new URLSearchParams(search).get('session_id');
  if (!sessionId) return false;
  const data = await callApi('/api/auth/emergent/session', { method: 'POST', body: JSON.stringify({ session_id: sessionId }) });
  await persist(data.token, data.user);
  window.history.replaceState(null, '', window.location.pathname);
  return true;
}
