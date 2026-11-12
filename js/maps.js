// Map backgrounds shared by the public map view and the editor's pin placer.
import { CFG } from "./data.js";

const PHOTO_KEY = "isthmia-map-base";
const store = { get: () => { try { return localStorage.getItem(PHOTO_KEY); } catch { return null; } }, set: (v) => { try { localStorage.setItem(PHOTO_KEY, v); } catch {} } };

// Background for maps, from "map.base" in site.json:
//   { "type": "osm" }                         street map, no key needed
//   { "type": "google", "key": "…" }          Google satellite (Map Tiles API key, restricted to this site's address)
//   { "type": "esri", "key": "…" }            Esri World Imagery (ArcGIS API key)
//   { "type": "xyz", "url": "https://…/{z}/{x}/{y}.jpg", "attribution": "…" }   any other tile server
// plus optional "overlay": { "url": "plan.jpg", "bounds": [[south, west], [north, east]], "opacity": 0.8 } for your own site plan or air photo,
// and optional "photo": { "url": "img/site-photo.jpg", "bounds": [[s, w], [n, e]], "label": "Site photo", "default": false }:
// one orthomosaic of the whole site that visitors switch to with the Map | Site photo buttons.
// Returns { tiles, photo, mode(), setMode("map" | "photo") }.
export async function addBase(map, M = CFG.map || {}) {
  const b = M.base || { type: "osm" };
  const osm = () => L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxNativeZoom: 19, maxZoom: 22, attribution: "© OpenStreetMap contributors" });
  let layer;
  try {
    if (b.type === "google" && b.key) {
      const r = await fetch("https://tile.googleapis.com/v1/createSession?key=" + encodeURIComponent(b.key), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapType: "satellite", language: "en-US", region: "US" }) });
      const sess = await r.json(); if (!sess.session) throw new Error("no session");
      layer = L.tileLayer(`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${sess.session}&key=${encodeURIComponent(b.key)}`, { maxNativeZoom: 20, maxZoom: 22, attribution: "Imagery © Google" });
      const logo = L.control({ position: "bottomleft" }); logo.onAdd = () => Object.assign(L.DomUtil.create("div", "map-google"), { textContent: "Google" }); logo.addTo(map);
    } else if (b.type === "esri" && b.key) layer = L.tileLayer("https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=" + encodeURIComponent(b.key), { maxNativeZoom: 19, maxZoom: 22, attribution: "Powered by Esri · Imagery © Esri, Maxar, Earthstar Geographics" });
    else if (b.type === "xyz" && b.url) layer = L.tileLayer(b.url, { maxNativeZoom: b.maxNativeZoom || 19, maxZoom: 22, attribution: b.attribution || "" });
  } catch (e) { console.warn("Map background unavailable, using the street map:", e); }
  const tiles = (layer || osm()).addTo(map);
  if (M.overlay && M.overlay.url) L.imageOverlay(M.overlay.url, M.overlay.bounds, { opacity: M.overlay.opacity ?? 0.85 }).addTo(map);

  const P = M.photo && M.photo.url && M.photo.bounds ? M.photo : null;
  const base = { tiles, photo: null, mode: () => "map", setMode: () => {} };
  if (!P) return base;
  // the photo sits above the tiles; around its edges the street map stays visible, faded, so areas off the photo keep their context
  const photo = L.imageOverlay(P.url, P.bounds, { opacity: 1, className: "map-photo", attribution: P.attribution || "" });
  let mode = "map";
  const ctl = L.control({ position: "topright" });
  ctl.onAdd = () => {
    const d = L.DomUtil.create("div", "map-basebtns seg");
    d.innerHTML = `<button data-base="map">Map</button><button data-base="photo">${P.label || "Site photo"}</button>`;
    L.DomEvent.disableClickPropagation(d);
    d.onclick = (e) => { const t = e.target.closest("[data-base]"); if (t) { setMode(t.dataset.base, true); store.set(t.dataset.base); } };
    return d;
  };
  ctl.addTo(map);
  function setMode(m, fly) {
    mode = m === "photo" ? "photo" : "map";
    map.getContainer().classList.toggle("photo-mode", mode === "photo");
    ctl.getContainer().querySelectorAll("[data-base]").forEach((x) => x.classList.toggle("on", x.dataset.base === mode));
    if (mode === "photo") {
      photo.addTo(map);
      // bring the photo into view if the map is looking elsewhere
      const pb = photo.getBounds(), vb = map.getBounds();
      if (fly && !vb.contains(pb.getCenter())) map.fitBounds(pb, { maxZoom: 19 });
    } else photo.remove();
  }
  setMode(store.get() || (P.default ? "photo" : "map"));
  return Object.assign(base, { photo, mode: () => mode, setMode });
}

// Area names → the label each record's place belongs to, from the combined site's areas.json
// ({"Roman Bath": ["R. Bath", "Bath"], "Tower #": []}; # stands for a number). Same rules as scripts/build_hub.py:
// the longest matching spelling wins, so "Fortress West Stairway" → Fortress and "Tower 10 (Loukos)" → Tower 10.
export function areaMatcher(areas) {
  if (!areas || !Object.keys(areas).length) return (t) => t || "";
  const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rules = [];
  for (const [name, aliases] of Object.entries(areas))
    for (const a of new Set([name, ...(aliases || [])])) {
      const pat = a.split(/\s+/).filter(Boolean).map(rx).join("\\s*").replace("\\#", "#").replace("#", "(\\d+)");
      rules.push([a.length, new RegExp("(?<![A-Za-z0-9])" + pat + "(?![A-Za-z0-9])", "i"), name]);
    }
  rules.sort((x, y) => y[0] - x[0]);
  const cache = new Map();
  return (text) => {
    if (cache.has(text)) return cache.get(text);
    let out = "";
    for (const [, re, name] of rules) { const m = re.exec(text || ""); if (m) { out = name.includes("#") ? name.replace("#", m[1]) : name; break; } }
    cache.set(text, out);
    return out;
  };
}
