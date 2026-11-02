import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokenStore, UNAUTHENTICATED_EVENT, type AuthUser } from './api';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  registerDonor: (payload: Record<string, unknown>) => Promise<{ user: AuthUser; token: string }>;
  registerHospital: (payload: Record<string, unknown>) => Promise<{ user: AuthUser }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api.get<{ user: AuthUser }>('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthenticated = () => setUser(null);
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ token: string; user: AuthUser }>('/auth/login', { email, password });
    tokenStore.set(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const registerDonor = useCallback(async (payload: Record<string, unknown>) => {
    const data = await api.post<{ token: string; user: AuthUser }>('/auth/register/donor', payload);
    tokenStore.set(data.token);
    setUser(data.user);
    return data;
  }, []);

  const registerHospital = useCallback(async (payload: Record<string, unknown>) => {
    const data = await api.post<{ user: AuthUser; token?: string }>('/auth/register/hospital', payload);
    // Un compte hospitalier doit etre valide par un administrateur : on ne connecte pas automatiquement.
    return { user: data.user };
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* la deconnexion locale reste valable meme si le service est indisponible */
    }
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, registerDonor, registerHospital, logout, refresh }),
    [user, loading, login, registerDonor, registerHospital, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit etre utilise dans AuthProvider');
  return ctx;
}

export const ROLE_HOME: Record<AuthUser['role'], string> = {
  DONOR: '/donneur',
  HOSPITAL: '/hopital',
  ADMIN: '/admin',
};
