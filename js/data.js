// Shared data helpers for the viewer and the editor.
// Everything archive-specific (field names, labels, image layout) comes from the site's
// site.json, which the build writes into config.js as window.GA_CONFIG.
export const CFG = window.GA_CONFIG;

// ------------------------------------------------------------ field roles
const F = CFG.fields || {};
export const ROLE = {
  id: F.id || "ID",
  title: F.title || "Title",
  titleFallback: F.titleFallback || [],
  caption: F.caption || [],
  boardCaption: F.boardCaption || F.caption || [],
  location: F.location || "",
  geo: F.geo || "",
  images: F.images || [],
  date: F.date || null,          // {field, label, year, century}
  created: F.created || null,    // {field, label, decade}
};
export const GROUP = CFG.group || null; // the "boxes" view: {field, nav, one, itemNoun, numbered, photos}
export const NOUN = Object.assign({ one: "image", many: "images" }, CFG.noun || {});
export const label = (f) => (CFG.labels && CFG.labels[f]) || f;
export const titleOf = (r) => r[ROLE.title] || ROLE.titleFallback.map((f) => r[f]).find(Boolean) || "Untitled";
export const captionOf = (r, list = ROLE.caption) => list.map((f) => (f === "_cy" ? r._cy : r[f])).filter(Boolean).join(" · ");

// the viewer sits in <site>/browse/ when the site has Info pages; its data, config and images are one folder up (CFG.root)
export const rooted = (u) => (u && !/^([a-z]+:|\/)/i.test(u) ? (CFG.root || "") + u : u);

export async function loadArchive(url = CFG.dataUrl, onProgress) {
  url = rooted(url);
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  const data = await res.json();
  return unpack(data);
}

export function unpack(data) {
  const { columns, dicts, rows } = data;
  const dictCols = columns.map((c) => dicts[c] || null);
  const records = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], rec = {};
    for (let j = 0; j < columns.length; j++) {
      const d = dictCols[j];
      rec[columns[j]] = d ? d[row[j]] : row[j];
    }
    rec._i = i;
    records[i] = rec;
  }
  const fields = columns.filter((c) => !c.startsWith("_"));
  indexRecords(records, fields);
  return { records, fields, generated: data.generated, imageBase: data.imageBase || CFG.imageBase, aliases: data.aliases || {} };
}

export function indexRecords(records, fields) {
  for (const r of records) {
    r._text = fields.map((f) => r[f] || "").join(" \u0001 ").toLowerCase();
  }
}

