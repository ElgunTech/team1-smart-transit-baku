import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MousePointerClick, Radio, Satellite, Square } from "lucide-react";
import { post } from "../lib/api.js";
import { geoError, snapToPath } from "../lib/geo.js";
import { useToast } from "./Toast.jsx";

const SEND_EVERY_MS = 5000;
const MAX_ACCURACY_M = 300; // same limit as the backend; the fix is snapped onto the route anyway
const GPS_WAIT_MS = 10000;
const FRESH_FIX_MS = 15000; // a warm fix this recent is used immediately

/**
 * "I'm on this bus": streams the phone location as the bus GPS while active.
 * Desktops have no GPS chip (accuracy ~50 km from IP), so a clearly labelled
 * test mode lets the user pick the position on the map instead.
 */
export default function LiveTracking({ route, buses, onFix = () => {}, onPickRequest }) {
  const toast = useToast();
  const [busId, setBusId] = useState("");
  const [active, setActive] = useState(false);
  const [manual, setManual] = useState(false);
  const [weak, setWeak] = useState(null); // accuracy in metres when the device fix is too coarse
  const [status, setStatus] = useState(null); // { accuracy, sentAt, offset }
  const [searching, setSearching] = useState(null); // accuracy of the coarse fix while waiting for GPS
  const watchId = useRef(null);
  const timer = useRef(null);
  const lastSent = useRef(0);
  const bestAccuracy = useRef(Infinity);
  const gotPrecise = useRef(false);

  const clear = () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    if (timer.current) {
      clearInterval(timer.current);
      clearTimeout(timer.current);
    }
    watchId.current = null;
    timer.current = null;
  };

  const stop = () => {
    clear();
    setActive(false);
    setManual(false);
    setStatus(null);
    onFix(null);
  };

  useEffect(() => stop, [route.id]);

  // Warm up the GPS as soon as the line is open (only if permission was already
  // granted, so no prompt appears): by the time the user taps "share", a fix is ready.
  const warm = useRef(null);
  useEffect(() => {
    let id = null;
    let cancelled = false;
    navigator.permissions?.query({ name: "geolocation" }).then((p) => {
      if (cancelled || p.state !== "granted") return;
      id = navigator.geolocation.watchPosition((pos) => { warm.current = pos; }, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (id != null) navigator.geolocation.clearWatch(id);
    };
  }, [route.id]);

  const send = async (lat, lon, accuracy, speed) => {
    try {
      const res = await post("/api/tracking", {
        route_id: route.id,
        bus_id: busId,
        lat,
        lon,
        accuracy_m: accuracy,
        speed_kmh: speed != null && speed >= 0 ? speed * 3.6 : null,
      });
      setStatus({ accuracy: accuracy == null ? null : Math.round(accuracy), sentAt: new Date(), offset: res.snap_offset_m });
      return true;
    } catch (e) {
      toast(e.message, "error");
      stop();
      return false;
    }
  };

  const start = () => {
    if (!busId) {
      toast("Əvvəlcə olduğunuz avtobusu seçin", "error");
      return;
    }
    if (!navigator.geolocation) {
      toast("Brauzer yer məlumatını dəstəkləmir", "error");
      return;
    }
    setWeak(null);
    setActive(true);
    setSearching(null);
    lastSent.current = 0;
    bestAccuracy.current = Infinity;
    gotPrecise.current = false;
    // Phones report a coarse network fix first and the GPS fix a few seconds later:
    // keep waiting for a precise one and give up only after GPS_WAIT_MS.
    const giveUp = () => {
      clear();
      setActive(false);
      setSearching(null);
      setWeak(Number.isFinite(bestAccuracy.current) ? Math.round(bestAccuracy.current) : null);
      if (!Number.isFinite(bestAccuracy.current)) toast("GPS siqnalı tapılmadı", "error");
    };
    timer.current = setTimeout(() => !gotPrecise.current && giveUp(), GPS_WAIT_MS);
    const onPosition = (pos) => {
        const { latitude, longitude, accuracy, speed } = pos.coords;
        bestAccuracy.current = Math.min(bestAccuracy.current, accuracy);
        onFix({ lat: latitude, lon: longitude, accuracy }); // the map shows every fix
        if (accuracy > MAX_ACCURACY_M) {
          if (!gotPrecise.current) setSearching(Math.round(accuracy));
          return;
        }
        gotPrecise.current = true;
        setSearching(null);
        const now = Date.now();
        if (now - lastSent.current < SEND_EVERY_MS) return;
        lastSent.current = now;
        send(latitude, longitude, accuracy, speed);
    };
    // instant start from the warmed-up fix
    const w = warm.current;
    if (w && Date.now() - w.timestamp < FRESH_FIX_MS) onPosition(w);
    watchId.current = navigator.geolocation.watchPosition(
      onPosition,
      (e) => {
        if (e.code === 3) return; // no fix yet: keep waiting until GPS_WAIT_MS
        toast(geoError(e), "error");
        stop();
      },
      { enableHighAccuracy: true, maximumAge: FRESH_FIX_MS, timeout: GPS_WAIT_MS },
    );
  };

  const startManual = () => {
    if (!busId) {
      toast("Əvvəlcə olduğunuz avtobusu seçin", "error");
      return;
    }
    toast("Xəritədə marşrut xəttinin yaxınlığına toxunun");
    onPickRequest(async (picked) => {
      // test mode: the tapped point is snapped onto the line, so it need not be pixel-exact
      const snap = snapToPath(picked.lat, picked.lon, route.path);
      if (snap.dist > 1500) {
        toast(`Seçdiyiniz nöqtə xətdən ${(snap.dist / 1000).toFixed(1)} km uzaqdır. Xəttin yaxınlığına toxunun.`, "error");
        return;
      }
      const { lat, lon } = snap;
      setWeak(null);
      setManual(true);
      setActive(true);
      onFix({ lat, lon, accuracy: 0 });
      if (await send(lat, lon, null, null)) {
        timer.current = setInterval(() => send(lat, lon, null, null), SEND_EVERY_MS);
      }
    });
  };

  return (
    <div className={`live-box${active ? " active" : ""}`}>
      <div className="live-box-head">
        <span className="live-box-icon">{active ? <Radio size={18} /> : <Satellite size={18} />}</span>
        <div className="grow">
          <div className="report-title">Mən bu avtobusdayam</div>
          <p>Telefonunuzun GPS-i avtobusun real mövqeyini digər sərnişinlərlə paylaşır.</p>
        </div>
      </div>
      {!active ? (
        <>
          <select value={busId} onChange={(e) => setBusId(e.target.value)} aria-label="Olduğunuz avtobus">
            <option value="">Olduğunuz avtobusu seçin</option>
            {buses.map((b) => (
              <option key={b.id} value={b.id}>{b.plate}{b.live ? " · canlı" : ""}</option>
            ))}
          </select>
          <motion.button className="btn primary block" onClick={start} whileTap={{ scale: 0.98 }}>
            <Satellite size={16} /> Canlı GPS paylaş
          </motion.button>
          <AnimatePresence>
            {weak && (
              <motion.div className="gps-weak" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <p>
                  Dəqiq GPS tapılmadı (ən yaxşı: ±{weak.toLocaleString("az-AZ")} m). Telefonda: “Dəqiq yer” icazəsini və GPS-i açın,
                  pəncərəyə yaxın və ya açıq yerdə yenidən cəhd edin. Kompüterdə GPS çipi olmur.
                </p>
                <button className="btn block" onClick={startManual}>
                  <MousePointerClick size={16} /> Test rejimi: xəritədə yerimi seç
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : (
        <motion.div className="live-status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <span className="live-dot" />
          <div className="grow">
            <b>{manual ? "Mövqe ötürülür · test rejimi" : "Canlı GPS ötürülür"}</b>
            <div className="meta">
              {searching && !status ? (
                <span>GPS axtarılır… indiki dəqiqlik ±{searching.toLocaleString("az-AZ")} m (lazımdır ≤ {MAX_ACCURACY_M} m)</span>
              ) : status ? (
                <>
                  {status.accuracy != null && <span>dəqiqlik {status.accuracy} m</span>}
                  <span>xətdən {status.offset} m</span>
                  <span>{status.sentAt.toLocaleTimeString("az-AZ")}</span>
                </>
              ) : (
                <span>Yer məlumatı gözlənilir…</span>
              )}
            </div>
          </div>
          <button className="btn ghost danger" onClick={stop}><Square size={14} /> Dayandır</button>
        </motion.div>
      )}
    </div>
  );
}
