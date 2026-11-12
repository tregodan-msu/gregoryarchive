// Public viewer for an archive. Field names, labels and views come from the site config.
import { applyPhotoTheme } from "./data.js";
import { addBase, areaMatcher } from "./maps.js";
import { CFG, ROLE, GROUP, NOUN, LINK_PATH, label, titleOf, captionOf, thumbImgs, loadThumbs, loadArchive, thumbUrl, fullUrl, attachFallback,
  getValue, sortKeyFor, DERIVED, uri, boxPhoto, fmtYear, parseYearInput, toCSV, download, esc, fmtN, debounce } from "./data.js";
import { Lightbox } from "./lightbox.js";
import { ChartsView } from "./chartsview.js";

const $ = (s, el = document) => el.querySelector(s);
const VIEWS = (CFG.views || ["gallery", "table", "charts"]).filter((v) => v !== "boxes" || GROUP).filter((v) => v !== "map" || ROLE.geo || CFG.map);
const GROUPABLE = CFG.groupable || [];
const SORT_LIST = CFG.sorts || [["box", "Catalogue order"], ["title", "Title A–Z"]];
const DEF_SORT = SORT_LIST[0][0], DEF_GROUP = GROUP ? GROUP.field : GROUPABLE[0] || "";
const ONE = NOUN.one, MANY = NOUN.many, G_ONE = (GROUP && GROUP.items && GROUP.items[0]) || ONE, G_MANY = (GROUP && GROUP.items && GROUP.items[1]) || MANY, Cap = (w) => w[0].toUpperCase() + w.slice(1);
const SITE_TITLE = CFG.pageTitle || CFG.siteTitle;
const VN = CFG.names || {}; // view names set in the site's editor (Tools → Names of views), saved as sites/<site>/names.json

let DB = null;
let filtered = [];
const S = {
  view: "gallery", mode: "boxes", q: "", f: {}, sy0: null, sy1: null, cy0: null, cy1: null, geo: false,
  sort: DEF_SORT, size: 200, group: DEF_GROUP, id: null, charts: null,
};

// ------------------------------------------------------------------ URL state
function readHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  const slide = h.match(new RegExp("^(?:slide|" + LINK_PATH + ")\\/([\\w.-]+)"));
  if (slide) { S.view = "gallery"; S.id = slide[1]; return; }
  const [view, qs] = location.hash.slice(1).split("?");
  const p = new URLSearchParams(qs || "");
  S.view = view === "board" ? "boxes" : VIEWS.includes(view) ? view : VIEWS[0];
  S.mode = view === "board" ? "board" : p.get("mode") || "boxes";
  S.q = p.get("q") || "";
  S.f = {};
  for (const [k, v] of p) if (k.startsWith("f.")) (S.f[k.slice(2)] ||= new Set()).add(v);
  const yr = (k) => (p.has(k) ? parseInt(p.get(k), 10) : null);
  S.sy0 = yr("sy0"); S.sy1 = yr("sy1"); S.cy0 = yr("cy0"); S.cy1 = yr("cy1");
  S.geo = p.get("geo") === "1";
  S.sort = p.get("sort") || DEF_SORT;
  S.group = p.get("group") || DEF_GROUP;
  S.size = +(p.get("size") || 200);
  S.id = p.get("id");
  S.charts = p.get("charts");
}
function hashString() {
  const p = new URLSearchParams();
  if (S.view === "boxes" && S.mode !== "boxes") p.set("mode", S.mode);
  if (S.q) p.set("q", S.q);
  for (const [k, set] of Object.entries(S.f)) for (const v of set) p.append("f." + k, v);
  for (const k of ["sy0", "sy1", "cy0", "cy1"]) if (S[k] != null) p.set(k, S[k]);
  if (S.geo) p.set("geo", "1");
  if (S.sort !== DEF_SORT) p.set("sort", S.sort);
  if (S.view === "boxes" && S.mode === "board" && S.group !== DEF_GROUP) p.set("group", S.group);
  if (S.size !== 200) p.set("size", S.size);
  if (S.id) p.set("id", S.id);
  if (S.view === "charts" && S.charts) p.set("charts", S.charts);
  const qs = p.toString();
  return "#" + S.view + (qs ? "?" + qs : "");
}
let writingHash = false;
function writeHash(push) {
  const h = hashString();
  if (h === location.hash) return;
  writingHash = true;
  history[push ? "pushState" : "replaceState"](null, "", h);
  writingHash = false;
}

