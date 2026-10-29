import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, endpoints, type AuthUser, type LoginResponse } from './api';
import {
  SESSION_EXPIRED_EVENT,
  clearSession,
  readSession,
  updateSessionUser,
  writeSession,
  type Session,
  type UserRole,
} from './session';

interface AuthContextValue {
  session: Session | null;
  user: AuthUser | null;
  login: (role: UserRole, identifier: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readSession());

  useEffect(() => {
    const onExpired = () => setSession(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    api
      .get<AuthUser>(endpoints.me)
      .then(({ data }) => {
        if (cancelled) return;
        updateSessionUser(data);
        setSession((current) => (current ? { ...current, user: data } : current));
      })
      .catch(() => {
        /* 401s are handled by the shared axios interceptor */
      });
    return () => {
      cancelled = true;
    };
    // Revalidate once per browser session, not on every user update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(session)]);

  useEffect(() => {
    if (!session) return;
    const remaining = Date.parse(session.expires_at) - Date.now();
    if (Number.isNaN(remaining)) return;
    const timer = window.setTimeout(
      () => {
        clearSession();
        setSession(null);
      },
      Math.max(remaining, 0),
    );
    return () => window.clearTimeout(timer);
  }, [session]);

  const login = useCallback(
    async (role: UserRole, identifier: string, password: string) => {
      const { data } = await api.post<LoginResponse>(endpoints.login, {
        role,
        identifier: identifier.trim(),
        password,
      });
      const next: Session = {
        token: data.token,
        expires_at: data.expires_at,
        user: data.user,
      };
      writeSession(next);
      setSession(next);
      return data.user;
    },
    [],
  );

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, login, logout }),
    [session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
