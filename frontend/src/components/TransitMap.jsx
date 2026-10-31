import { useEffect, useMemo } from "react";
import L from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { LEVEL_AZ } from "../lib/format.js";

const BAKU = [40.392, 49.855];

export function BaseMap({ children, className = "map", bounds }) {
  const view = bounds ? { bounds, boundsOptions: { padding: [20, 20] } } : { center: BAKU, zoom: 12 };
  return (
    <MapContainer {...view} className={className} zoomControl={false}>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Xətlər və dayanacaqlar: <a href="https://opendata.az">opendata.az</a>'
      />
      <ZoomAnimGuard />
      <AutoResize />
      {children}
    </MapContainer>
  );
}

// Bus markers glide between GPS updates with a CSS transition; that must be
// switched off while Leaflet animates a zoom, otherwise the pins drift.
function ZoomAnimGuard() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const on = () => el.classList.add("no-anim");
    const off = () => setTimeout(() => el.classList.remove("no-anim"), 60);
    map.on("zoomstart", on);
    map.on("zoomend", off);
    return () => {
      map.off("zoomstart", on);
      map.off("zoomend", off);
    };
  }, [map]);
  return null;
}

// The map box changes size on mobile (sheet expanded / collapsed); keep tiles in sync.
function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

const meIcon = L.divIcon({
  className: "me-icon",
  html: '<div class="me-pin"><span></span></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/** Calls onPick({lat, lon}) on the next map click (test mode position picking). */
export function PickOnMap({ onPick }) {
  useMapEvents({
    click(e) {
      if (onPick) onPick({ lat: e.latlng.lat, lon: e.latlng.lng });
    },
  });
  return null;
}

/** The user's own position: pulsing blue dot with an accuracy circle, unlike bus pins. */
export function MyLocation({ me }) {
  if (!me) return null;
  return (
    <>
      {me.accuracy > 0 && me.accuracy <= 2000 && (
        <Circle
          center={[me.lat, me.lon]}
          radius={me.accuracy}
          pathOptions={{ color: "#1c7ed6", weight: 1, fillColor: "#339af0", fillOpacity: 0.12, interactive: false }}
        />
      )}
      <Marker position={[me.lat, me.lon]} icon={meIcon} zIndexOffset={2000}>
        <Tooltip direction="top" offset={[0, -12]}>
          <b>Siz buradasınız</b>
          {me.accuracy ? ` · ±${Math.round(me.accuracy)} m` : ""}
        </Tooltip>
      </Marker>
    </>
  );
}

export function FitBounds({ points, padding = 40, deps = [] }) {
  const map = useMap();
  useEffect(() => {
    if (points?.length) map.flyToBounds(L.latLngBounds(points), { padding: [padding, padding], duration: 0.8 });
  }, deps);
  return null;
}

export function FlyTo({ center, zoom = 15, trigger }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, Math.max(map.getZoom(), zoom), { duration: 0.8 });
  }, trigger === undefined ? [center?.[0], center?.[1]] : [trigger]);
  return null;
}

function busIcon(route, crowd, selected, live) {
  return L.divIcon({
    className: "bus-icon",
    html: `<div class="bus-pin${crowd === "high" ? " crowd-high" : ""}${selected ? " selected" : ""}${live ? " live" : ""}" style="--c:${route.color}">
             <span>${route.number}</span>
           </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function BusMarker({ bus, route, dimmed, onClick }) {
  const icon = useMemo(() => busIcon(route, bus.crowd_level, !dimmed, bus.live), [route, bus.crowd_level, dimmed, bus.live]);
  return (
    <Marker
      position={[bus.lat, bus.lon]}
      icon={icon}
      opacity={dimmed ? 0.35 : 1}
      zIndexOffset={dimmed ? 0 : 600}
      eventHandlers={onClick ? { click: () => onClick(bus) } : undefined}
    >
      <Tooltip direction="top" offset={[0, -14]}>
        <b>Xətt {route.number}</b> · {bus.plate}
        {bus.live && <span className="tip-live"> · canlı GPS</span>}
        <br />
        Sıxlıq: {LEVEL_AZ[bus.crowd_level]}
        {typeof bus.speed_kmh === "number" && ` · ${bus.speed_kmh} km/s`}
      </Tooltip>
    </Marker>
  );
}

export function BusLayer({ buses, routesById, focusRoute, onClick }) {
  if (!buses) return null;
  return buses.map((bus) => {
    const route = routesById[bus.route_id];
    if (!route) return null;
    return (
      <BusMarker
        key={bus.id}
        bus={bus}
        route={route}
        dimmed={Boolean(focusRoute) && focusRoute !== bus.route_id}
        onClick={onClick}
      />
    );
  });
}

export function StopLayer({ stops, onClick, radius = 5 }) {
  return stops.map((s) => (
    <CircleMarker
      key={s.id}
      center={[s.lat, s.lon]}
      radius={radius}
      pathOptions={{ color: "#14191c", weight: 2, fillColor: "#fff", fillOpacity: 1 }}
      eventHandlers={onClick ? { click: () => onClick(s.id) } : undefined}
    >
      <Tooltip direction="top" offset={[0, -6]}>{s.name}</Tooltip>
    </CircleMarker>
  ));
}

/** Route line; when `flow` is set an animated dash runs along it. */
export function RouteLine({ route, color, weight = 5, opacity = 0.9, flow = false, casing = true, onClick, children }) {
  const handlers = onClick ? { click: () => onClick(route.id) } : undefined;
  return (
    <>
      {casing && <Polyline positions={route.path} pathOptions={{ color: "#fff", weight: weight + 4, opacity: opacity * 0.9 }} />}
      <Polyline positions={route.path} pathOptions={{ color: color || route.color, weight, opacity }} eventHandlers={handlers}>
        {children}
      </Polyline>
      {flow && (
        <Polyline
          positions={route.path}
          pathOptions={{ color: "#fff", weight: 2, opacity: 0.9, dashArray: "2 14", className: "route-flow" }}
        />
      )}
    </>
  );
}