// ------------------------------------------------------------------ filtering
function makeTest(skipFacet) {
  const toks = S.q.toLowerCase().split(/\s+/).filter(Boolean);
  const facets = Object.entries(S.f).filter(([k, s]) => s.size && k !== skipFacet);
  const { sy0, sy1, cy0, cy1, geo } = S;
  return (r) => {
    for (const t of toks) if (!r._text.includes(t)) return false;
    for (const [k, s] of facets) if (!s.has(getValue(r, k))) return false;
    if (sy0 != null || sy1 != null) {
      if (r._sy == null) return false;
      if (sy0 != null && r._ey < sy0) return false;
      if (sy1 != null && r._sy > sy1) return false;
    }
    if (cy0 != null && (r._cy == null || r._cy < cy0)) return false;
    if (cy1 != null && (r._cy == null || r._cy > cy1)) return false;
    if (geo && r._lat == null) return false;
    return true;
  };
}
// Sort keys used in site.json "sorts": box (catalogue order), title, subjOld/subjNew (main date),
// photoOld/photoNew (created date), loc (location), "f:<field>" (A–Z) and "n:<field>" (numeric).
const CF = ROLE.created ? ROLE.created.field : "";
const byText = (f) => (a, b) => (a[f] || "~").localeCompare(b[f] || "~", undefined, { numeric: true });
const byNum = (f) => { const n = (r) => { const v = parseFloat(r[f]); return Number.isFinite(v) ? v : 1e12; }; return (a, b) => n(a) - n(b); };
const SORTS = {
  box: null,
  title: (a, b) => titleOf(a).localeCompare(titleOf(b)),
  subjOld: (a, b) => (a._sy ?? 1e9) - (b._sy ?? 1e9),
  subjNew: (a, b) => (b._sy ?? -1e9) - (a._sy ?? -1e9),
  photoOld: (a, b) => (a._cy ?? 1e9) - (b._cy ?? 1e9) || (a[CF] || "").localeCompare(b[CF] || ""),
  photoNew: (a, b) => (b._cy ?? -1e9) - (a._cy ?? -1e9) || (b[CF] || "").localeCompare(a[CF] || ""),
  loc: byText(ROLE.location),
};
for (const [k] of SORT_LIST) if (!(k in SORTS)) SORTS[k] = k.startsWith("n:") ? byNum(k.slice(2)) : k.startsWith("f:") ? byText(k.slice(2)) : null;
function recompute() {
  filtered = DB.records.filter(makeTest());
  if (SORTS[S.sort]) filtered.sort((a, b) => SORTS[S.sort](a, b) || a._i - b._i);
}
function setFilter(field, value) { S.f[field] = new Set([value]); }

// ------------------------------------------------------------------ filter bar (dropdowns with search)
const MAIN_FILTERS = () => CFG.facetFields.filter((f) => DB.fields.includes(f)).slice(0, 4);
const MORE_FILTERS = () => CFG.facetFields.filter((f) => DB.fields.includes(f)).slice(4);
function renderFilterBar() {
  const btn = (key, label, n) => `<button class="fbtn ${n ? "on" : ""}" data-pop="${esc(key)}">${esc(label)}${n ? `<b>${n}</b>` : ""}<span class="caret">▾</span></button>`;
  const dateN = (S.sy0 != null || S.sy1 != null ? 1 : 0) + (S.cy0 != null || S.cy1 != null ? 1 : 0) + (S.geo ? 1 : 0);
  const more = MORE_FILTERS(), moreN = more.reduce((n, f) => n + (S.f[f]?.size || 0), 0);
  const derivedChips = Object.keys(S.f).filter((f) => !CFG.facetFields.includes(f) && S.f[f].size);
  $("#filters").innerHTML =
    `<span class="flabel">Filter</span>` +
    MAIN_FILTERS().map((f) => btn(f, label(f), S.f[f]?.size || 0)).join("") +
    (DATE_POP ? btn("__dates", DATE_POP, dateN) : "") +
    (more.length ? btn("__more", "More", moreN) : "") +
    derivedChips.map((f) => [...S.f[f]].map((v) => `<button class="chip" data-chip="${esc(f)}" data-v="${esc(v)}">${esc(label(f))}: ${esc(v)}<span>×</span></button>`).join("")).join("") +
    (S.q ? `<button class="chip" data-chip="__q">“${esc(S.q)}”<span>×</span></button>` : "");
  const any = S.q || Object.values(S.f).some((s) => s.size) || dateN;
  $("#clear").hidden = !any;
  $("#count").innerHTML = `<b>${fmtN(filtered.length)}</b> of ${fmtN(DB.records.length)}`;
}

