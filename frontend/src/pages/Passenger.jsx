import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowUp, Bus, Check, ChevronDown, ChevronUp, Clock3, LocateFixed, MapPin, Navigation, Search, Users, X } from "lucide-react";
import LiveTracking from "../components/LiveTracking.jsx";
import RewardsCard, { useRewards } from "../components/Rewards.jsx";
import { BaseMap, BusLayer, FitBounds, FlyTo, MyLocation, PickOnMap, RouteLine, StopLayer, ViewportBuses } from "../components/TransitMap.jsx";
import { currentPosition, distanceToPath, geoError } from "../lib/geo.js";
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

/** "My location" button: watches the device position until switched off. */
function useMyLocation(toast) {
  const [fix, setFix] = useState(null);
  const [on, setOn] = useState(false);
  const [flyKey, setFlyKey] = useState(0);
  const watch = useRef(null);
  const first = useRef(true);

  const stop = () => {
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    setOn(false);
    setFix(null);
  };
  const toggle = () => {
    if (on) return stop();
    if (!navigator.geolocation) return toast("Brauzer yer məlumatını dəstəkləmir", "error");
    setOn(true);
    first.current = true;
    watch.current = navigator.geolocation.watchPosition(
      (pos) => {
        setFix({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy });
        if (first.current) {
          first.current = false;
          setFlyKey((k) => k + 1);
          if (pos.coords.accuracy > 1000) {
            toast(`Yer təxminidir (±${Math.round(pos.coords.accuracy / 1000)} km): cihazda GPS yoxdur`, "error");
          }
        }
      },
      (e) => {
        toast(geoError(e), "error");
        stop();
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );
  };
  useEffect(() => stop, []);
  return { fix, on, toggle, flyKey };
}

export default function Passenger() {
  const net = useNetwork();
  const toast = useToast();
  const [tab, setTab] = useState("routes");
  const [routeId, setRouteId] = useState(null);
  const [stopKey, setStopKey] = useState(null);
  const [sheetUp, setSheetUp] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const [trackFix, setTrackFix] = useState(null);
  const [pick, setPick] = useState(null); // callback waiting for a map click (test mode)
  const requestPick = (cb) => {
    setSheetUp(false);
    setPick(() => cb);
  };
  const locate = useMyLocation(toast);
  const { data: rewards, refresh: refreshRewards } = useRewards();
  const me = trackFix || locate.fix;
  const panelRef = useRef(null);

  // a new view starts at the top of the panel
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [tab, routeId, stopKey]);

  // Open data has a separate stop on each side of the street with the same name;
  // passengers think of them as one place, so they are grouped by name.
  const { stopGroups, groupOf } = useMemo(() => {
    const byKey = new Map();
    for (const s of net.stops) {
      const key = norm(s.name);
      if (!byKey.has(key)) byKey.set(key, { key, name: s.name, ids: [], stops: [], routes: new Set() });
      const g = byKey.get(key);
      g.ids.push(s.id);
      g.stops.push(s);
      s.routes.forEach((r) => g.routes.add(r));
    }
    const groups = [...byKey.values()].map((g) => ({ ...g, routes: [...g.routes] }));
    const of = {};
    groups.forEach((g) => g.ids.forEach((id) => { of[id] = g.key; }));
    return { stopGroups: groups, groupOf: of };
  }, [net]);

  const route = routeId ? net.routesById[routeId] : null;
  const stop = stopKey ? stopGroups.find((g) => g.key === stopKey) : null;
  const { data: live } = usePolling(route ? `/api/routes/${route.id}/live` : null);
  const { data: arrivals } = usePolling(stop && tab === "stops" ? `/api/arrivals?stops=${stop.ids.join(",")}` : null);

  const selectRoute = (id) => {
    if (pick) return; // a click while picking a position must not switch the line
    setRouteId(id);
    setTab("routes");
  };
  const openStop = (idOrKey) => {
    setStopKey(groupOf[idOrKey] || idOrKey);
    setTab("stops");
  };

  const allPoints = useMemo(() => net.routes.flatMap((r) => r.path), [net]);
  const routeStops = useMemo(() => (route ? route.stops.map((sid) => net.stopsById[sid]).filter(Boolean) : []), [route, net]);
  const mapBuses = tab === "stops" && stop
    ? (arrivals?.arrivals || []).map((a) => ({ id: a.bus_id, route_id: a.route_id, plate: a.plate, lat: a.lat, lon: a.lon, crowd_level: a.crowd_level, speed_kmh: "—" }))
    : live?.buses;

  return (
    <main className={`passenger${sheetUp ? " sheet-up" : ""}`}>
      <aside className="panel" ref={panelRef} onScroll={(e) => setShowTop(e.currentTarget.scrollTop > 400)}>
        <button className="sheet-handle" onClick={() => setSheetUp((v) => !v)} aria-label={sheetUp ? "Xəritəni böyüt" : "Paneli böyüt"}>
          <span className="grip" />
          {sheetUp ? <><ChevronDown size={15} /> Xəritəni böyüt</> : <><ChevronUp size={15} /> Paneli böyüt</>}
        </button>
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
                <RouteDetail
                  key={route.id}
                  route={route}
                  live={live}
                  me={me}
                  rewards={rewards}
                  onReported={refreshRewards}
                  onStop={openStop}
                  onBack={() => setRouteId(null)}
                  onFix={setTrackFix}
                  onPickRequest={requestPick}
                />
              ) : (
                <>
                  <RewardsCard rewards={rewards} />
                  <RouteBrowser onSelect={selectRoute} />
                </>
              )}
            </motion.section>
          ) : (
            <motion.section key="stops" className="tab-body" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
              {stop ? (
                <StopDetail stop={stop} data={arrivals} onBack={() => setStopKey(null)} onRoute={selectRoute} />
              ) : (
                <StopBrowser groups={stopGroups} onOpen={openStop} />
              )}
            </motion.section>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showTop && (
            <motion.button
              className="to-top"
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 10 }}
              onClick={() => panelRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
              aria-label="Yuxarı"
            >
              <ArrowUp size={18} />
            </motion.button>
          )}
        </AnimatePresence>
      </aside>

      <div className={`map-wrap${pick ? " picking" : ""}`}>
      <AnimatePresence>
        {pick && (
          <motion.div className="pick-banner" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <span className="live-dot" /> Test rejimi: marşrut xəttinin yaxınlığına toxunun
            <button onClick={() => setPick(null)} aria-label="Ləğv et"><X size={15} /></button>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        className={`locate-btn${me ? " on" : ""}`}
        onClick={locate.toggle}
        title={locate.on ? "Yerimi gizlət" : "Mənim yerim"}
        aria-pressed={locate.on}
      >
        <Navigation size={18} />
        <span>{locate.on ? "Yerimi gizlət" : "Mənim yerim"}</span>
      </button>
      <BaseMap className="map" bounds={allPoints}>
        <MyLocation me={me} />
        {pick && <PickOnMap onPick={(p) => { setPick(null); pick(p); }} />}
        {me && <FlyTo center={[me.lat, me.lon]} zoom={15} trigger={`${locate.flyKey}-${Boolean(trackFix)}`} />}
        <NetworkLines routes={net.routes} selected={route?.id} onSelect={selectRoute} />
        {route && <RouteLine route={route} weight={6} opacity={0.95} flow />}
        {route && <StopLayer stops={routeStops} onClick={openStop} radius={4} />}
        {stop && tab === "stops" && <StopLayer stops={stop.stops} radius={8} />}
        {route || (stop && tab === "stops") ? (
          <BusLayer buses={mapBuses} routesById={net.routesById} onClick={(b) => selectRoute(b.route_id)} />
        ) : (
          <ViewportBuses routesById={net.routesById} onClick={(b) => selectRoute(b.route_id)} />
        )}
        {route && tab === "routes" && <FitBounds points={route.path} deps={[route.id]} />}
        {stop && tab === "stops" && <FlyTo center={[stop.stops[0].lat, stop.stops[0].lon]} zoom={16} />}
      </BaseMap>
      </div>
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

  const [openGroup, setOpenGroup] = useState(null);
  const needle = norm(q.trim());
  // a number-like query keeps the compact grid; a name query or "nearby" shows detailed rows
  const numberQuery = /^\d+[a-zəüöğışç]?$/i.test(needle);
  const listMode = Boolean(near) || (needle && !numberQuery);

  const routes = useMemo(() => {
    let list = net.routes;
    if (near) list = list.filter((r) => near[r.id] != null).sort((a, b) => near[a.id] - near[b.id]);
    if (needle) list = list.filter((r) => norm(r.number).startsWith(needle) || norm(r.name).includes(needle));
    return list;
  }, [needle, net.routes, near]);

  // 108A and 108B are variants of line 108: one tile per base number
  const groups = useMemo(() => {
    const byBase = new Map();
    for (const r of routes) {
      const base = r.number.match(/^\d+/)?.[0] ?? r.number;
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push(r);
    }
    return [...byBase.entries()].map(([base, variants]) => ({ base, variants }));
  }, [routes]);
  const opened = openGroup ? groups.find((g) => g.base === openGroup) : null;

  const tapGroup = (g) => {
    if (g.variants.length === 1) onSelect(g.variants[0].id);
    else setOpenGroup(openGroup === g.base ? null : g.base);
  };

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

      {listMode ? (
        <ul className="route-list">
          {routes.slice(0, 120).map((r, i) => (
            <RouteRow key={r.id} route={r} i={i} onSelect={onSelect} near={near?.[r.id]} />
          ))}
          {!routes.length && <li className="muted">Heç nə tapılmadı</li>}
        </ul>
      ) : (
        <>
          <AnimatePresence>
            {opened && (
              <motion.div
                className="variant-card"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <div className="variant-head">
                  <b>Xətt {opened.base}</b>
                  <span className="muted small">{opened.variants.length} variant</span>
                  <button className="icon-close" onClick={() => setOpenGroup(null)} aria-label="Bağla"><X size={15} /></button>
                </div>
                <ul className="route-list">
                  {opened.variants.map((r, i) => (
                    <RouteRow key={r.id} route={r} i={i} onSelect={onSelect} />
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="route-tiles">
            {groups.map((g, i) => (
              <motion.button
                key={g.base}
                className={`route-tile${openGroup === g.base ? " open" : ""}`}
                style={{ "--c": g.variants[0].color }}
                onClick={() => tapGroup(g)}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: Math.min(i, 30) * 0.01 }}
                whileTap={{ scale: 0.94 }}
                title={g.variants.map((v) => `${v.number}: ${v.name}`).join("\n")}
              >
                <span className="tile-num">{g.base}</span>
                {g.variants.length > 1 && (
                  <span className="tile-variants">
                    {g.variants.map((v) => v.number.slice(g.base.length) || "•").join(" ")}
                  </span>
                )}
              </motion.button>
            ))}
            {!groups.length && <div className="muted">Heç nə tapılmadı</div>}
          </div>
        </>
      )}
    </>
  );
}

function RouteRow({ route: r, i, onSelect, near }) {
  return (
    <motion.li custom={i} variants={listItem} initial="hidden" animate="show" onClick={() => onSelect(r.id)} whileHover={{ x: 3 }}>
      <RouteBadge route={r} />
      <div className="grow">
        <div className="route-name">{r.name}</div>
        <div className="meta">
          <span>{r.stops.length} dayanacaq</span>
          <span>{(r.length_m / 1000).toFixed(1)} km{r.loop ? " · dairəvi" : ""}</span>
          {near != null && <span className="near-tag">{near} m</span>}
        </div>
      </div>
    </motion.li>
  );
}

/** Consecutive stops with the same name (both sides of a street) shown once, soonest ETA. */
function collapseStops(stops) {
  const out = [];
  for (const s of stops) {
    const prev = out[out.length - 1];
    if (prev && norm(prev.name) === norm(s.name)) {
      if (s.next_eta_sec != null && (prev.next_eta_sec == null || s.next_eta_sec < prev.next_eta_sec)) {
        prev.next_eta_sec = s.next_eta_sec;
      }
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

const TIMELINE_PREVIEW = 6;

function RouteDetail({ route, live, me, rewards, onReported, onStop, onBack, onFix, onPickRequest }) {
  const [allStops, setAllStops] = useState(false);
  const stops = live ? collapseStops(live.stops) : [];
  const shown = allStops ? stops : stops.slice(0, TIMELINE_PREVIEW);
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
            <>
              <ul className="timeline" style={{ "--route-color": route.color }}>
                {shown.map((s, i) => (
                  <motion.li key={`${s.id}-${i}`} custom={i} variants={listItem} initial="hidden" animate="show" onClick={() => onStop(s.id)}>
                    <span>{s.name}</span>
                    <Eta sec={s.next_eta_sec} />
                  </motion.li>
                ))}
              </ul>
              {stops.length > TIMELINE_PREVIEW && (
                <button className="show-more" onClick={() => setAllStops((v) => !v)}>
                  {allStops ? <><ChevronUp size={15} /> Qısalt</> : <><ChevronDown size={15} /> Bütün dayanacaqlar ({stops.length})</>}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <ReportBox route={route} buses={live?.buses || []} me={me} rewards={rewards} onReported={onReported} />
      <LiveTracking route={route} buses={live?.buses || []} onFix={onFix} onPickRequest={onPickRequest} />
    </motion.div>
  );
}

const VERIFIED_BY_AZ = { gps: "GPS ilə", crowd: "digər sərnişinlərlə" };

function ReportBox({ route, buses, me, rewards, onReported }) {
  const toast = useToast();
  const [busId, setBusId] = useState("");
  const [sending, setSending] = useState(null);
  const [sent, setSent] = useState(null);
  const limitReached = rewards && rewards.today_reports >= rewards.daily_limit;

  const send = async (level) => {
    setSending(level);
    try {
      const res = await post("/api/reports", {
        route_id: route.id,
        level,
        bus_id: busId || null,
        // location, when known, is the proof of presence that verifies the report
        ...(me ? { lat: me.lat, lon: me.lon } : {}),
      });
      setSent(level);
      setTimeout(() => setSent(null), 2200);
      if (res.verified) {
        toast(`+${res.points_awarded} xal! Bildiriş ${VERIFIED_BY_AZ[res.verified_by]} təsdiqləndi`);
      } else {
        toast("Bildiriş qəbul edildi. Başqa sərnişin təsdiqləsə +10 xal qazanacaqsınız");
      }
      onReported?.();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="report-box">
      <div className="report-head">
        <div className="report-title">Avtobusda sıxlıq necədir?</div>
        {rewards && <span className={`today-chip${limitReached ? " full" : ""}`}>Bu gün {rewards.today_reports}/{rewards.daily_limit}</span>}
      </div>
      <p>
        Bildirişiniz digər sərnişinlərə və operatora kömək edir. Təsdiqlənmiş hər bildiriş <b>+{rewards?.points_per_report ?? 10} xal</b>
        {me ? " · yeriniz təsdiq üçün göndəriləcək" : " · daha tez təsdiq üçün “Mənim yerim”i açın"}.
      </p>
      <select value={busId} onChange={(e) => setBusId(e.target.value)} aria-label="Avtobus">
        <option value="">Avtobusu seçin (istəyə bağlı)</option>
        {buses.map((b) => (
          <option key={b.id} value={b.id}>{b.plate} · {LEVEL_AZ[b.crowd_level]}</option>
        ))}
      </select>
      <div className="report-buttons">
        {LEVELS.map((level) => (
          <motion.button key={level} className={`level-btn ${level}`} disabled={sending !== null || limitReached} onClick={() => send(level)} whileHover={{ y: -2 }} whileTap={{ scale: 0.94 }}>
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

function StopBrowser({ groups, onOpen }) {
  const net = useNetwork();
  const [q, setQ] = useState("");
  const stops = useMemo(() => {
    const needle = norm(q.trim());
    return groups
      .filter((s) => !needle || s.key.includes(needle))
      .sort((a, b) => b.routes.length - a.routes.length || a.name.localeCompare(b.name, "az"));
  }, [q, groups]);

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
          <motion.li key={s.key} custom={i} variants={listItem} initial="hidden" animate="show" onClick={() => onOpen(s.key)}>
            <span className="stop-name">
              <MapPin size={15} /> <span className="stop-label">{s.name}</span>
              {s.ids.length > 1 && <span className="stop-count">{s.ids.length}</span>}
            </span>
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
            <div className="meta">
              <span>{stop.routes.length} xətt</span>
              {stop.ids.length > 1 && <span>{stop.ids.length} dayanacaq nöqtəsi</span>}
            </div>
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
