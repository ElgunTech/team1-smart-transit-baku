import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MousePointerClick, Radio, Satellite, Square } from "lucide-react";
import { post } from "../lib/api.js";
import { geoError, snapToPath } from "../lib/geo.js";
import { useToast } from "./Toast.jsx";

const SEND_EVERY_MS = 5000;
const MAX_ACCURACY_M = 200; // same limit as the backend

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
  const watchId = useRef(null);
  const timer = useRef(null);
  const lastSent = useRef(0);

  const clear = () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    if (timer.current) clearInterval(timer.current);
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
    lastSent.current = 0;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, speed } = pos.coords;
        if (accuracy > MAX_ACCURACY_M) {
          clear();
          setActive(false);
          setWeak(Math.round(accuracy));
          return;
        }
        onFix({ lat: latitude, lon: longitude, accuracy }); // the map shows every fix
        const now = Date.now();
        if (now - lastSent.current < SEND_EVERY_MS) return;
        lastSent.current = now;
        send(latitude, longitude, accuracy, speed);
      },
      (e) => {
        toast(geoError(e), "error");
        stop();
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
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
                  Cihazın GPS dəqiqliyi zəifdir (±{weak.toLocaleString("az-AZ")} m). Kompüterdə GPS çipi olmur, yer IP ünvanına görə təxmin edilir.
                  Real GPS üçün telefondan istifadə edin.
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
              {status ? (
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
