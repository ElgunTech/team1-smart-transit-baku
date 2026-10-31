import { memo, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Bus, Check, Clock3, LocateFixed, MapPin, Search, Users, X } from "lucide-react";
import LiveTracking from "../components/LiveTracking.jsx";
import { BaseMap, BusLayer, FitBounds, FlyTo, RouteLine, StopLayer } from "../components/TransitMap.jsx";
import { currentPosition, distanceToPath } from "../lib/geo.js";
import { Eta, LevelPill, RouteBadge, Skeleton } from "../components/ui.jsx";
import { useToast } from "../components/Toast.jsx";
import { post, usePolling } from "../lib/api.js";
import { LEVEL_AZ } from "../lib/format.js";
import { useNetwork } from "../lib/network.jsx";

const TABS = [
  { id: "routes", label: "Xətlər", icon: Bus },
  { id: "stops", label: "Dayanacaqlar", icon: MapPin },
];
const LEVELS = ["low", "medium", "high"];
const STOP_LIMIT = 80;

const listItem = {
  hidden: { opacity: 0, x: -8 },
  show: (i) => ({ opacity: 1, x: 0, transition: { delay: Math.min(i, 20) * 0.025, duration: 0.22 } }),
};

const norm = (s) => s.toLocaleLowerCase("az");

// The whole network as thin lines; memoised so polling does not redraw 230+ polylines.
const NetworkLines = memo(function NetworkLines({ routes, selected, onSelect }) {
  return routes.map((r) =>
    r.id === selected ? null : (
      <RouteLine key={r.id} route={r} weight={2.5} opacity={selected ? 0.12 : 0.35} casing={false} onClick={onSelect} />
    ),
  );
});

