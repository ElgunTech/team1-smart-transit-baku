export const LEVEL_AZ = { low: "Aşağı", medium: "Orta", high: "Yüksək", unknown: "Məlumat yoxdur" };
export const LEVEL_COLOR = { low: "#2b8a3e", medium: "#c57d0b", high: "#d63031", unknown: "#8a949b" };
export const SOURCE_AZ = { user: "sərnişin", sim: "simulyasiya", demo: "demo" };

export function formatEta(sec) {
  if (sec == null) return "—";
  if (sec < 45) return "indi";
  return `${Math.round(sec / 60)} dəq`;
}

export function ago(ts) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "indicə";
  if (s < 3600) return `${Math.floor(s / 60)} dəq əvvəl`;
  return new Date(ts * 1000).toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit" });
}

export function clientId() {
  const fresh = () => "p-" + Math.random().toString(36).slice(2, 12);
  try {
    let id = localStorage.getItem("st-client-id");
    if (!id) {
      id = fresh();
      localStorage.setItem("st-client-id", id);
    }
    return id;
  } catch {
    return fresh();
  }
}
