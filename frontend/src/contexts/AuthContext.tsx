import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { decodeJwt } from 'jose';

interface AuthContextValue {
  token: string | null;
  customerId: string | null;
  setToken: (t: string) => void;
  clearToken: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(
    () => localStorage.getItem('fd_token'),
  );

  const customerId = token
    ? (() => {
        try {
          return (decodeJwt(token).sub as string) ?? null;
        } catch {
          return null;
        }
      })()
    : null;

  const setToken = useCallback((t: string) => {
    localStorage.setItem('fd_token', t);
    setTokenState(t);
  }, []);

  const clearToken = useCallback(() => {
    localStorage.removeItem('fd_token');
    setTokenState(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, customerId, setToken, clearToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