const DATE_POP = [ROLE.date || ROLE.created ? "Dates" : "", ROLE.geo ? "map" : ""].filter(Boolean).join(" & ").replace(/^map$/, "Map");
let popKey = null, popQuery = "";
function openPop(key, anchor) {
  popKey = key; popQuery = "";
  const pop = $("#pop"); pop.hidden = false;
  const b = (anchor || $(`[data-pop="${CSS.escape(key)}"]`)).getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(b.left, innerWidth - 330)) + "px";
  pop.style.top = b.bottom + 6 + "px";
  renderPop(true);
}
function closePop() { popKey = null; $("#pop").hidden = true; }
function renderPop(focus) {
  const pop = $("#pop");
  if (!popKey) return;
  if (popKey === "__dates") {
    pop.innerHTML = `<div class="pop-h">${esc(DATE_POP)}</div>
      ${ROLE.date ? `<label class="pl">${esc(ROLE.date.label || "Date")}</label><div class="range-row"><input id="sy0" placeholder="e.g. 500 BC" value="${S.sy0 != null ? esc(fmtYear(S.sy0)) : ""}"><span>to</span><input id="sy1" placeholder="e.g. 1453" value="${S.sy1 != null ? esc(fmtYear(S.sy1)) : ""}"></div>` : ""}
      ${ROLE.created ? `<label class="pl">${esc(ROLE.created.label || "Year created")}</label><div class="range-row"><input id="cy0" inputmode="numeric" placeholder="1965" value="${S.cy0 ?? ""}"><span>to</span><input id="cy1" inputmode="numeric" placeholder="2023" value="${S.cy1 ?? ""}"></div>` : ""}
      ${ROLE.geo ? `<label class="check"><input type="checkbox" id="geoOnly" ${S.geo ? "checked" : ""}> Only ${MANY} with a map location</label>` : ""}
      <div class="pop-f"><button class="link" data-popclear>Clear</button><button class="btn primary" data-popapply>Apply</button></div>`;
    if (focus) pop.querySelector("input")?.focus();
    return;
  }
  if (popKey === "__more") {
    pop.innerHTML = `<div class="pop-h">More filters</div>` + MORE_FILTERS().map((f) => `<button class="pop-item" data-pop-go="${esc(f)}"><span>${esc(label(f))}</span>${S.f[f]?.size ? `<b>${S.f[f].size}</b>` : "<i>›</i>"}</button>`).join("");
    return;
  }
  const field = popKey, t = makeTest(field), counts = new Map();
  for (const r of DB.records) if (t(r)) { const v = getValue(r, field); if (v) counts.set(v, (counts.get(v) || 0) + 1); }
  const sel = S.f[field] || new Set();
  const sk = sortKeyFor(field);
  let items = [...counts];
  items.sort(GROUP && field === GROUP.field && sk ? (a, b) => sk(a[0]) - sk(b[0]) || a[0].localeCompare(b[0]) : (a, b) => b[1] - a[1]);
  for (const v of sel) if (!counts.has(v)) items.unshift([v, 0]);
  const q = popQuery.toLowerCase();
  const shown = (q ? items.filter(([v]) => v.toLowerCase().includes(q)) : items);
  const selFirst = shown.filter(([v]) => sel.has(v)).concat(shown.filter(([v]) => !sel.has(v)));
  const list = selFirst.slice(0, 300);
  if (!pop.querySelector(".pop-q") || pop.dataset.field !== field) {
    pop.dataset.field = field;
    pop.innerHTML = `<div class="pop-h">${esc(label(field))}<span>${fmtN(counts.size)} values</span></div>
      <input class="pop-q" placeholder="Search ${esc(label(field).toLowerCase())}…" autocomplete="off">
      <ul class="pop-list"></ul>
      <div class="pop-f"><button class="link" data-popclear>Clear</button><span class="muted small pop-n"></span></div>`;
    if (focus) pop.querySelector(".pop-q").focus();
  }
  pop.querySelector(".pop-list").innerHTML = list.map(([v, n]) => `<li><label><input type="checkbox" value="${esc(v)}" ${sel.has(v) ? "checked" : ""}><span class="fv">${esc(v)}</span><span class="fn">${fmtN(n)}</span></label></li>`).join("") || `<li class="muted small">No matches</li>`;
  pop.querySelector(".pop-n").textContent = shown.length > 300 ? `Showing 300 of ${fmtN(shown.length)} — search to narrow` : sel.size ? `${sel.size} selected` : "";
}
function bindPop() {
  const pop = $("#pop");
  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pop]");
    if (b) { e.stopPropagation(); popKey === b.dataset.pop ? closePop() : openPop(b.dataset.pop, b); return; }
    const c = e.target.closest("[data-chip]");
    if (c) { if (c.dataset.chip === "__q") S.q = ""; else { S.f[c.dataset.chip].delete(c.dataset.v); if (!S.f[c.dataset.chip].size) delete S.f[c.dataset.chip]; } update(); }
  });
  pop.addEventListener("click", (e) => {
    e.stopPropagation();
    const go = e.target.closest("[data-pop-go]");
    if (go) { const anchor = $('[data-pop="__more"]'); popKey = null; openPop(go.dataset.popGo, anchor); return; }
    if (e.target.closest("[data-popclear]")) {
      if (popKey === "__dates") Object.assign(S, { sy0: null, sy1: null, cy0: null, cy1: null, geo: false });
      else delete S.f[popKey];
      update(); renderPop(); return;
    }
    if (e.target.closest("[data-popapply]")) {
      const v = (id) => ($("#" + id, pop) || {}).value;
      S.sy0 = parseYearInput(v("sy0")); S.sy1 = parseYearInput(v("sy1"));
      S.cy0 = parseInt(v("cy0"), 10) || null; S.cy1 = parseInt(v("cy1"), 10) || null;
      S.geo = !!($("#geoOnly", pop) || {}).checked; closePop(); update();
    }
  });
  pop.addEventListener("change", (e) => {
    const cb = e.target.closest(".pop-list input[type=checkbox]"); if (!cb) return;
    const set = (S.f[popKey] ||= new Set());
    cb.checked ? set.add(cb.value) : set.delete(cb.value);
    if (!set.size) delete S.f[popKey];
    update(); renderPop();
  });
  pop.addEventListener("input", debounce((e) => { if (e.target.matches(".pop-q")) { popQuery = e.target.value; renderPop(); } }, 120));
  pop.addEventListener("keydown", (e) => { if (e.key === "Enter" && popKey === "__dates") pop.querySelector("[data-popapply]").click(); if (e.key === "Escape") closePop(); });
  document.addEventListener("click", (e) => { if (!popKey) return; if (!e.target.closest("#pop") && !e.target.closest("[data-pop]")) closePop(); });
  addEventListener("resize", () => closePop());
}

function syncInputs() {
  $("#q").value = S.q;
  $("#sort").value = S.sort; $("#size").value = S.size;
  document.querySelectorAll("#views a").forEach((a) => a.classList.toggle("on", a.dataset.v === S.view));
  $("#sizeCtl").hidden = S.view !== "gallery";
  $("#sortCtl").hidden = !["gallery", "table", "boxes"].includes(S.view);
}

