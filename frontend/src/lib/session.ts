export type UserRole = 'REGISTRAR' | 'APEX';

export interface AuthUser {
  identifier: string;
  role: UserRole;
  name: string;
  title: string;
  institution_id: string | null;
  institution_name: string | null;
  initials: string;
}

export interface Session {
  token: string;
  expires_at: string;
  user: AuthUser;
}

const STORAGE_KEY = 'trustnet:session';

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (
      typeof parsed.token !== 'string' ||
      typeof parsed.expires_at !== 'string' ||
      !parsed.user ||
      typeof parsed.user.identifier !== 'string'
    ) {
      return null;
    }
    const expires = Date.parse(parsed.expires_at);
    if (Number.isNaN(expires) || expires <= Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed as Session;
  } catch {
    return null;
  }
}

export function writeSession(session: Session): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* private browsing can block storage */
  }
}

export function updateSessionUser(user: AuthUser): void {
  const current = readSession();
  if (!current) return;
  writeSession({ ...current, user });
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private browsing can block storage */
  }
}

export function getToken(): string | null {
  return readSession()?.token ?? null;
}

export const SESSION_EXPIRED_EVENT = 'trustnet:session-expired';
