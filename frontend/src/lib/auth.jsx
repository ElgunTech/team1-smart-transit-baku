import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, onUnauthorized, post, setToken } from "./api.js";

const AuthContext = createContext(null);

export const homeFor = (user) => (user?.role === "operator" ? "/operator" : "/");

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const signOut = useCallback(() => {
    if (getToken()) post("/api/auth/logout").catch(() => {});
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      setToken(null);
      setUser(null);
    });
    if (!getToken()) {
      setReady(true);
      return;
    }
    api("/api/auth/me")
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  const accept = ({ token, user: u }) => {
    setToken(token);
    setUser(u);
    return u;
  };

  const login = async (email, password) => accept(await post("/api/auth/login", { email, password }));
  const register = async (name, email, password) => accept(await post("/api/auth/register", { name, email, password }));

  return (
    <AuthContext.Provider value={{ user, ready, login, register, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