// ------------------------------------------------------------------ update cycle
let currentView = null;
function update({ push = false, keepScroll = false } = {}) {
  recompute();
  syncInputs(); renderFilterBar();
  writeHash(push);
  renderView(keepScroll);
}
function renderView(keepScroll) {
  const view = $("#view");
  if (currentView && currentView.destroy) currentView.destroy();
  view.className = "view view-" + S.view;
  currentView = ({ gallery: Gallery, boxes: Boxes, table: Table, map: MapView, charts: Charts })[S.view](view, keepScroll);
}
function openRecord(list, idx) { S.id = list[idx]._id; writeHash(); lb.open(list, idx); }
const lb = new Lightbox({
  onFilter: (field, value) => { S.f = { [field]: new Set([value]) }; S.id = null; S.view = S.view === "charts" ? "gallery" : S.view; update({ push: true }); },
  onClose: () => { S.id = null; writeHash(); document.title = SITE_TITLE; },
  onIndex: (r) => { S.id = r._id; writeHash(); document.title = `${titleOf(r)} — ${CFG.siteTitle}`; },
});
function empty() {
  return `<div class="empty"><h3>No ${MANY} match</h3><p>Try removing a filter or searching for something broader.</p><button class="btn" onclick="document.getElementById('clear').click()">Clear all filters</button></div>`;
}

// ------------------------------------------------------------------ Gallery (virtualized)
function Gallery(root, keepScroll, list = filtered) {
  const prev = keepScroll ? Gallery.scroll || 0 : 0;
  root.innerHTML = list.length ? `<div class="vscroll"><div class="vinner"></div></div>` : empty();
  if (!list.length) return {};
  const sc = $(".vscroll", root), inner = $(".vinner", root), live = new Map();
  const GAP = 14, CAP = 52;
  let cols, cw, ch;
  const layout = () => {
    const w = sc.clientWidth - GAP;
    cols = Math.max(1, Math.floor(w / (S.size + GAP)));
    cw = (w - GAP * cols) / cols; ch = cw * 0.78 + CAP;
    inner.style.height = Math.ceil(list.length / cols) * (ch + GAP) + GAP + "px";
    for (const [, el] of live) el.remove(); live.clear(); draw();
  };
  const draw = () => {
    const top = sc.scrollTop, h = sc.clientHeight;
    const r0 = Math.max(0, Math.floor(top / (ch + GAP)) - 2), r1 = Math.ceil((top + h) / (ch + GAP)) + 2;
    const i0 = r0 * cols, i1 = Math.min(list.length, r1 * cols);
    for (const [i, el] of live) if (i < i0 || i >= i1) { el.remove(); live.delete(i); }
    const frag = document.createDocumentFragment();
    for (let i = i0; i < i1; i++) {
      if (live.has(i)) continue;
      const r = list[i], el = document.createElement("button");
      el.className = "card"; el.dataset.i = i;
      el.style.cssText = `left:${GAP + (i % cols) * (cw + GAP)}px;top:${GAP + Math.floor(i / cols) * (ch + GAP)}px;width:${cw}px;height:${ch}px`;
      el.innerHTML = `<div class="thumb${CFG.cardPair ? " pair" : ""}">${thumbImgs(r)}</div><div class="cap"><b>${esc(titleOf(r))}</b><small>${esc(captionOf(r))}</small></div>`;
      loadThumbs(el, r, (img) => img.classList.add("in"));
      live.set(i, el); frag.appendChild(el);
    }
    inner.appendChild(frag);
  };
  let raf = 0;
  sc.addEventListener("scroll", () => { Gallery.scroll = sc.scrollTop; if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }, { passive: true });
  inner.addEventListener("click", (e) => { const c = e.target.closest(".card"); if (c) openRecord(list, +c.dataset.i); });
  const ro = new ResizeObserver(layout); ro.observe(sc);
  layout(); sc.scrollTop = prev;
  return { destroy: () => ro.disconnect() };
}

