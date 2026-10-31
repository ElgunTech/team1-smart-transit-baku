import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { LEVEL_AZ, formatEta } from "../lib/format.js";

export function RouteBadge({ route, size = "md" }) {
  return (
    <span className={`badge badge-${size}`} style={{ background: route.color }}>
      {route.number}
    </span>
  );
}

export function LevelPill({ level }) {
  const l = level || "unknown";
  return (
    <motion.span
      key={l}
      className={`pill ${l}`}
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 28 }}
    >
      {LEVEL_AZ[l]}
    </motion.span>
  );
}

/** Number that tweens to its new value instead of jumping. */
export function AnimatedNumber({ value, decimals = 0 }) {
  const mv = useMotionValue(value ?? 0);
  const text = useTransform(mv, (v) => v.toFixed(decimals));
  useEffect(() => {
    const controls = animate(mv, value ?? 0, { duration: 0.6, ease: "easeOut" });
    return controls.stop;
  }, [value]);
  return <motion.span>{text}</motion.span>;
}

export function Eta({ sec }) {
  const soon = sec != null && sec < 180;
  return (
    <motion.span
      key={formatEta(sec)}
      className={`eta${soon ? " soon" : ""}`}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {formatEta(sec)}
    </motion.span>
  );
}

export function Skeleton({ rows = 4 }) {
  return (
    <div className="skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" style={{ animationDelay: `${i * 0.08}s` }} />
      ))}
    </div>
  );
}