// ------------------------------------------------------------ images
// A record has one image per entry in fields.images (Gregory: one scan; coins: obverse + reverse).
// Each entry names the column holding the file name, and optionally a column with a full URL (the original on S3).
// Smaller copies, used once site.json has "thumbsReady": true:
//   thumbBase (400 px) / mediumBase (1600 px) + <name>.webp, or, with "imageFormats" (e.g. ["avif", "webp"]),
//   thumbBase + <format>/<name>.<format>: the first format is tried first, the next if it fails to load.
// "hideOriginals": public pages never show or link the original (full-size) file; 1600 px is the largest they use and
// what they offer to download. The editor still shows the original and its address.
const extRe = /\.(jpe?g|png|tiff?|webp|avif)$/i;
let EDITOR = false;
export function editorMode() { EDITOR = true; }
export const originalsHidden = () => !!(CFG.thumbsReady && CFG.hideOriginals && !EDITOR);
const FORMATS = CFG.imageFormats && CFG.imageFormats.length ? CFG.imageFormats : ["webp"];
const FORMAT_DIRS = !!(CFG.imageFormats && CFG.imageFormats.length);
export const imageCount = (r) => ROLE.images.filter((im) => r[im.field] || (im.urlField && r[im.urlField])).length || 1;
export const imageLabel = (k) => (ROLE.images[k] && ROLE.images[k].label) || "";
const baseName = (u) => { try { return decodeURIComponent(String(u).split(/[?#]/)[0].split("/").pop()); } catch { return ""; } };
// the image's file name: the file-name column, else the last part of its full URL (records added by URL only)
const fileOf = (r, k = 0) => {
  const im = ROLE.images[k]; if (!im) return "";
  const f = r[im.field] || (im.urlField && r[im.urlField]) || "";
  return /^https?:\/\//.test(f) ? baseName(f) : f;
};
export function fullUrl(r, k = 0) {
  const im = ROLE.images[k]; if (!im || originalsHidden()) return "";
  const f = r[im.field] || "";
  return (im.urlField && r[im.urlField]) || (/^https?:\/\//.test(f) ? f : f ? CFG.imageBase + encodeURIComponent(f) : "");
}
function sizedUrl(r, k, base, fi = 0) {
  const f = fileOf(r, k); if (!f || !base) return "";
  const fmt = FORMATS[fi];
  return base + (FORMAT_DIRS ? fmt + "/" : "") + encodeURIComponent(f.replace(extRe, "")) + "." + fmt;
}
export function thumbUrl(r, k = 0) {
  return CFG.thumbsReady && fileOf(r, k) ? sizedUrl(r, k, CFG.thumbBase) : fullUrl(r, k);
}
export function mediumUrl(r, k = 0) {
  return CFG.thumbsReady && fileOf(r, k) ? sizedUrl(r, k, CFG.mediumBase) : fullUrl(r, k);
}
// what "Download" and the CSV/JSON exports link to: the original, or the 1600 px WebP when originals are hidden
export function downloadUrl(r, k = 0) {
  if (!originalsHidden()) return fullUrl(r, k);
  const w = FORMATS.indexOf("webp");
  return sizedUrl(r, k, CFG.mediumBase, w >= 0 ? w : FORMATS.length - 1);
}
// <img onerror> fallback: next format, then the 1600 px copy (for a missing 400), then the original (if not hidden)
export function attachFallback(img, r, k = 0) {
  img.onerror = () => {
    const list = [];
    if (CFG.thumbsReady) {
      const bases = img.src.startsWith(CFG.thumbBase) ? [CFG.thumbBase, CFG.mediumBase] : [CFG.mediumBase];
      for (const b of bases) FORMATS.forEach((_, i) => list.push(sizedUrl(r, k, b, i)));
    }
    list.push(fullUrl(r, k));
    const next = list.slice(list.indexOf(img.src) + 1).find(Boolean);
    if (next && next !== img.src) img.src = next;
    else { img.onerror = null; img.classList.add("broken"); }
  };
}
// thumbnail markup for cards: one image, or a pair side by side (coins)
export function thumbImgs(r, cls = "") {
  const n = CFG.cardPair ? Math.min(2, imageCount(r)) : 1;
  // "keep" = this record's photo has no plain backdrop to hide (set per record on combined sites)
  return Array.from({ length: n }, (_, k) => `<img decoding="async" alt="" data-k="${k}" class="${cls}${r._cut === 0 ? " keep" : ""}">`).join("");
}
export function loadThumbs(el, r, onload) {
  el.querySelectorAll("img[data-k]").forEach((img) => {
    const k = +img.dataset.k; attachFallback(img, r, k);
    if (onload) img.onload = () => onload(img);
    img.src = thumbUrl(r, k);
  });
}

// ------------------------------------------------------------ group photos (boxes/<slug>.webp, copied from Airtable)
export const boxSlug = (name) => String(name || "").split(/\s+/).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export function boxPhoto(name, small) {
  if (CFG.boxCovers && CFG.boxCovers[name]) return CFG.boxCovers[name];
  if (!GROUP || !GROUP.photos) return "";
  return (CFG.boxPhotoBase || CFG.imageBase + "boxes/") + boxSlug(name) + (small ? "-400" : "") + ".webp";
}

// ------------------------------------------------------------ permanent links
export const LINK_PATH = CFG.permalinkPath || "slide";
// On the combined site a link names the record's collection too (#colorslides/<ID>), so equal IDs in two collections stay apart.
export function uri(r) { return (CFG.permalinkBase || location.href.split("#")[0]) + "#" + (CFG.hubSources && r._src ? r._src : LINK_PATH) + "/" + r._id; }

// ------------------------------------------------------------ years
export function fmtYear(y) {
  if (y == null || y === "") return "";
  return y < 0 ? `${-y} BC` : `${y}`;
}
export function parseYearInput(s) {
  if (s == null) return null;
  s = String(s).trim();
  if (!s) return null;
  const m = s.match(/^(-?\d{1,4})\s*(bc|bce|b\.c\.?)?\s*(ad|ce)?$/i);
  if (!m) return null;
  let y = parseInt(m[1], 10);
  if (m[2]) y = -Math.abs(y);
  return y;
}
export function centuryLabel(c) {
  // c = century index: 5 => 5th c. AD, -5 => 5th c. BC
  const n = Math.abs(c);
  const suf = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${n}${suf} c. ${c < 0 ? "BC" : "AD"}`;
}
export function centuryOf(y) {
  if (y == null) return null;
  return y > 0 ? Math.ceil(y / 100) : -Math.ceil(-y / 100);
}

// ------------------------------------------------------------ derived fields usable for grouping/charts
// Names come from the site config so each archive can say "Century (subject)" or "Century (minted)".
export const DN = {
  century: ROLE.date && (ROLE.date.century || "Century"),
  year: ROLE.date && (ROLE.date.year || "Date (year)"),
  decade: ROLE.created && (ROLE.created.decade || "Decade created"),
  created: ROLE.created && (ROLE.created.label || "Year created"),
  geo: ROLE.geo ? "Has map location" : null,
};
export const DERIVED = {};
if (DN.century) DERIVED[DN.century] = (r) => (r._sy == null ? "" : centuryLabel(centuryOf(Math.round((r._sy + r._ey) / 2))));
if (DN.decade) DERIVED[DN.decade] = (r) => (r._cy == null ? "" : `${Math.floor(r._cy / 10) * 10}s`);
if (DN.created) DERIVED[DN.created] = (r) => (r._cy == null ? "" : String(r._cy));
if (DN.geo) DERIVED[DN.geo] = (r) => (r._lat != null ? "Yes" : "No");

export function getValue(r, field) {
  const d = DERIVED[field];
  return d ? d(r) : r[field] || "";
}
export function sortKeyFor(field) {
  if (field === DN.century) return (v) => { const m = v.match(/^(\d+)\w+ c\. (BC|AD)/); return m ? (m[2] === "BC" ? -m[1] : +m[1]) : 1e9; };
  if (field === DN.decade || field === DN.created) return (v) => parseInt(v, 10) || 1e9;
  if (GROUP && GROUP.numbered && field === GROUP.field) return (v) => { const m = v.match(/^\s*(\d+)/); return m ? +m[1] : 1e6 + v.charCodeAt(0); };
  return null;
}

// ------------------------------------------------------------ export
export function toCSV(records, fields) {
  const esc = (v) => { v = v == null ? "" : String(v); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const n = Math.max(1, ROLE.images.length);
  const imgHead = n === 1 ? ["Image URL", "Thumbnail URL"] : ROLE.images.flatMap((im, k) => [`${im.label || "Image " + (k + 1)} URL`]);
  const head = ["ID", "URI", ...fields, ...imgHead];
  const lines = [head.map(esc).join(",")];
  for (const r of records) {
    const imgs = n === 1 ? [downloadUrl(r), thumbUrl(r)] : ROLE.images.map((_, k) => downloadUrl(r, k));
    lines.push([r._id, uri(r), ...fields.map((f) => r[f]), ...imgs].map(esc).join(","));
  }
  return lines.join("\r\n");
}
export function download(name, text, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmtN = (n) => n.toLocaleString("en-US");
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ------------------------------------------------------------ viewer settings
// Site defaults come from "viewer" in site.json (or sites/<site>/viewer.json, saved from the editor).
//   background   "dark" | "light"   starting background of the full-screen viewer (visitors can flip it)
//   removeBg     true = hide the photo's plain backdrop so the object sits on the viewer background
//   bgTolerance  how far from the backdrop colour still counts as backdrop (8 = strict … 80 = generous)
//   scale        null, or { field: "<diameter column>", unit: "mm", fill: 0.8 } → scale bar + actual-size zoom
//   scaleOn      show the scale bar when the viewer opens
//   fields       columns listed under "Key fields" in the viewer (null = keyFields)
//   infoDefault  "key" | "all": which tab the info panel opens on
//   tableFields  columns of the table view, in order (null = "table.cols" in site.json). Visitors can change both lists for themselves.
export const VIEW_DEFAULTS = { background: "dark", removeBg: false, bgTolerance: 32, scale: null, scaleOn: true, fields: null, infoDefault: "all", tableFields: null };
export const VIEW = Object.assign({}, VIEW_DEFAULTS, CFG.viewer || {});
const PREF_KEY = (CFG.storageKey || CFG.key || "ga") + "-viewer-prefs";
export function viewerPrefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } }
export function saveViewerPref(k, v) { try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...viewerPrefs(), [k]: v })); } catch {} }
export const currentBg = () => viewerPrefs().bg || VIEW.background || "dark";

// Hides a near-white backdrop without reading pixels (works for images on another domain):
// an SVG filter that turns brightness above a threshold into transparency.
function keyFilter() {
  let svg = document.getElementById("photo-key-svg");
  if (!svg) {
    // k = strict key (brightness above the threshold is backdrop). On its own it leaves a pale line round the object:
    // the pixels where object and backdrop blend, and any soft shadow. So within a few pixels of the object's edge a
    // looser key (l) applies as well, and one pixel is shaved off the edge. Inside that band (e3) only the strict key
    // counts, so bright parts of the object itself are untouched.
    document.body.insertAdjacentHTML("beforeend", `<svg id="photo-key-svg" width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="photo-key" color-interpolation-filters="sRGB">
      <feColorMatrix class="pk-strict" type="matrix" result="k"/><feColorMatrix class="pk-loose" type="matrix" in="SourceGraphic" result="l"/>
      <feMorphology in="k" operator="erode" radius="1" result="e1"/><feMorphology in="k" operator="erode" radius="3.5" result="e3"/>
      <feComposite in="l" in2="e1" operator="in" result="m"/><feMerge result="f"><feMergeNode in="e3"/><feMergeNode in="m"/></feMerge>
      <feGaussianBlur in="f" stdDeviation="0.45" result="b"/><feComposite in="SourceGraphic" in2="b" operator="in"/></filter></svg>`);
    svg = document.getElementById("photo-key-svg");
  }
  const key = (t0, t1) => { const g = 1 / (3 * (t1 - t0)), c = t1 / (t1 - t0); return `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  ${-g} ${-g} ${-g} 0 ${c}`; };
  const t0 = 1 - Math.max(4, VIEW.bgTolerance) / 255, t1 = Math.min(0.995, t0 + 0.06);
  svg.querySelector(".pk-strict").setAttribute("values", key(t0, t1));
  svg.querySelector(".pk-loose").setAttribute("values", key(Math.max(0.3, t0 - 0.37), t0 - 0.01));
}
// Cards and thumbnails follow the viewer background when photo backdrops are hidden.
export function applyPhotoTheme() {
  const b = document.body.classList, bg = currentBg();
  b.toggle("photos-cut", !!VIEW.removeBg);
  b.toggle("photos-light", !!VIEW.removeBg && bg === "light");
  b.toggle("photos-dark", !!VIEW.removeBg && bg === "dark");
  if (VIEW.removeBg) keyFilter();
}