export default function Passenger() {
  const net = useNetwork();
  const [tab, setTab] = useState("routes");
  const [routeId, setRouteId] = useState(null);
  const [stopId, setStopId] = useState(null);

  const route = routeId ? net.routesById[routeId] : null;
  const stop = stopId ? net.stopsById[stopId] : null;
  const { data: live } = usePolling(route ? `/api/routes/${route.id}/live` : null);
  const { data: arrivals } = usePolling(stop && tab === "stops" ? `/api/stops/${stop.id}/arrivals` : null);

  const selectRoute = (id) => {
    setRouteId(id);
    setTab("routes");
  };
  const openStop = (id) => {
    setStopId(id);
    setTab("stops");
  };

  const allPoints = useMemo(() => net.routes.flatMap((r) => r.path), [net]);
  const routeStops = useMemo(() => (route ? route.stops.map((sid) => net.stopsById[sid]).filter(Boolean) : []), [route, net]);
  const mapBuses = tab === "stops" && stop
    ? (arrivals?.arrivals || []).map((a) => ({ id: a.bus_id, route_id: a.route_id, plate: a.plate, lat: a.lat, lon: a.lon, crowd_level: a.crowd_level, speed_kmh: "—" }))
    : live?.buses;

  return (
    <main className="passenger">
      <aside className="panel">
        <div className="tabs" role="tablist">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              <Icon size={16} /> {label}
              {tab === id && <motion.span layoutId="tab-underline" className="tab-underline" />}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {tab === "routes" ? (
            <motion.section key="routes" className="tab-body" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.18 }}>
              {route ? (
                <RouteDetail key={route.id} route={route} live={live} onStop={openStop} onBack={() => setRouteId(null)} />
              ) : (
                <RouteBrowser onSelect={selectRoute} />
              )}
            </motion.section>
          ) : (
            <motion.section key="stops" className="tab-body" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
              {stop ? (
                <StopDetail stop={stop} data={arrivals} onBack={() => setStopId(null)} onRoute={selectRoute} />
              ) : (
                <StopBrowser onOpen={openStop} />
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </aside>

      <BaseMap className="map" bounds={allPoints}>
        <NetworkLines routes={net.routes} selected={route?.id} onSelect={selectRoute} />
        {route && <RouteLine route={route} weight={6} opacity={0.95} flow />}
        {route && <StopLayer stops={routeStops} onClick={openStop} radius={4} />}
        {stop && tab === "stops" && <StopLayer stops={[stop]} radius={8} />}
        <BusLayer buses={mapBuses} routesById={net.routesById} onClick={(b) => selectRoute(b.route_id)} />
        {route && tab === "routes" && <FitBounds points={route.path} deps={[route.id]} />}
        {stop && tab === "stops" && <FlyTo center={[stop.lat, stop.lon]} zoom={16} />}
      </BaseMap>
    </main>
  );
}

const NEARBY_M = 400;

function RouteBrowser({ onSelect }) {
  const net = useNetwork();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [near, setNear] = useState(null); // { routeId: distance } around the user
  const [locating, setLocating] = useState(false);

  const routes = useMemo(() => {
    const needle = norm(q.trim());
    let list = net.routes;
    if (near) list = list.filter((r) => near[r.id] != null).sort((a, b) => near[a.id] - near[b.id]);
    if (needle) list = list.filter((r) => norm(r.number).startsWith(needle) || norm(r.name).includes(needle));
    return list;
  }, [q, net.routes, near]);

  const findNearby = async () => {
    setLocating(true);
    try {
      const pos = await currentPosition();
      const { latitude, longitude } = pos.coords;
      const found = {};
      for (const r of net.routes) {
        const d = distanceToPath(latitude, longitude, r.path);
        if (d <= NEARBY_M) found[r.id] = Math.round(d);
      }
      setNear(found);
      toast(`Yaxınlığınızdan ${Object.keys(found).length} xətt keçir`);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setLocating(false);
    }
  };

  return (
    <>
      <label className="search">
        <Search size={16} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xətt nömrəsi və ya dayanacaq adı…" autoComplete="off" />
      </label>
      {near ? (
        <button className="chip-btn active" onClick={() => setNear(null)}>
          <LocateFixed size={15} /> Yaxınlığımdakı xətlər ({NEARBY_M} m) <X size={14} />
        </button>
      ) : (
        <button className="chip-btn" onClick={findNearby} disabled={locating}>
          {locating ? <span className="spinner dark" /> : <LocateFixed size={15} />} Yaxınlığımdakı xətlər
        </button>
      )}
      <div className="list-meta">{routes.length} xətt · mənbə: opendata.az</div>
      <ul className="route-list">
        {routes.slice(0, 120).map((r, i) => (
          <motion.li key={r.id} custom={i} variants={listItem} initial="hidden" animate="show" onClick={() => onSelect(r.id)} whileHover={{ x: 3 }}>
            <RouteBadge route={r} />
            <div className="grow">
              <div className="route-name">{r.name}</div>
              <div className="meta">
                <span>{r.stops.length} dayanacaq</span>
                <span>{(r.length_m / 1000).toFixed(1)} km{r.loop ? " · dairəvi" : ""}</span>
                {near?.[r.id] != null && <span className="near-tag">{near[r.id]} m</span>}
              </div>
            </div>
          </motion.li>
        ))}
        {!routes.length && <li className="muted">Heç nə tapılmadı</li>}
      </ul>
    </>
  );
}

function RouteDetail({ route, live, onStop, onBack }) {
  return (
    <motion.div className="stack" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <button className="back" onClick={onBack}><ArrowLeft size={16} /> Bütün xətlər</button>
      <div className="card">
        <div className="card-head">
          <RouteBadge route={route} size="lg" />
          <div className="grow">
            <div className="card-title">{route.name}</div>
            <div className="meta">
              <span><Bus size={13} /> {live ? live.buses.length : "–"} avtobus</span>
              <span><Users size={13} /> {live ? live.congestion.total_reports : "–"} bildiriş / 10 dəq</span>
            </div>
          </div>
          {live && <LevelPill level={live.congestion.level} />}
        </div>
        <div className="card-body">
          <div className="section-label"><Clock3 size={13} /> Dayanacaqlar və gəliş vaxtı</div>
          {!live ? (
            <Skeleton rows={6} />
          ) : (
            <ul className="timeline" style={{ "--route-color": route.color }}>
              {live.stops.map((s, i) => (
                <motion.li key={`${s.id}-${i}`} custom={i} variants={listItem} initial="hidden" animate="show" onClick={() => onStop(s.id)}>
                  <span>{s.name}</span>
                  <Eta sec={s.next_eta_sec} />
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <ReportBox route={route} buses={live?.buses || []} />
      <LiveTracking route={route} buses={live?.buses || []} />
    </motion.div>
  );
}

function ReportBox({ route, buses }) {
  const toast = useToast();
  const [busId, setBusId] = useState("");
  const [sending, setSending] = useState(null);
  const [sent, setSent] = useState(null);

  const send = async (level) => {
    setSending(level);
    try {
      const res = await post("/api/reports", { route_id: route.id, level, bus_id: busId || null });
      setSent(level);
      setTimeout(() => setSent(null), 2200);
      toast(`Təşəkkürlər! Xəttin cari sıxlığı: ${LEVEL_AZ[res.route_congestion.level]}`);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="report-box">
      <div className="report-title">Avtobusda sıxlıq necədir?</div>
      <p>Bildirişiniz digər sərnişinlərə və operatora xətti tənzimləməyə kömək edir.</p>
      <select value={busId} onChange={(e) => setBusId(e.target.value)} aria-label="Avtobus">
        <option value="">Avtobusu seçin (istəyə bağlı)</option>
        {buses.map((b) => (
          <option key={b.id} value={b.id}>{b.plate} · {LEVEL_AZ[b.crowd_level]}</option>
        ))}
      </select>
      <div className="report-buttons">
        {LEVELS.map((level) => (
          <motion.button key={level} className={`level-btn ${level}`} disabled={sending !== null} onClick={() => send(level)} whileHover={{ y: -2 }} whileTap={{ scale: 0.94 }}>
            <AnimatePresence mode="wait" initial={false}>
              {sent === level ? (
                <motion.span key="ok" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                  <Check size={18} />
                </motion.span>
              ) : (
                <motion.span key="label" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <span className="level-bars" data-level={level}><i /><i /><i /></span>
                  {LEVEL_AZ[level]}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function StopBrowser({ onOpen }) {
  const net = useNetwork();
  const [q, setQ] = useState("");
  const stops = useMemo(() => {
    const needle = norm(q.trim());
    return net.stops
      .filter((s) => !needle || norm(s.name).includes(needle))
      .sort((a, b) => b.routes.length - a.routes.length || a.name.localeCompare(b.name, "az"));
  }, [q, net.stops]);

  return (
    <>
      <label className="search">
        <Search size={16} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Dayanacaq axtar… (məs. 28 May)" autoComplete="off" />
      </label>
      <div className="list-meta">
        {stops.length} dayanacaq{stops.length > STOP_LIMIT ? ` · ilk ${STOP_LIMIT} göstərilir, dəqiqləşdirmək üçün axtarın` : ""}
      </div>
      <ul className="stop-list">
        {stops.slice(0, STOP_LIMIT).map((s, i) => (
          <motion.li key={s.id} custom={i} variants={listItem} initial="hidden" animate="show" onClick={() => onOpen(s.id)}>
            <span className="stop-name"><MapPin size={15} /> {s.name}</span>
            <span className="mini-badges">
              {s.routes.slice(0, 5).map((rid) => <RouteBadge key={rid} route={net.routesById[rid]} size="sm" />)}
              {s.routes.length > 5 && <span className="more">+{s.routes.length - 5}</span>}
            </span>
          </motion.li>
        ))}
        {!stops.length && <li className="muted">Heç nə tapılmadı</li>}
      </ul>
    </>
  );
}

function StopDetail({ stop, data, onBack, onRoute }) {
  const net = useNetwork();
  return (
    <div className="stack">
      <button className="back" onClick={onBack}><ArrowLeft size={16} /> Bütün dayanacaqlar</button>
      <div className="card">
        <div className="card-head">
          <span className="stop-icon"><MapPin size={18} /></span>
          <div className="grow">
            <div className="card-title">{stop.name}</div>
            <div className="meta"><span>{stop.routes.length} xətt · yaxınlaşan avtobuslar</span></div>
          </div>
        </div>
        <div className="card-body">
          {!data ? (
            <Skeleton rows={4} />
          ) : data.arrivals.length ? (
            data.arrivals.map((a, i) => (
              <motion.div key={a.bus_id} layout className="arrival" custom={i} variants={listItem} initial="hidden" animate="show" onClick={() => onRoute(a.route_id)}>
                <RouteBadge route={net.routesById[a.route_id]} />
                <div className="grow">
                  <div className="route-name">{a.route_name}</div>
                  <div className="meta">
                    <span>{a.plate}</span>
                    <span>{(a.distance_m / 1000).toFixed(1)} km</span>
                    <LevelPill level={a.crowd_level} />
                  </div>
                </div>
                <Eta sec={a.eta_sec} />
              </motion.div>
            ))
          ) : (
            <div className="empty">Bu dayanacağa yaxınlaşan avtobus yoxdur</div>
          )}
        </div>
      </div>
    </div>
  );
}
