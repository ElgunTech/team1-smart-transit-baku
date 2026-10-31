import { useEffect, useRef, useState } from "react";

const TOKEN_KEY = "st-token";
let unauthorizedHandler = () => {};

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session lasts until reload */
  }
}

export const onUnauthorized = (fn) => { unauthorizedHandler = fn; };

export async function api(path, options = {}) {
  const token = getToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) unauthorizedHandler();
    const detail = typeof body.detail === "string" ? body.detail : "Məlumatlar düzgün daxil edilməyib";
    throw Object.assign(new Error(detail), { status: res.status });
  }
  return body;
}

export const post = (path, data) =>
  api(path, { method: "POST", body: data ? JSON.stringify(data) : undefined });

/**
 * Polls `path` every `interval` ms. Returns { data, error, refresh }.
 * Pass a null path to pause polling.
 */
export function usePolling(path, interval = 3000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const refresh = async () => {
    const current = pathRef.current;
    if (!current) return;
    try {
      const body = await api(current);
      if (pathRef.current === current) {
        setData(body);
        setError(null);
      }
    } catch (e) {
      setError(e);
    }
  };

  useEffect(() => {
    setData(null);
    if (!path) return undefined;
    refresh();
    const id = setInterval(refresh, interval);
    return () => clearInterval(id);
  }, [path, interval]);

  return { data, error, refresh };
}
