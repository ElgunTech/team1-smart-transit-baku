import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Radio, Satellite, Square } from "lucide-react";
import { post } from "../lib/api.js";
import { geoError } from "../lib/geo.js";
import { useToast } from "./Toast.jsx";

const SEND_EVERY_MS = 5000;

/** "I'm on this bus": streams the phone location as the bus GPS while active. */
export default function LiveTracking({ route, buses }) {
  const toast = useToast();
  const [busId, setBusId] = useState("");
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState(null); // { accuracy, sentAt, offset }
  const watchId = useRef(null);
  const lastSent = useRef(0);

  const stop = () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setActive(false);
    setStatus(null);
  };

  useEffect(() => stop, [route.id]);

  const start = () => {
    if (!busId) {
      toast("Əvvəlcə olduğunuz avtobusu seçin", "error");
      return;
    }
    if (!navigator.geolocation) {
      toast("Brauzer yer məlumatını dəstəkləmir", "error");
      return;
    }
    setActive(true);
    lastSent.current = 0;
    watchId.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const now = Date.now();
        if (now - lastSent.current < SEND_EVERY_MS) return;
        lastSent.current = now;
        const { latitude, longitude, accuracy, speed } = pos.coords;
        try {
          const res = await post("/api/tracking", {
            route_id: route.id,
            bus_id: busId,
            lat: latitude,
            lon: longitude,
            accuracy_m: accuracy,
            speed_kmh: speed != null && speed >= 0 ? speed * 3.6 : null,
          });
          setStatus({ accuracy: Math.round(accuracy), sentAt: new Date(), offset: res.snap_offset_m });
        } catch (e) {
          toast(e.message, "error");
          stop();
        }
      },
      (e) => {
        toast(geoError(e), "error");
        stop();
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
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
        </>
      ) : (
        <AnimatePresence>
          <motion.div className="live-status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <span className="live-dot" />
            <div className="grow">
              <b>Canlı GPS ötürülür</b>
              <div className="meta">
                {status ? (
                  <>
                    <span>dəqiqlik {status.accuracy} m</span>
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
        </AnimatePresence>
      )}
    </div>
  );
}
