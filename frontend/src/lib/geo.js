// Distance from a point to a route polyline, in metres (local flat projection; fine at city scale).
export function distanceToPath(lat, lon, path) {
  const kx = Math.cos((lat * Math.PI) / 180) * 111320;
  const ky = 110540;
  const px = lon * kx;
  const py = lat * ky;
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i][1] * kx, ay = path[i][0] * ky;
    const bx = path[i + 1][1] * kx, by = path[i + 1][0] * ky;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

/** Nearest point on the polyline: { lat, lon, dist } (dist in metres). */
export function snapToPath(lat, lon, path) {
  const kx = Math.cos((lat * Math.PI) / 180) * 111320;
  const ky = 110540;
  const px = lon * kx;
  const py = lat * ky;
  let best = { lat, lon, dist: Infinity };
  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i][1] * kx, ay = path[i][0] * ky;
    const bx = path[i + 1][1] * kx, by = path[i + 1][0] * ky;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best.dist) best = { lat: cy / ky, lon: cx / kx, dist: d };
  }
  return best;
}

export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Brauzer yer məlumatını dəstəkləmir"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, (e) => reject(new Error(geoError(e))), {
      enableHighAccuracy: true,
      maximumAge: 15000, // a recent fix is good enough to find nearby lines, and instant
      timeout: 10000,
    });
  });
}

export function geoError(e) {
  if (e?.code === 1) return "Yer məlumatına icazə verilmədi";
  if (e?.code === 3) return "Yer məlumatı vaxtında alınmadı";
  return "Yer məlumatı alınmadı";
}