// ------------------------------------------------------------------ Slide Boxes: box overview + board
function groupRecords(field) {
  const groups = new Map();
  for (const r of filtered) { const v = getValue(r, field) || "(blank)"; (groups.get(v) || groups.set(v, []).get(v)).push(r); }
  const sk = sortKeyFor(field);
  const keys = [...groups.keys()].sort(sk ? (a, b) => sk(a) - sk(b) || a.localeCompare(b) : (a, b) => groups.get(b).length - groups.get(a).length);
  return { groups, keys };
}
// "group": {"map": true} adds a Map tab beside the area cards (needs "map" in site.json).
const GROUP_MAP = !!(GROUP && GROUP.map && CFG.map);
function Boxes(root) {
  if (S.mode === "map" && !GROUP_MAP) S.mode = "boxes";
  const seg = (m, t) => `<button data-mode="${m}" class="${S.mode === m ? "on" : ""}">${esc(t)}</button>`;
  const head = `<div class="subbar"><div class="seg">${seg("boxes", VN.tabGroups || GROUP.tab || GROUP.nav)}${GROUP_MAP ? seg("map", VN.tabMap || "Map") : ""}${seg("board", VN.tabBoard || "Board")}</div>
    ${S.mode === "board" ? `<label class="ctl">Group by <select id="group">${GROUPABLE.map((g) => `<option value="${esc(g)}" ${g === S.group ? "selected" : ""}>${esc(label(g))}</option>`).join("")}</select></label>` : `<span class="muted small">${esc(S.mode === "map" ? `Each pin is a ${GROUP.one || "place"}, sized by how many ${MANY} match. Click one to see them.` : GROUP.hint || "")}</span>`}</div>`;
  if (S.mode === "map") {
    root.innerHTML = head + `<div class="mapbox"></div>`;
    bindSub(root);
    return AreaMap($(".mapbox", root));
  }
  if (!filtered.length) { root.innerHTML = head + empty(); bindSub(root); return {}; }
  const r = S.mode === "board" ? Board(root, head) : BoxGrid(root, head);
  bindSub(root);
  return r;
}
function bindSub(root) {
  root.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => { S.mode = b.dataset.mode; update({ push: true }); }));
  const g = $("#group", root); if (g) g.onchange = (e) => { S.group = e.target.value; update(); };
}
const boxParts = (k) => { if (!GROUP.numbered) return ["", k]; const mm = k.match(/^\s*(\d+[A-Za-z]?)\s+(.*)$/); return mm ? [mm[1], mm[2]] : ["", k]; };
function BoxGrid(root, head) {
  const { groups, keys } = groupRecords(GROUP.field);
  root.innerHTML = head + `<div class="boxscroll"><div class="boxgrid">${keys.map((k, i) => {
    const list = groups.get(k), [num, name] = boxParts(k);
    return `<button class="boxcard" data-b="${i}">
      <div class="boxcover"><img class="boxphoto" loading="lazy" alt="${esc(k)}" data-box="${i}"></div>
      <div class="boxstrip">${list.slice(0, 4).map((_, j) => `<img loading="lazy" data-r="${j}" alt="">`).join("")}</div>
      <div class="boxlabel"><b>${num ? `<span class="boxtag">${esc(num)}</span>` : ""}${esc(name)}</b><small>${fmtN(list.length)} ${list.length === 1 ? G_ONE : G_MANY}</small></div>
    </button>`;
  }).join("")}</div></div>`;
  root.querySelectorAll(".boxcard").forEach((card) => {
    const k = keys[+card.dataset.b], list = groups.get(k);
    card.querySelectorAll("img[data-r]").forEach((im) => { const r = list[+im.dataset.r]; attachFallback(im, r); im.src = thumbUrl(r); });
    const photo = card.querySelector(".boxphoto");
    // no box photo yet -> show a 2x2 mosaic of the box's slides instead
    photo.onerror = () => { const c = photo.parentElement; c.classList.add("mosaic"); card.classList.add("nophoto"); c.innerHTML = list.slice(0, 4).map(() => "<img alt=''>").join(""); c.querySelectorAll("img").forEach((im, j) => { attachFallback(im, list[j]); im.src = thumbUrl(list[j]); }); };
    const src = boxPhoto(k, true); src ? (photo.src = src) : photo.onerror();
  });
  $(".boxgrid", root).onclick = (e) => { const c = e.target.closest(".boxcard"); if (!c) return; setFilter(GROUP.field, keys[+c.dataset.b]); S.view = "gallery"; update({ push: true }); };
  return {};
}
function Board(root, head) {
  const { groups, keys } = groupRecords(S.group);
  const PAGE = 30;
  root.innerHTML = head + `<div class="board">${keys.map((k, ci) => `
    <section class="col" data-c="${ci}">
      <header>${S.group === GROUP.field && GROUP.photos ? `<img class="colphoto" alt="" data-cp="${ci}">` : ""}<div class="colt"><h3 title="${esc(k)}">${S.group === GROUP.field && boxParts(k)[0] ? `<span class="boxtag">${esc(boxParts(k)[0])}</span>${esc(boxParts(k)[1])}` : esc(k)}</h3><span>${fmtN(groups.get(k).length)} ${S.group === GROUP.field ? G_MANY : MANY} · <button class="link" data-only="${ci}" title="Open these in the gallery">Open</button></span></div></header>
      <div class="col-body" data-n="0"></div>
    </section>`).join("")}</div>`;
  const fill = (body, ci) => {
    const list = groups.get(keys[ci]), n = +body.dataset.n, end = Math.min(list.length, n + PAGE);
    body.querySelector(".more")?.remove();
    const frag = document.createDocumentFragment();
    for (let i = n; i < end; i++) {
      const r = list[i], el = document.createElement("button");
      el.className = "kcard"; el.dataset.c = ci; el.dataset.i = i;
      el.innerHTML = (CFG.cardPair ? `<div class="kthumb">${thumbImgs(r)}</div>` : thumbImgs(r)) + `<b>${esc(titleOf(r))}</b><small>${esc(captionOf(r, ROLE.boardCaption))}</small>`;
      el.querySelectorAll("img").forEach((im) => (im.loading = "lazy")); loadThumbs(el, r);
      frag.appendChild(el);
    }
    if (end < list.length) { const m = document.createElement("button"); m.className = "more btn ghost"; m.textContent = `Show more (${fmtN(list.length - end)} left)`; frag.appendChild(m); }
    body.appendChild(frag); body.dataset.n = end;
  };
  root.querySelectorAll("img[data-cp]").forEach((im) => { const k = keys[+im.dataset.cp]; im.onerror = () => { const r = groups.get(k)[0]; im.onerror = () => im.remove(); im.src = thumbUrl(r); }; im.src = boxPhoto(k, true); });
  const board = $(".board", root);
  const io = new IntersectionObserver((ents) => ents.forEach((e) => {
    if (e.isIntersecting) { io.unobserve(e.target); fill(e.target.querySelector(".col-body"), +e.target.dataset.c); }
  }), { root: board, rootMargin: "0px 600px" });
  root.querySelectorAll(".col").forEach((c) => io.observe(c));
  // each column scrolls on its own; load more slides as it nears the bottom
  root.querySelectorAll(".col-body").forEach((body) => body.addEventListener("scroll", () => {
    if (body.querySelector(".more") && body.scrollTop + body.clientHeight > body.scrollHeight - 400) fill(body, +body.closest(".col").dataset.c);
  }, { passive: true }));
  board.onclick = (e) => {
    const k = e.target.closest(".kcard");
    if (k) return openRecord(groups.get(keys[+k.dataset.c]), +k.dataset.i);
    const m = e.target.closest(".more");
    if (m) return fill(m.parentElement, +m.closest(".col").dataset.c);
    const o = e.target.closest("[data-only]");
    if (o) { const v = keys[+o.dataset.only]; if (v === "(blank)") return; setFilter(S.group, v); S.view = "gallery"; update({ push: true }); }
  };
  return { destroy: () => io.disconnect() };
}

