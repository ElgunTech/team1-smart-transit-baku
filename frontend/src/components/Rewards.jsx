import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Gift, Info, Lock, ShieldCheck, Ticket } from "lucide-react";
import { post, usePolling } from "../lib/api.js";
import { AnimatedNumber } from "./ui.jsx";
import { useToast } from "./Toast.jsx";

export function useRewards() {
  return usePolling("/api/rewards/me", 10000);
}

/** Points for verified reports; trips can be redeemed once the operator partnership is live. */
export default function RewardsCard({ rewards }) {
  const toast = useToast();
  const [info, setInfo] = useState(false);
  if (!rewards) return null;
  const { points, trip_cost: cost, trips_available: trips, today_reports: today, daily_limit: limit } = rewards;
  const progress = ((points % cost) / cost) * 100;

  const redeem = async () => {
    try {
      await post("/api/rewards/redeem");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <motion.div className="rewards" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="rewards-top">
        <span className="rewards-icon"><Gift size={18} /></span>
        <div className="grow">
          <div className="rewards-points"><AnimatedNumber value={points} /> <span>xal</span></div>
          <div className="meta">
            <span>{trips > 0 ? `${trips} pulsuz gediş` : `${cost - (points % cost)} xal qalıb pulsuz gedişə`}</span>
            <span className="today-dots" title="Bu günün bildirişləri">
              {Array.from({ length: limit }, (_, i) => <i key={i} className={i < today ? "used" : ""} />)}
              {today}/{limit}
            </span>
          </div>
        </div>
        <button className="icon-close" onClick={() => setInfo((v) => !v)} aria-label="Qaydalar"><Info size={15} /></button>
      </div>
      <div className="rewards-bar"><motion.span animate={{ width: `${progress}%` }} transition={{ duration: 0.6 }} /></div>

      <AnimatePresence>
        {info && (
          <motion.ul className="rewards-rules" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <li><ShieldCheck size={14} /><span>Xal yalnız <b>təsdiqlənmiş</b> bildirişə verilir: GPS ilə xəttin üzərində olduğunuz təsdiqlənəndə və ya başqa sərnişin 10 dəqiqə ərzində eyni sıxlığı bildirəndə.</span></li>
            <li><Ticket size={14} /><span>Hər təsdiqlənmiş bildiriş {rewards.points_per_report} xal, {cost} xal 1 pulsuz gedişdir.</span></li>
            <li><Info size={14} /><span>Gündə ən çoxu {limit} bildiriş göndərmək olar.</span></li>
          </motion.ul>
        )}
      </AnimatePresence>

      <button className="btn block redeem" disabled={!rewards.redeem_enabled} onClick={redeem}>
        {rewards.redeem_enabled ? <Ticket size={16} /> : <Lock size={15} />} Xalla gediş al
      </button>
      {!rewards.redeem_enabled && (
        <p className="partner-note">
          Bu funksiya yalnız <b>{rewards.partner}</b> ilə əməkdaşlıq təsdiqləndikdən sonra işə düşəcək. Xallarınız indidən toplanır.
        </p>
      )}
    </motion.div>
  );
}
