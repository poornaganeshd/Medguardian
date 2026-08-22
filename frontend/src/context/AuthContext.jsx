import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { authApi } from '../services/endpoints';
import { tokenStore, stepUpStore, setUnauthorisedHandler } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => tokenStore.user);
  const [loading, setLoading] = useState(Boolean(tokenStore.access));
  const [sessionExpired, setSessionExpired] = useState(false);

  /** Called by the API layer when a session cannot be refreshed. */
  const handleUnauthorised = useCallback(() => {
    setUser(null);
    setSessionExpired(true);
  }, []);

  useEffect(() => {
    setUnauthorisedHandler(handleUnauthorised);
  }, [handleUnauthorised]);

  // Re-validate the stored session on load so a revoked account cannot keep
  // rendering the app from cached local storage.
  useEffect(() => {
    let cancelled = false;
    if (!tokenStore.access) {
      setLoading(false);
      return undefined;
    }
    authApi
      .me()
      .then((data) => {
        if (cancelled) return;
        setUser(data.user);
        tokenStore.save({ user: data.user });
      })
      .catch(() => {
        if (cancelled) return;
        tokenStore.clear();
        setUser(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (credentials) => {
    const data = await authApi.login(credentials);
    tokenStore.save(data);
    setUser(data.user);
    setSessionExpired(false);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await authApi.register(payload);
    tokenStore.save(data);
    setUser(data.user);
    setSessionExpired(false);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout(tokenStore.refresh);
    } catch {
      // Signing out locally must succeed even if the server call fails.
    }
    tokenStore.clear();
    stepUpStore.clear();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const data = await authApi.me();
    setUser(data.user);
    tokenStore.save({ user: data.user });
    return data.user;
  }, []);

  /** Confirms the PIN and stores the resulting step-up token for its lifetime. */
  const verifyPin = useCallback(async (pin) => {
    const data = await authApi.verifyPin(pin);
    stepUpStore.save(data.stepUpToken, data.expiresInMinutes);
    return data;
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      sessionExpired,
      isAuthenticated: Boolean(user),
      isPatient: user?.role === 'patient',
      isCaregiver: user?.role === 'caregiver',
      hasPin: Boolean(user?.hasPin),
      login,
      register,
      logout,
      refreshUser,
      verifyPin,
      setUser,
      dismissSessionExpired: () => setSessionExpired(false)
    }),
    [user, loading, sessionExpired, login, register, logout, refreshUser, verifyPin]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}

export default AuthContext;