// ------------------------------------------------------------------ Table
const TABLE_COLS = (CFG.table && CFG.table.cols) || ["ID", ROLE.title, "URI"];
const TCOL_W = Object.assign({ ID: 92, URI: 330 }, (CFG.table && CFG.table.widths) || {});
function cell(r, c) {
  if (c === "ID") return esc(r._id);
  if (c === "URI") { const u = uri(r); return `<a href="${esc(u)}" target="_blank" rel="noopener" data-stop>${esc(u)}</a>`; }
  return esc(r[c]);
}
function Table(root) {
  if (!filtered.length) { root.innerHTML = empty(); return {}; }
  const cols = TABLE_COLS.filter((c) => c === "ID" || c === "URI" || DB.fields.includes(c));
  const RH = 46, width = 64 + cols.reduce((s, c) => s + (TCOL_W[c] || 140), 0);
  root.innerHTML = `<div class="tscroll"><table class="grid" style="width:${width}px"><colgroup><col style="width:64px">${cols.map((c) => `<col style="width:${TCOL_W[c] || 140}px">`).join("")}</colgroup><thead><tr><th class="tc-img"></th>${cols.map((c) => `<th>${esc(label(c))}</th>`).join("")}</tr></thead><tbody></tbody></table></div>`;
  const sc = $(".tscroll", root), tb = $("tbody", root);
  const draw = () => {
    const i0 = Math.max(0, Math.floor(sc.scrollTop / RH) - 10), i1 = Math.min(filtered.length, i0 + Math.ceil(sc.clientHeight / RH) + 20);
    let h = `<tr style="height:${i0 * RH}px"></tr>`;
    for (let i = i0; i < i1; i++) {
      const r = filtered[i];
      h += `<tr data-i="${i}"><td class="tc-img"><img loading="lazy" alt="" data-r="${i}"></td>${cols.map((c) => `<td title="${esc(c === "URI" ? uri(r) : c === "ID" ? r._id : r[c])}">${cell(r, c)}</td>`).join("")}</tr>`;
    }
    h += `<tr style="height:${(filtered.length - i1) * RH}px"></tr>`;
    tb.innerHTML = h;
    tb.querySelectorAll("img").forEach((im) => { const r = filtered[+im.dataset.r]; attachFallback(im, r); im.src = thumbUrl(r); });
  };
  let raf = 0;
  sc.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }, { passive: true });
  tb.addEventListener("click", (e) => { if (e.target.closest("[data-stop]")) return; const tr = e.target.closest("tr[data-i]"); if (tr) openRecord(filtered, +tr.dataset.i); });
  draw();
  return {};
}

