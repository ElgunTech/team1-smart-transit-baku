import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, AlertTriangle, Bus, CheckCircle2, Flame, MessageSquareText, Search, Siren, X, Zap } from "lucide-react";
import { BaseMap, RouteLine } from "../components/TransitMap.jsx";
import { AnimatedNumber, LevelPill, RouteBadge, Skeleton } from "../components/ui.jsx";
import { useToast } from "../components/Toast.jsx";
import { post, usePolling } from "../lib/api.js";
import { LEVEL_AZ, LEVEL_COLOR, SOURCE_AZ, ago } from "../lib/format.js";
import { useNetwork } from "../lib/network.jsx";
import { Tooltip } from "react-leaflet";

const SEVERITY = { unknown: 0, low: 1, medium: 2, high: 3 };
const ROW_LIMIT = 12;

function Kpi({ icon: Icon, label, value, alarm, delay, sub }) {
  return (
    <motion.div
      className={`kpi${alarm ? " alarm" : ""}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
    >
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon"><Icon size={17} /></span>
      </div>
      <div className="kpi-value">{value == null ? "—" : <AnimatedNumber value={value} />}</div>
      {sub}
    </motion.div>
  );
}

export default function Operator() {
  const net = useNetwork();
  const toast = useToast();
  const { data: overview, refresh: refreshOverview } = usePolling("/api/operator/overview");
  const { data: alerts, refresh: refreshAlerts } = usePolling("/api/operator/alerts?limit=20");
  const { data: reports } = usePolling("/api/operator/reports?limit=15");
  const [demoRoute, setDemoRoute] = useState(net.routes[0].id);
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(null);
  const seen = useRef(null);
  const [fresh, setFresh] = useState(new Set());

  // Notify the operator when a new anomaly alert appears.
  useEffect(() => {
    if (!alerts) return;
    const open = alerts.filter((a) => a.status === "open").map((a) => a.id);
    if (seen.current) {
      const added = open.filter((id) => !seen.current.has(id));
      if (added.length) {
        toast("Yeni xəbərdarlıq: əlavə avtobus tövsiyəsi", "error");
        setFresh(new Set(added));
      }
    }
    seen.current = new Set(open);
    document.title = (open.length ? `(${open.length}) ` : "") + "Operator paneli · SmartTransit Bakı";
  }, [alerts]);

  const act = async (key, path, okText) => {
    setBusy(key);
    try {
      await post(path);
      toast(okText);
      await Promise.all([refreshAlerts(), refreshOverview()]);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(null);
    }
  };

  const allPoints = useMemo(() => net.routes.flatMap((r) => r.path), [net]);
  const levels = Object.fromEntries((overview?.routes || []).map((r) => [r.id, r]));
  const sortedRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (overview?.routes || [])
      .filter((r) => !needle || r.number.toLowerCase().startsWith(needle))
      .sort((a, b) => (b.open_alert_id ? 1 : 0) - (a.open_alert_id ? 1 : 0)
        || SEVERITY[b.level] - SEVERITY[a.level] || (b.score ?? 0) - (a.score ?? 0));
  }, [overview, q]);
  const visibleRows = showAll || q ? sortedRows : sortedRows.slice(0, ROW_LIMIT);
  const t = overview?.totals;
  const win = overview?.window_minutes ?? 10;

  return (
    <main className="ops">
      <section className="kpis">
        <Kpi
          icon={Bus}
          label="Xətdə olan avtobuslar"
          value={t?.active_buses}
          delay={0}
          sub={<div className={`kpi-sub${t?.live_buses ? " on" : ""}`}><span className="live-dot" /> {t?.live_buses ?? 0} canlı GPS (sərnişin telefonu)</div>}
        />
        <Kpi icon={MessageSquareText} label={`Bildirişlər (son ${win} dəq)`} value={t?.reports_window} delay={0.05} />
        <Kpi icon={Flame} label="Yüksək sıxlıqlı xətlər" value={t?.high_routes} delay={0.1} />
        <Kpi icon={Siren} label="Açıq xəbərdarlıqlar" value={t?.open_alerts} alarm={t?.open_alerts > 0} delay={0.15} />
      </section>

      <div className="ops-grid">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <Activity size={18} />
              <h2>Sıxlıq xəritəsi</h2>
              <div className="legend">
                {["low", "medium", "high", "unknown"].map((l) => (
                  <span key={l}><i style={{ background: LEVEL_COLOR[l] }} />{LEVEL_AZ[l]}</span>
                ))}
              </div>
            </div>
            <BaseMap className="ops-map" bounds={allPoints}>
              {/* calm lines first, congested lines drawn on top */}
              {[...net.routes]
                .sort((a, b) => SEVERITY[levels[a.id]?.level || "unknown"] - SEVERITY[levels[b.id]?.level || "unknown"])
                .map((r) => {
                  const row = levels[r.id];
                  const level = row?.level || "unknown";
                  return (
                    <RouteLine
                      key={`${r.id}-${level}`}
                      route={r}
                      color={LEVEL_COLOR[level]}
                      weight={level === "high" ? 6 : level === "unknown" ? 2 : 3}
                      opacity={level === "unknown" ? 0.35 : 0.85}
                      casing={level === "high"}
                      flow={level === "high"}
                    >
                      <Tooltip sticky>
                        <b>Xətt {r.number}</b> · {r.name}
                        <br />
                        Sıxlıq: {LEVEL_AZ[level]} · {row?.total_reports ?? 0} bildiriş · {row?.buses ?? 0} avtobus
                      </Tooltip>
                    </RouteLine>
                  );
                })}
            </BaseMap>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Xətlər üzrə vəziyyət</h2>
              <label className="search search-sm push">
                <Search size={14} />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xətt №" />
              </label>
            </div>
            {!overview ? (
              <div className="card-body"><Skeleton rows={4} /></div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Xətt</th><th>Sıxlıq</th><th>Bal</th><th>A / O / Y</th><th>Paylanma</th><th>Avtobus</th><th>Orta sürət</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r) => (
                      <tr key={r.id} className={r.open_alert_id ? "row-alert" : ""}>
                        <td><RouteBadge route={r} /></td>
                        <td><LevelPill level={r.level} /></td>
                        <td className="mono">{r.score ?? "—"}</td>
                        <td className="mono">{r.counts.low} / {r.counts.medium} / {r.counts.high}</td>
                        <td>
                          <div className="bar">
                            {["low", "medium", "high"].map((l) => (
                              <motion.span
                                key={l}
                                className={l}
                                animate={{ width: `${r.total_reports ? (r.counts[l] / r.total_reports) * 100 : 0}%` }}
                                transition={{ duration: 0.6, ease: "easeOut" }}
                              />
                            ))}
                          </div>
                        </td>
                        <td className="mono"><AnimatedNumber value={r.buses} /></td>
                        <td className="mono">{r.avg_speed_kmh ?? "—"} km/s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sortedRows.length > ROW_LIMIT && (
                  <button className="table-more" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Yalnız ən sıx xətləri göstər" : `Bütün ${sortedRows.length} xətti göstər`}
                  </button>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-head">
              <AlertTriangle size={18} />
              <h2>Xəbərdarlıqlar</h2>
              <span className="muted small push">Qayda: {win} dəq ərzində yüksək sıxlıq</span>
            </div>
            <div className="alerts">
              {!alerts ? (
                <Skeleton rows={3} />
              ) : alerts.length === 0 ? (
                <div className="empty">
                  <CheckCircle2 size={28} />
                  <p>Anomaliya yoxdur. Bütün xətlər normal işləyir.</p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {alerts.map((a) => {
                    const open = a.status === "open";
                    const title = open ? "Əlavə avtobus tövsiyəsi" : a.status === "dispatched" ? "Ehtiyat ayrıldı" : "Rədd edildi";
                    return (
                      <motion.article
                        key={a.id}
                        layout
                        className={`alert${open ? " open" : ""}${fresh.has(a.id) ? " fresh" : ""}`}
                        initial={{ opacity: 0, x: 30, scale: 0.98 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: -30 }}
                        transition={{ type: "spring", stiffness: 300, damping: 28 }}
                      >
                        <div className="alert-title">
                          <RouteBadge route={{ number: a.route_number, color: a.color }} />
                          {open && <span className="pulse-dot" />}
                          {title}
                          <span className="time">{ago(a.created_at)}</span>
                        </div>
                        <p>{a.message}</p>
                        {open ? (
                          <div className="alert-actions">
                            <button
                              className="btn primary"
                              disabled={busy !== null}
                              onClick={() => act(`d${a.id}`, `/api/operator/alerts/${a.id}/dispatch`, "Ehtiyat avtobus xəttə yönləndirildi")}
                            >
                              <Bus size={15} /> {a.recommended_buses} avtobus ayır
                            </button>
                            <button
                              className="btn ghost danger"
                              disabled={busy !== null}
                              onClick={() => act(`x${a.id}`, `/api/operator/alerts/${a.id}/dismiss`, "Xəbərdarlıq rədd edildi")}
                            >
                              <X size={15} /> Rədd et
                            </button>
                          </div>
                        ) : (
                          <div className="resolution">{a.resolution} · {ago(a.closed_at)}</div>
                        )}
                      </motion.article>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <MessageSquareText size={18} />
              <h2>Son sərnişin bildirişləri</h2>
            </div>
            <ul className="feed">
              <AnimatePresence initial={false}>
                {(reports || []).map((r) => (
                  <motion.li
                    key={r.id}
                    layout
                    initial={{ opacity: 0, y: -10, backgroundColor: "rgba(242,183,5,.18)" }}
                    animate={{ opacity: 1, y: 0, backgroundColor: "rgba(242,183,5,0)" }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5 }}
                  >
                    <RouteBadge route={{ number: r.route_number, color: r.color }} size="sm" />
                    <LevelPill level={r.level} />
                    <span className="muted small">{r.stop_name || ""}</span>
                    <span className="src">{SOURCE_AZ[r.source] || r.source} · {ago(r.ts)}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </section>

          <section className="card">
            <div className="card-head">
              <Zap size={18} />
              <h2>Demo ssenari</h2>
            </div>
            <div className="card-body">
              <p className="muted small" style={{ marginTop: 0 }}>
                Seçilmiş xəttə 6 fərqli sərnişindən “Yüksək” bildirişi göndərir və anomaliya qaydasını yoxlamağa imkan verir.
              </p>
              <div className="demo-tools">
                <select value={demoRoute} onChange={(e) => setDemoRoute(e.target.value)} aria-label="Xətt">
                  {net.routes.map((r) => (
                    <option key={r.id} value={r.id}>Xətt {r.number} · {r.name}</option>
                  ))}
                </select>
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => act("demo", `/api/demo/rush/${demoRoute}`, "6 “Yüksək” bildirişi göndərildi")}
                >
                  <Flame size={15} /> Pik saatı simulyasiya et
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
