import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";

interface AppUser {
  email: string;
  credits: number;
}

interface AuthState {
  authenticated: boolean | null;
  user: string | null;
  canVideo: boolean;
  appUser: AppUser | null;
  loading: boolean;
  login: (username: string, password: string, rememberMe?: boolean) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshAppUser: () => Promise<void>;
  appLogout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  authenticated: null,
  user: null,
  canVideo: false,
  appUser: null,
  loading: true,
  login: async () => ({ ok: false }),
  logout: async () => {},
  refreshAppUser: async () => {},
  appLogout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const [canVideo, setCanVideo] = useState(false);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const refreshAppUser = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/app/me`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { authenticated: boolean; email: string; credits: number };
        if (data.authenticated) setAppUser({ email: data.email, credits: data.credits });
        else setAppUser(null);
      } else {
        setAppUser(null);
      }
    } catch {
      setAppUser(null);
    }
  }, [base]);

  const checkAuth = useCallback(async () => {
    try {
      const [aoRes] = await Promise.all([
        fetch(`${base}/api/auth/me`, { credentials: "include" }),
        refreshAppUser(),
      ]);
      if (aoRes.ok) {
        const data = await aoRes.json() as { authenticated: boolean; user: string; canVideo?: boolean };
        setAuthenticated(data.authenticated);
        setUser(data.user);
        setCanVideo(!!data.canVideo);
      } else {
        setAuthenticated(false);
        setUser(null);
        setCanVideo(false);
      }
    } catch {
      setAuthenticated(false);
      setUser(null);
      setCanVideo(false);
    } finally {
      setLoading(false);
    }
  }, [base, refreshAppUser]);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (username: string, password: string, rememberMe = false) => {
    try {
      const res = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password, rememberMe }),
      });
      if (res.ok) {
        setAuthenticated(true);
        setUser(username);
        void checkAuth();
        return { ok: true };
      }
      const data = await res.json().catch(() => ({})) as { error?: string };

      // Login do AO falhou — tenta login de app user (convidados/pagos)
      // com o mesmo formulário, usando o usuário digitado como e-mail.
      try {
        const appRes = await fetch(`${base}/api/app/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email: username.trim().toLowerCase(), password }),
        });
        if (appRes.ok) {
          await checkAuth();
          return { ok: true };
        }
      } catch {
        // ignora; cai no erro do AO abaixo
      }

      return { ok: false, error: data.error ?? "Credenciais inválidas" };
    } catch {
      return { ok: false, error: "Erro de conexão. Tente novamente." };
    }
  }, [base, checkAuth]);

  const logout = useCallback(async () => {
    await fetch(`${base}/api/auth/logout`, { method: "POST", credentials: "include" });
    setAuthenticated(false);
    setUser(null);
    setCanVideo(false);
  }, [base]);

  const appLogout = useCallback(async () => {
    await fetch(`${base}/api/app/logout`, { method: "POST", credentials: "include" });
    setAppUser(null);
  }, [base]);

  return (
    <AuthContext.Provider
      value={{
        authenticated, user, canVideo, appUser, loading,
        login, logout, refreshAppUser, appLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