// ------------------------------------------------------------------ Map
// Map of named areas: one marker per area, sized by how many matching records it holds, labelled with the area's name.
// Area positions live in the combined site's places.json and are set in an archive's editor (Tools → Area pins on the map).
// A source archive ("map": {"from": "isthmia", "field": "Region"}) maps its own place names onto those labels with
// the shared areas.json, so "East Field Hoard" counts towards East Field and "Tower 10 (Loukos)" towards Tower 10.
const AREA_OF = areaMatcher(CFG.areas);
function AreaMap(root) {
  const M = CFG.map, field = M.field || GROUP.field;
  const places = CFG.places || {};
  const areas = new Map(); // label -> { list, raw: Set of the field's values, by: {sub-place or archive: n} }
  for (const r of filtered) {
    const v = r[field]; if (!v || /^\s*unknown\s*$/i.test(v)) continue;
    const a = AREA_OF(v) || v;
    let c = areas.get(a); if (!c) areas.set(a, (c = { list: [], raw: new Set(), by: {} }));
    c.list.push(r); c.raw.add(v);
    const sub = r.Archive || v;
    c.by[sub] = (c.by[sub] || 0) + 1;
  }
  const names = [...new Set([...areas.keys(), ...Object.keys(places)])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  root.innerHTML = `<div class="mapwrap"><div id="map"></div><div class="map-note"></div></div>`;
  if (!window.L) { $(".map-note", root).textContent = "Map library is still loading… switch views and back in a moment."; return {}; }
  const map = L.map($("#map", root), { maxZoom: 22 }).setView(M.center || [37.9166, 22.9932], M.zoom || 17);
  addBase(map, M);
  const group = L.layerGroup().addTo(map), accent = (CFG.theme && CFG.theme.accent) || "#9a4f24";
  const placed = names.filter((n) => places[n]);
  const unplaced = names.filter((n) => !places[n] && areas.get(n));
  const lost = unplaced.reduce((t, n) => t + areas.get(n).list.length, 0);
  const noArea = filtered.length - [...areas.values()].reduce((t, c) => t + c.list.length, 0);
  $(".map-note", root).innerHTML = `${fmtN(placed.length)} of ${fmtN(names.length)} areas are on the map` +
    (lost ? ` · <span title="${esc(unplaced.join(", "))}">${fmtN(lost)} matching ${lost === 1 ? ONE : MANY} in areas not placed yet</span>` : "") +
    (noArea ? ` · ${fmtN(noArea)} with no area recorded` : "");
  // breakdown by archive (combined site) or by the place names recorded (e.g. Theater Court, Theater Orchestra); hidden when it would just repeat the area
  const by = (c, n) => { const e = Object.entries(c.by).sort((a, b) => b[1] - a[1]); return e.length > 1 || (e[0] && e[0][0] !== n) ? e : []; };
  for (const n of placed) {
    const c = areas.get(n) || { list: [], by: {} }, k = c.list.length;
    const m = L.circleMarker(places[n], { radius: Math.max(7, Math.min(34, 5 + Math.sqrt(k) * 1.6)), weight: 2, color: "#fff", fillColor: accent, fillOpacity: k ? 0.9 : 0.35 });
    m.bindTooltip(`${esc(n)}${k ? ` · ${fmtN(k)}` : ""}`, { permanent: true, direction: "top", className: "map-label" + (k ? "" : " empty"), offset: [0, -8] });
    m.bindPopup(() => `<div class="mpop area"><b>${esc(n)}</b><small>${k ? `${fmtN(k)} ${k === 1 ? ONE : MANY}` : "No matching " + MANY}</small>
      ${k ? `<div class="mpop-strip">${c.list.slice(0, 4).map((_, j) => `<img alt="" data-area-r="${esc(n)}" data-j="${j}">`).join("")}</div>` : ""}
      ${by(c, n).length ? `<ul class="mpop-by">${by(c, n).slice(0, 6).map(([s, v]) => `<li><span>${esc(s)}</span><i>${fmtN(v)}</i></li>`).join("")}${by(c, n).length > 6 ? `<li class="muted">+ ${by(c, n).length - 6} more</li>` : ""}</ul>` : ""}
      ${k ? `<button class="btn primary" data-area="${esc(n)}">Show ${k === 1 ? "this " + ONE : `these ${fmtN(k)} ${MANY}`}</button>` : ""}</div>`, { minWidth: 230, maxWidth: 280 });
    group.addLayer(m);
  }
  map.on("popupopen", (e) => e.popup.getElement().querySelectorAll("img[data-area-r]").forEach((im) => {
    const r = areas.get(im.dataset.areaR).list[+im.dataset.j]; attachFallback(im, r); im.src = thumbUrl(r);
  }));
  root.onclick = (e) => {
    const im = e.target.closest("img[data-area-r]");
    if (im) return openRecord(areas.get(im.dataset.areaR).list, +im.dataset.j);
    const t = e.target.closest("[data-area]");
    if (t) { S.f[field] = new Set(areas.get(t.dataset.area).raw); S.view = "gallery"; update({ push: true }); }
  };
  const pts = placed.map((n) => places[n]);
  if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 19 });
  return { destroy: () => map.remove() };
}

function MapView(root) {
  if (CFG.map && CFG.map.areas) return AreaMap(root);
  const pts = filtered.filter((r) => r._lat != null);
  root.innerHTML = `<div class="mapwrap"><div id="map"></div><div class="map-note">${fmtN(pts.length)} of ${fmtN(filtered.length)} matching ${MANY} have a map location${pts.length < filtered.length ? " · add coordinates in the editor to place more" : ""}.</div></div>`;
  if (!window.L) { $(".map-note", root).textContent = "Map library is still loading… switch views and back in a moment."; return {}; }
  const map = L.map($("#map", root), { worldCopyJump: true, maxZoom: 22 }).setView([38.5, 24], 5);
  addBase(map);
  const cluster = L.markerClusterGroup ? L.markerClusterGroup({ maxClusterRadius: 45 }) : L.layerGroup();
  pts.forEach((r, k) => {
    const m = L.circleMarker([r._lat, r._lng], { radius: 6, weight: 2, color: "#fff", fillColor: (CFG.theme && CFG.theme.accent) || "#9a4f24", fillOpacity: 0.95 });
    m.bindPopup(() => `<div class="mpop"><img src="${esc(thumbUrl(r))}" alt=""><b>${esc(titleOf(r))}</b><small>${esc(r[ROLE.location] || "")}</small><button class="btn" data-pk="${k}">Open</button></div>`, { minWidth: 220 });
    cluster.addLayer(m);
  });
  map.addLayer(cluster);
  if (pts.length) map.fitBounds(L.latLngBounds(pts.map((r) => [r._lat, r._lng])).pad(0.2), { maxZoom: 12 });
  root.onclick = (e) => { const b = e.target.closest("[data-pk]"); if (b) openRecord(pts, +b.dataset.pk); };
  return { destroy: () => map.remove() };
}

