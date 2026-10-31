import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

// Static network (routes + stops) is loaded once and shared by both modules.
const NetworkContext = createContext(null);

export function NetworkProvider({ children }) {
  const [network, setNetwork] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api("/api/network")
        .then((n) => !cancelled && setNetwork(n))
        .catch(() => {
          if (cancelled) return;
          setFailed(true);
          setTimeout(load, 3000);
        });
    load();
    return () => { cancelled = true; };
  }, []);

  const value = useMemo(() => {
    if (!network) return null;
    return {
      ...network,
      routesById: Object.fromEntries(network.routes.map((r) => [r.id, r])),
      stopsById: Object.fromEntries(network.stops.map((s) => [s.id, s])),
    };
  }, [network]);

  if (!value) {
    return (
      <div className="boot">
        <div className="boot-spinner" />
        <p>{failed ? "Serverə qoşulmaq mümkün olmadı, yenidən cəhd edilir…" : "Şəbəkə yüklənir…"}</p>
      </div>
    );
  }
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export const useNetwork = () => useContext(NetworkContext);