// ------------------------------------------------------------------ Charts
let chartsView = null;
function Charts(root) {
  chartsView ||= new ChartsView({
    get records() { return filtered; },
    get fields() { return DB.fields; },
    openRecords: (list, i) => openRecord(list, i),
    applyFilter: (pairs) => { for (const [f, v] of pairs) setFilter(f, v); S.view = "gallery"; update({ push: true }); },
    filterSummary: () => describeFilters(),
    setHashCharts: (encoded) => { S.charts = encoded; writeHash(); },
    initialHash: S.charts,
  });
  chartsView.mount(root);
  return { destroy: () => chartsView.unmount() };
}
function describeFilters() {
  const parts = [];
  if (S.q) parts.push(`search “${S.q}”`);
  for (const [k, set] of Object.entries(S.f)) if (set.size) parts.push(`${label(k)}: ${[...set].join(", ")}`);
  if (S.sy0 != null || S.sy1 != null) parts.push(`${(ROLE.date && ROLE.date.label || "date").toLowerCase()} ${S.sy0 != null ? fmtYear(S.sy0) : "…"}–${S.sy1 != null ? fmtYear(S.sy1) : "…"}`);
  if (S.cy0 != null || S.cy1 != null) parts.push(`${(ROLE.created && ROLE.created.label || "created").toLowerCase()} ${S.cy0 ?? "…"}–${S.cy1 ?? "…"}`);
  if (S.geo) parts.push("with map location");
  return parts.join(" · ") || "All " + MANY;
}

// ------------------------------------------------------------------ events
// header, view tabs and sort menu from the site config
function chrome() {
  document.title = SITE_TITLE;
  const story = $("#story");
  if (CFG.storyUrl) { story.href = CFG.storyUrl; if (CFG.storyLabel) story.textContent = CFG.storyLabel; } else story.hidden = true;
  const NAMES = { gallery: VN.gallery || "Gallery", boxes: VN.boxes || (GROUP ? GROUP.nav : ""), table: VN.table || "Table", map: VN.map || "Map", charts: VN.charts || "Charts" };
  $("#views").innerHTML = VIEWS.map((v) => `<a data-v="${v}" href="#${v}">${esc(NAMES[v])}</a>`).join("");
  $("#sort").innerHTML = SORT_LIST.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join("");
  if (CFG.searchPlaceholder) $("#q").placeholder = CFG.searchPlaceholder;
}
function bind() {
  chrome(); applyPhotoTheme();
  $("#q").addEventListener("input", debounce((e) => { S.q = e.target.value.trim(); update(); }, 180));
  $("#sort").onchange = (e) => { S.sort = e.target.value; update(); };
  $("#size").oninput = debounce((e) => { S.size = +e.target.value; writeHash(); renderView(true); }, 60);
  $("#views").onclick = (e) => { const a = e.target.closest("a[data-v]"); if (!a) return; e.preventDefault(); S.view = a.dataset.v; S.id = null; update({ push: true }); };
  $("#brand").onclick = (e) => { e.preventDefault(); $("#clear").click(); };
  $("#clear").onclick = () => { Object.assign(S, { q: "", f: {}, sy0: null, sy1: null, cy0: null, cy1: null, geo: false }); update({ push: true }); };
  bindPop();
  $("#exportBtn").onclick = (e) => { e.stopPropagation(); $("#exportMenu").hidden = !$("#exportMenu").hidden; };
  document.addEventListener("click", () => ($("#exportMenu").hidden = true));
  $("#exportMenu").onclick = async (e) => {
    const x = e.target.closest("[data-x]")?.dataset.x;
    const name = CFG.exportName || CFG.key || "archive", urlFields = new Set(ROLE.images.map((im) => im.urlField).filter(Boolean));
    if (x === "csv") download(name + ".csv", toCSV(filtered, DB.fields.filter((f) => !urlFields.has(f))));
    if (x === "json") download(name + ".json", JSON.stringify(filtered.map((r) => { const o = { ID: r._id, URI: uri(r) }; for (const f of DB.fields) if (r[f]) o[f] = r[f]; ROLE.images.forEach((im, k) => { const u = fullUrl(r, k); if (u) o[(ROLE.images.length > 1 ? (im.label || "Image " + (k + 1)) + " " : "Image ") + "URL"] = u; }); return o; }), null, 1), "application/json");
    if (x === "link") { try { await navigator.clipboard.writeText(location.href); } catch {} }
  };
  addEventListener("hashchange", () => { if (writingHash) return; readHash(); update(); openFromHash(); });
  addEventListener("popstate", () => { readHash(); update(); openFromHash(); });
}
function openFromHash() {
  if (!S.id) return lb.close();
  let i = filtered.findIndex((r) => r._id === S.id);
  if (i < 0) { const r = DB.records.find((x) => x._id === S.id); if (!r) return; return lb.open([r], 0); }
  lb.open(filtered, i);
}

(async function main() {
  readHash(); bind();
  try { DB = await loadArchive(); }
  catch (e) { $("#view").innerHTML = `<div class="empty"><h3>Couldn’t load the archive</h3><p>${esc(e.message)}</p></div>`; return; }
  update();
  openFromHash();
})();
