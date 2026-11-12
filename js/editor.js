// Archive editor: spreadsheet-style editing on top of the site's Google Sheet.
// Columns, issue checks and upload fields come from "editor" in site.json.
import { VIEW, VIEW_DEFAULTS, applyPhotoTheme } from "./data.js";
import { addBase } from "./maps.js";
import { CFG, ROLE, GROUP, NOUN, label, loadArchive, indexRecords, thumbUrl, mediumUrl, fullUrl, attachFallback, esc, fmtN, debounce, download } from "./data.js";
import { Lightbox } from "./lightbox.js";
import { putJson } from "./gate.js";

const $ = (s, el = document) => el.querySelector(s);
const ED = CFG.editor || {};
const LSP = (CFG.storageKey || CFG.key || "ga") + "-ed-";
const IMG = ROLE.images[0] || {}, FILE = IMG.field || "", URLF = IMG.urlField || "", GF = GROUP ? GROUP.field : "";
const LS = {
  get(k, d) { try { const v = localStorage.getItem(LSP + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(LSP + k, JSON.stringify(v)); } catch {} },
};

// ------------------------------------------------------------------ state
const settings = Object.assign({ url: CFG.appsScriptUrl || "", key: "", name: "" }, LS.get("settings", {}));
let mode = "demo";                 // "demo" (static data, nothing saved to Sheet) | "live"
let fields = [];                   // Sheet headers (minus ID)
let records = [], byId = new Map();
let view = [];                     // filtered records
let pending = new Map(LS.get("pending", []));   // id -> {field: value}
let original = new Map(LS.get("original", []));  // id -> {field: value before edit}
const selected = new Set();
let active = { r: 0, c: 0 };       // active cell (row index in view, column index in cols)
let currentId = null;              // record open in the side form
let filter = { q: "", box: "", issue: "" };

const DEFAULT_COLS = ED.defaultCols || [];
let cols = LS.get("cols", null);
const WIDTH = ED.widths || {};
const CATEGORICAL = new Set(ED.categorical || []);
const TEXTAREA = new Set(ED.textarea || [ROLE.title]);
const READONLY = new Set(["ID", ROLE.id]);

const val = (r, f) => { const p = pending.get(r._id); return p && f in p ? p[f] : r[f] ?? ""; };
const isDirty = (r, f) => { const p = pending.get(r._id); return !!(p && f in p); };

// ------------------------------------------------------------------ data-quality checks (on raw Sheet data)
// "editor.issues" in site.json lists which checks to show: "missing:<field>", "no-geo", "bad-geo",
// "dup-file", "no-image", "shifted" and "header-row" (Gregory clean-up), "edited" (always added).
const GEO_RE = /^\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*$/;
const ISSUE_DEFS = {
  "no-geo": ["No map coordinates", (r) => !GEO_RE.test(val(r, ROLE.geo))],
  "bad-geo": [`${label(ROLE.geo)} isn’t coordinates`, (r) => { const g = val(r, ROLE.geo); return g && !GEO_RE.test(g); }],
  "dup-file": ["Duplicate file name", (r) => dupFiles.has(val(r, FILE))],
  "shifted": ["Columns shifted (Medium = “35mm”)", (r) => val(r, "Medium") === "35mm"],
  "header-row": ["Pasted header row", (r) => val(r, ROLE.title) === ROLE.title && (!GF || val(r, GF) === GF)],
  "no-image": ["No image", (r) => ROLE.images.every((im) => !val(r, im.field) && !(im.urlField && val(r, im.urlField)))],
};
const ISSUES = (ED.issues || []).map((k) => {
  if (k.startsWith("missing:")) { const f = k.slice(8); return ["missing-" + f, "Missing " + label(f).toLowerCase(), (r) => !String(val(r, f)).trim()]; }
  return ISSUE_DEFS[k] ? [k, ...ISSUE_DEFS[k]] : null;
}).filter(Boolean).concat([["edited", "Edited, not saved", (r) => pending.has(r._id)]]);
let dupFiles = new Set();
function computeDups() {
  const c = new Map();
  for (const r of records) { const f = FILE && val(r, FILE); if (f) c.set(f, (c.get(f) || 0) + 1); }
  dupFiles = new Set([...c].filter(([, n]) => n > 1).map(([f]) => f));
}

// ------------------------------------------------------------------ backend
async function api(action, payload = {}) {
  if (!settings.url) throw new Error("No Apps Script URL set (⚙ settings).");
  const res = await fetch(settings.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ key: settings.key, editor: settings.name, action, ...payload }) });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function load() {
  $("#count").textContent = "Loading…";
  if (settings.url && settings.key) {
    try {
      const d = await api("list");
      const idCol = d.headers.indexOf(ROLE.id);
      fields = d.headers.filter((h) => h && h !== "ID");
      records = d.rows.map((row, i) => {
        const r = {}; d.headers.forEach((h, j) => { if (h) r[h] = row[j]; });
        r._id = idCol >= 0 && row[idCol] ? row[idCol] : "r" + (i + 2); r._row = i + 2; r._i = i; return r;
      });
      mode = "live";
      if (idCol < 0) toast(`Tip: run “Add / fill record IDs” from the Sheet’s ${CFG.siteTitle} menu so edits survive row moves.`, 7000);
    } catch (e) {
      toast("Couldn’t reach the Sheet: " + e.message + " — showing demo data.", 7000);
    }
  }
  if (mode !== "live") {
    const db = await loadArchive();
    fields = db.fields; records = db.records;
    records.forEach((r) => { r._id = String(r._id); if (URLF && !r[URLF]) r[URLF] = fullUrl(r); });
  }
  byId = new Map(records.map((r) => [r._id, r]));
  // drop pending edits for records that no longer exist
  for (const id of [...pending.keys()]) if (!byId.has(id)) { pending.delete(id); original.delete(id); }
  indexRecords(records, fields);
  if (!cols) cols = DEFAULT_COLS.filter((c) => fields.includes(c));
  cols = cols.filter((c) => fields.includes(c));
  computeDups();
  $("#conn").textContent = mode === "live" ? "● Connected to Sheet" : "Demo mode · not saving";
  $("#conn").className = "conn " + mode;
  $("#publishBtn").hidden = mode !== "live";
  $("#boxSel").hidden = $("#boxHead").hidden = !GF;
  const boxes = GF ? [...new Set(records.map((r) => r[GF]).filter(Boolean))].sort((a, b) => (parseInt(a) || 1e6) - (parseInt(b) || 1e6) || a.localeCompare(b)) : [];
  $("#boxSel").innerHTML = `<option value="">All ${esc((GROUP && GROUP.plural) || "")} (${boxes.length})</option>` + boxes.map((b) => `<option>${esc(b)}</option>`).join("");
  refresh();
}

// ------------------------------------------------------------------ filtering + sidebar
function refresh(keepScroll = true) {
  const toks = filter.q.toLowerCase().split(/\s+/).filter(Boolean);
  const issue = ISSUES.find((i) => i[0] === filter.issue);
  view = records.filter((r) => {
    if (filter.box && val(r, GF) !== filter.box) return false;
    for (const t of toks) if (!r._text.includes(t)) return false;
    if (issue && !issue[2](r)) return false;
    return true;
  });
  if (active.r >= view.length) active.r = Math.max(0, view.length - 1);
  renderIssues(); renderBar(); renderSheet(keepScroll);
}
function renderIssues() {
  const base = records.filter((r) => !filter.box || val(r, GF) === filter.box);
  $("#issues").innerHTML = ISSUES.map(([k, label, t]) => {
    const n = base.reduce((s, r) => s + (t(r) ? 1 : 0), 0);
    return n || filter.issue === k ? `<li><button class="${filter.issue === k ? "on" : ""}" data-issue="${k}"><span>${esc(label)}</span><b>${fmtN(n)}</b></button></li>` : "";
  }).join("") || "<li class='muted small'>Nothing flagged 🎉</li>";
  if (filter.issue === "shifted" && view.length && ED.shiftRepair) $("#issues").insertAdjacentHTML("beforeend", `<li><button class="btn fixbtn" id="fixShift">Repair ${fmtN(view.length)} shifted rows</button><small class="muted">Moves Digitizer 2 → Medium → Format → Class back one column.</small></li>`);
}
function repairShifted() {
  let n = 0;
  for (const r of view.slice()) {
    if (val(r, "Medium") !== "35mm") continue;
    const d2 = val(r, "Digitizer 2"), med = val(r, "Medium"), fmt = val(r, "Format");
    setValue(r, "Class", fmt); setValue(r, "Format", med); setValue(r, "Medium", d2); setValue(r, "Digitizer 2", ""); n++;
  }
  toast(`${fmtN(n)} rows repaired (not saved yet).`); refresh();
}
function renderBar() {
  $("#count").innerHTML = `<b>${fmtN(view.length)}</b> of ${fmtN(records.length)} records`;
  const chips = [];
  if (filter.q) chips.push(["q", `“${filter.q}”`]);
  if (filter.box) chips.push(["box", filter.box]);
  if (filter.issue) chips.push(["issue", ISSUES.find((i) => i[0] === filter.issue)[1]]);
  $("#chips").innerHTML = chips.map(([k, l]) => `<button class="chip" data-chip="${k}">${esc(l)}<span>×</span></button>`).join("");
  const n = [...pending.values()].reduce((s, p) => s + Object.keys(p).length, 0);
  $("#pending").textContent = n ? `${fmtN(n)} unsaved change${n > 1 ? "s" : ""} in ${fmtN(pending.size)} record${pending.size > 1 ? "s" : ""}` : "All changes saved";
  $("#pending").classList.toggle("dirty", !!n);
  $("#saveBtn").disabled = !n;
  $("#saveBtn").textContent = mode === "live" ? (n ? `Save ${fmtN(n)}` : "Saved") : "Save (demo)";
  $("#selInfo").textContent = selected.size ? `${fmtN(selected.size)} selected` : "Tick rows to bulk edit them.";
}
function persist() { LS.set("pending", [...pending]); LS.set("original", [...original]); }

// ------------------------------------------------------------------ the sheet (virtualized grid)
const RH = 40, HEAD = 38, SEL_W = 36, IMG_W = 56;
let colX = [];
function renderSheet(keepScroll) {
  const sheet = $("#sheet"), inner = $("#sheetInner");
  colX = []; let x = SEL_W + IMG_W;
  for (const c of cols) { colX.push(x); x += WIDTH[c] || 140; }
  inner.style.width = x + "px"; inner.style.height = HEAD + view.length * RH + "px";
  inner.innerHTML = `<div class="sh-head" style="width:${x}px"><div class="sh-c sel" style="left:0;width:${SEL_W}px"><input type="checkbox" id="selPage" title="Select all filtered"></div><div class="sh-c" style="left:${SEL_W}px;width:${IMG_W}px"></div>${cols.map((c, j) => `<div class="sh-c" style="left:${colX[j]}px;width:${WIDTH[c] || 140}px" title="${esc(c)}">${esc(label(c))}</div>`).join("")}</div><div class="sh-rows"></div>`;
  $("#selPage").checked = view.length && view.every((r) => selected.has(r._id));
  if (!keepScroll) sheet.scrollTop = 0;
  drawRows();
}
function drawRows() {
  const sheet = $("#sheet"), wrap = $(".sh-rows");
  if (!wrap) return;
  const i0 = Math.max(0, Math.floor((sheet.scrollTop - HEAD) / RH) - 5), i1 = Math.min(view.length, i0 + Math.ceil(sheet.clientHeight / RH) + 12);
  let h = "";
  for (let i = i0; i < i1; i++) {
    const r = view[i], top = HEAD + i * RH, sel = selected.has(r._id);
    h += `<div class="sh-r ${sel ? "sel" : ""} ${r._id === currentId ? "cur" : ""}" data-i="${i}" style="top:${top}px">
      <div class="sh-c sel" style="left:0;width:${SEL_W}px"><input type="checkbox" ${sel ? "checked" : ""}></div>
      <div class="sh-c img" style="left:${SEL_W}px;width:${IMG_W}px"><img loading="lazy" alt="" data-i="${i}"></div>
      ${cols.map((c, j) => `<div class="sh-c ${isDirty(r, c) ? "dirty" : ""} ${active.r === i && active.c === j ? "act" : ""}" data-c="${j}" style="left:${colX[j]}px;width:${WIDTH[c] || 140}px">${esc(val(r, c))}</div>`).join("")}
    </div>`;
  }
  wrap.innerHTML = h;
  wrap.querySelectorAll("img[data-i]").forEach((im) => { const r = view[+im.dataset.i]; attachFallback(im, r); im.src = thumbUrl(r); });
}
function cellEl(i, j) { return $(`.sh-r[data-i="${i}"] .sh-c[data-c="${j}"]`); }
function setActive(i, j, scroll = true) {
  i = Math.max(0, Math.min(view.length - 1, i)); j = Math.max(0, Math.min(cols.length - 1, j));
  const prev = cellEl(active.r, active.c); prev && prev.classList.remove("act");
  active = { r: i, c: j };
  if (scroll) {
    const sh = $("#sheet"), top = HEAD + i * RH, left = colX[j], w = WIDTH[cols[j]] || 140;
    if (top - HEAD < sh.scrollTop) sh.scrollTop = top - HEAD; else if (top + RH > sh.scrollTop + sh.clientHeight) sh.scrollTop = top + RH - sh.clientHeight;
    if (left < sh.scrollLeft + SEL_W + IMG_W) sh.scrollLeft = left - SEL_W - IMG_W; else if (left + w > sh.scrollLeft + sh.clientWidth) sh.scrollLeft = left + w - sh.clientWidth;
  }
  drawRows();
  if (view[i] && view[i]._id !== currentId) openForm(view[i]._id);
}

// inline cell editor
let editing = null;
function startEdit(initial) {
  const r = view[active.r], f = cols[active.c];
  if (!r || READONLY.has(f)) return;
  const cell = cellEl(active.r, active.c); if (!cell) return;
  const inp = document.createElement("input");
  inp.className = "cell-input"; inp.value = initial != null ? initial : val(r, f);
  if (CATEGORICAL.has(f)) { fillDatalist(f); inp.setAttribute("list", "dl-active"); }
  cell.appendChild(inp); inp.focus();
  if (initial == null) inp.select();
  editing = { inp, r, f };
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(); setActive(active.r + (e.shiftKey ? -1 : 1), active.c); $("#sheet").focus(); }
    else if (e.key === "Tab") { e.preventDefault(); commitEdit(); setActive(active.r, active.c + (e.shiftKey ? -1 : 1)); $("#sheet").focus(); }
    else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); $("#sheet").focus(); }
    e.stopPropagation();
  });
  inp.addEventListener("blur", () => setTimeout(() => editing && editing.inp === inp && commitEdit(), 100));
}
function commitEdit() {
  if (!editing) return;
  const { inp, r, f } = editing; editing = null;
  setValue(r, f, inp.value);
  inp.remove(); drawRows(); renderBar(); if (r._id === currentId) openForm(r._id);
}
function cancelEdit() { if (editing) { editing.inp.remove(); editing = null; } }

function setValue(r, f, v) {
  v = String(v ?? "");
  const orig = original.get(r._id)?.[f] ?? (r[f] ?? "");
  if (!original.has(r._id)) original.set(r._id, {});
  if (!(f in original.get(r._id))) original.get(r._id)[f] = r[f] ?? "";
  const p = pending.get(r._id) || {};
  if (v === String(orig)) { delete p[f]; delete original.get(r._id)[f]; }
  else p[f] = v;
  if (Object.keys(p).length) pending.set(r._id, p); else { pending.delete(r._id); original.delete(r._id); }
  persist();
}
const listCache = new Map();
function distinct(f) {
  if (listCache.has(f)) return listCache.get(f);
  const c = new Map(); for (const r of records) { const v = val(r, f); if (v) c.set(v, (c.get(v) || 0) + 1); }
  const out = [...c].sort((a, b) => b[1] - a[1]); listCache.set(f, out); setTimeout(() => listCache.delete(f), 15000); return out;
}
function fillDatalist(f, id = "dl-active") {
  $("#" + id).innerHTML = distinct(f).slice(0, 400).map(([v]) => `<option value="${esc(v)}">`).join("");
}

// ------------------------------------------------------------------ record form (right panel)
let miniMap = null;
function openForm(id) {
  currentId = id;
  const r = byId.get(id), form = $("#form");
  if (!r) { form.innerHTML = `<div class="form-empty">Select a row to edit the full record.</div>`; return; }
  const idx = view.indexOf(r);
  form.innerHTML = `
    <div class="form-head"><button class="btn ghost" data-nav="-1" title="Previous">‹</button><span>${idx >= 0 ? fmtN(idx + 1) + " / " + fmtN(view.length) : ""}</span><button class="btn ghost" data-nav="1" title="Next">›</button>
      <span class="rid">${esc(r._id)}${mode === "live" ? " · row " + r._row : ""}</span></div>
    <button class="form-img" data-open title="Open full viewer (Space)"><img alt=""></button>
    <div class="form-fields">${fields.filter((f) => !READONLY.has(f)).map((f) => `
      <label class="${isDirty(r, f) ? "dirty" : ""}"><span>${esc(label(f))}${isDirty(r, f) ? ` <button class="link revert" data-revert="${esc(f)}" title="Was: ${esc(original.get(r._id)?.[f] ?? "")}">revert</button>` : ""}</span>
      ${TEXTAREA.has(f) ? `<textarea rows="2" data-f="${esc(f)}">${esc(val(r, f))}</textarea>` : `<input data-f="${esc(f)}" value="${esc(val(r, f))}" ${CATEGORICAL.has(f) ? `list="dl-${slug(f)}"` : ""}>`}
      ${f === ROLE.geo ? `<div class="mini-map" id="miniMap"></div><small class="muted">Click the map to set coordinates.</small>` : ""}
      </label>`).join("")}
    </div>
    ${[...CATEGORICAL].filter((f) => fields.includes(f)).map((f) => `<datalist id="dl-${slug(f)}"></datalist>`).join("")}`;
  const img = $(".form-img img", form); attachFallback(img, r); img.src = mediumUrl(r);
  form.querySelectorAll("datalist").forEach((dl) => { const f = [...CATEGORICAL].find((x) => "dl-" + slug(x) === dl.id); dl.dataset.f = f; });
  form.querySelectorAll("input[list]").forEach((inp) => inp.addEventListener("focus", () => { const id = inp.getAttribute("list"); const dl = $("#" + id); dl.innerHTML = distinct(dl.dataset.f).slice(0, 400).map(([v]) => `<option value="${esc(v)}">`).join(""); }, { once: true }));
  if (ROLE.geo && fields.includes(ROLE.geo) && window.L) {
    if (miniMap) { miniMap.remove(); miniMap = null; }
    const g = val(r, ROLE.geo).match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    const ll = g ? [+g[1], +g[2]] : [38.5, 23.5];
    miniMap = L.map("miniMap", { attributionControl: false }).setView(ll, g ? 11 : 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(miniMap);
    let mk = g ? L.marker(ll).addTo(miniMap) : null;
    miniMap.on("click", (e) => {
      const v = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
      setValue(r, ROLE.geo, v); $(`[data-f="${CSS.escape(ROLE.geo)}"]`, form).value = v;
      mk ? mk.setLatLng(e.latlng) : (mk = L.marker(e.latlng).addTo(miniMap));
      drawRows(); renderBar();
    });
  }
  drawRows();
}
const slug = (s) => s.replace(/\W+/g, "-").toLowerCase();

// ------------------------------------------------------------------ save / publish
async function save() {
  const changes = [];
  for (const [id, p] of pending) for (const [field, value] of Object.entries(p)) changes.push({ id, field, value });
  if (!changes.length) return;
  if (mode !== "live") {
    return modal(`<h3>Demo mode</h3><p>You’re looking at the published data, not the live Sheet, so changes can’t be saved yet. Connect the Sheet in ⚙ settings (see the setup guide), or download your ${fmtN(changes.length)} changes as a CSV.</p>
      <div class="modal-actions"><button class="btn" data-close>Close</button><button class="btn primary" id="dlCh">Download changes CSV</button></div>`, (b) => { $("#dlCh", b).onclick = exportChanges; });
  }
  const btn = $("#saveBtn"); btn.disabled = true; btn.textContent = "Saving…";
  try {
    let written = 0, missing = [];
    for (let k = 0; k < changes.length; k += 400) {
      const chunk = changes.slice(k, k + 400);
      const res = await api("update", { changes: chunk });
      written += res.written; missing = missing.concat(res.missing || []);
      for (const c of chunk) if (!missing.includes(c.id)) { const r = byId.get(c.id); if (r) r[c.field] = c.value; }
      btn.textContent = `Saving… ${Math.min(100, Math.round(((k + chunk.length) / changes.length) * 100))}%`;
    }
    for (const c of changes) if (!missing.includes(c.id)) { const p = pending.get(c.id); if (p) { delete p[c.field]; if (!Object.keys(p).length) { pending.delete(c.id); original.delete(c.id); } } }
    persist(); indexRecords(records, fields); computeDups();
    toast(`Saved ${fmtN(written)} change${written === 1 ? "" : "s"} to the Sheet.${missing.length ? ` ${missing.length} records weren’t found.` : ""} Click Publish when you want the public site updated.`, 6000);
  } catch (e) { toast("Save failed: " + e.message, 8000); }
  refresh(); if (currentId) openForm(currentId);
}
async function publish() {
  try { await api("publish"); toast("Publishing started — the public site updates in 2–3 minutes.", 6000); }
  catch (e) { toast("Publish failed: " + e.message, 8000); }
}
function exportChanges() {
  const rows = [["Record ID", "Sheet row", "Field", "Old value", "New value"]];
  for (const [id, p] of pending) for (const [f, v] of Object.entries(p)) rows.push([id, byId.get(id)?._row ?? "", f, original.get(id)?.[f] ?? "", v]);
  download(`${CFG.exportName || CFG.key || "archive"}-changes.csv`, rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n"));
}

// ------------------------------------------------------------------ modal + tools
let modalCleanup = null;
function modal(html, init) {
  $("#modalBody").innerHTML = html; $("#modal").hidden = false;
  init && init($("#modalBody"));
  const first = $("#modalBody input, #modalBody select"); first && first.focus();
}
function closeModal() { modalCleanup && modalCleanup(); modalCleanup = null; $("#modal .modal-card").classList.remove("wide"); $("#modal").hidden = true; $("#modalBody").innerHTML = ""; }
const fieldOptions = (sel) => fields.filter((f) => !READONLY.has(f)).map((f) => `<option value="${esc(f)}" ${f === sel ? "selected" : ""}>${esc(label(f))}</option>`).join("");
const targetSet = () => (selected.size ? records.filter((r) => selected.has(r._id)) : view);

const TOOLS = {
  bulk() {
    const set = targetSet();
    modal(`<h3>Bulk edit</h3><p class="muted">Applies to <b>${fmtN(set.length)}</b> ${selected.size ? "selected" : "filtered"} records. Changes stay pending until you Save.</p>
      <div class="frm"><label>Field <select id="bf">${fieldOptions(cols[active.c] || ROLE.location)}</select></label>
      <label>New value <input id="bv" list="dl-bulk"></label><datalist id="dl-bulk"></datalist>
      <label class="check"><input type="checkbox" id="bblank"> Only fill empty cells</label></div>
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="bgo">Apply to ${fmtN(set.length)}</button></div>`, (b) => {
      const upd = () => fillDatalist($("#bf", b).value, "dl-bulk"); $("#bf", b).onchange = upd; upd();
      $("#bgo", b).onclick = () => {
        const f = $("#bf", b).value, v = $("#bv", b).value, blank = $("#bblank", b).checked; let n = 0;
        for (const r of set) if (!blank || !val(r, f)) { setValue(r, f, v); n++; }
        closeModal(); toast(`${fmtN(n)} cells changed (not saved yet).`); refresh(); if (currentId) openForm(currentId);
      };
    });
  },
  replace() {
    modal(`<h3>Find &amp; replace</h3><p class="muted">Searches the ${selected.size ? fmtN(selected.size) + " selected" : fmtN(view.length) + " filtered"} records.</p>
      <div class="frm"><label>In field <select id="rf"><option value="*">All fields</option>${fieldOptions(cols[active.c])}</select></label>
      <label>Find <input id="rfind"></label><label>Replace with <input id="rrep"></label>
      <label class="check"><input type="checkbox" id="rcase"> Match case</label><label class="check"><input type="checkbox" id="rwhole"> Whole cell only</label>
      <p class="muted" id="rprev">&nbsp;</p></div>
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="rgo" disabled>Replace</button></div>`, (b) => {
      const set = targetSet();
      const plan = () => {
        const f = $("#rf", b).value, find = $("#rfind", b).value, rep = $("#rrep", b).value;
        if (!find) return [];
        const fl = f === "*" ? fields.filter((x) => !READONLY.has(x)) : [f], cs = $("#rcase", b).checked, whole = $("#rwhole", b).checked;
        const re = new RegExp(whole ? `^${escRe(find)}$` : escRe(find), cs ? "g" : "gi"), out = [];
        for (const r of set) for (const x of fl) { const v = String(val(r, x)); if (re.test(v)) { re.lastIndex = 0; out.push([r, x, v.replace(re, rep)]); } re.lastIndex = 0; }
        return out;
      };
      const prev = () => { const p = plan(); $("#rprev", b).textContent = $("#rfind", b).value ? `${fmtN(p.length)} cells will change${p[0] ? ` — e.g. “${p[0][1]}”: ${val(p[0][0], p[0][1])} → ${p[0][2]}` : ""}` : " "; $("#rgo", b).disabled = !p.length; };
      b.querySelectorAll("input, select").forEach((el) => el.addEventListener("input", debounce(prev, 150)));
      $("#rgo", b).onclick = () => { const p = plan(); p.forEach(([r, f, v]) => setValue(r, f, v)); closeModal(); toast(`${fmtN(p.length)} cells changed (not saved yet).`); refresh(); };
    });
  },
  clean() {
    modal(`<h3>Clean up values</h3><p class="muted">Merge spelling variants so filters and charts group correctly. Similar values (same letters, ignoring case, spaces and punctuation) are suggested first.</p>
      <div class="frm row"><label>Field <select id="cf">${[...CATEGORICAL].filter((f) => fields.includes(f)).map((f) => `<option value="${esc(f)}">${esc(label(f))}</option>`).join("")}</select></label>
      <label>Search values <input id="cq" placeholder="e.g. Frey"></label></div>
      <div class="clean-list" id="clist"></div>
      <div class="frm row"><label>Merge ticked values into <input id="cinto" list="dl-clean"></label><datalist id="dl-clean"></datalist></div>
      <div class="modal-actions"><button class="btn" data-close>Close</button><button class="btn primary" id="cgo" disabled>Merge</button></div>`, (b) => {
      const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
      const draw = () => {
        const f = $("#cf", b).value, q = $("#cq", b).value.toLowerCase();
        listCache.delete(f); fillDatalist(f, "dl-clean");
        const vals = distinct(f), groups = new Map();
        for (const [v, n] of vals) { const k = norm(v); (groups.get(k) || groups.set(k, []).get(k)).push([v, n]); }
        const sugg = [...groups.values()].filter((g) => g.length > 1);
        const rest = vals.filter(([v]) => !q || v.toLowerCase().includes(q)).slice(0, 300);
        const item = ([v, n]) => `<label><input type="checkbox" value="${esc(v)}"><span>${esc(v) || "<i>(blank)</i>"}</span><b>${fmtN(n)}</b></label>`;
        $("#clist", b).innerHTML = (sugg.length && !q ? `<h5>Suggested groups (${sugg.length})</h5>${sugg.slice(0, 60).map((g) => `<div class="cgroup">${g.map(item).join("")}<button class="link" data-pick='${esc(JSON.stringify(g.map((x) => x[0])))}'>Merge this group →</button></div>`).join("")}` : "")
          + `<h5>${q ? "Matching values" : "All values"} (${fmtN(q ? rest.length : vals.length)})</h5>${rest.map(item).join("")}`;
      };
      const ticked = () => [...b.querySelectorAll("#clist input:checked")].map((i) => i.value);
      const upd = () => { const t = ticked(); $("#cgo", b).disabled = !t.length || !$("#cinto", b).value; $("#cgo", b).textContent = t.length ? `Merge ${t.length} values` : "Merge"; };
      $("#cf", b).onchange = draw; $("#cq", b).oninput = debounce(draw, 150);
      $("#clist", b).addEventListener("change", (e) => { if (!$("#cinto", b).value && e.target.checked) $("#cinto", b).value = e.target.value; upd(); });
      $("#cinto", b).oninput = upd;
      $("#clist", b).addEventListener("click", (e) => {
        const p = e.target.closest("[data-pick]"); if (!p) return;
        const vs = JSON.parse(p.dataset.pick); b.querySelectorAll("#clist input").forEach((i) => (i.checked = vs.includes(i.value)));
        $("#cinto", b).value = vs[0]; upd();
      });
      $("#cgo", b).onclick = () => {
        const f = $("#cf", b).value, into = $("#cinto", b).value, from = new Set(ticked()); let n = 0;
        for (const r of records) if (from.has(val(r, f)) && val(r, f) !== into) { setValue(r, f, into); n++; }
        toast(`${fmtN(n)} records changed to “${into}” (not saved yet).`); listCache.delete(f); draw(); upd(); refresh();
      };
      draw();
    });
  },
  columns() {
    modal(`<h3>Columns</h3><p class="muted">Choose which Sheet columns show in the grid. Every field is always editable in the side panel.</p>
      <div class="col-pick">${fields.map((f) => `<label class="check"><input type="checkbox" value="${esc(f)}" ${cols.includes(f) ? "checked" : ""}> ${esc(label(f))}</label>`).join("")}</div>
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="cok">Apply</button></div>`, (b) => {
      $("#cok", b).onclick = () => { cols = fields.filter((f) => b.querySelector(`input[value="${CSS.escape(f)}"]`).checked); LS.set("cols", cols); closeModal(); renderSheet(true); };
    });
  },
  // What the full-screen viewer shows, for this site. Saved to sites/<site>/viewer.json in the private repo
  // (through the Sheet backend when connected, otherwise as a file to add by hand), then published.
  viewer() {
    const v = JSON.parse(JSON.stringify(VIEW)), sc = v.scale || {};
    const shown = v.fields && v.fields.length ? v.fields : CFG.keyFields || [];
    const order = [...shown.filter((f) => fields.includes(f)), ...fields.filter((f) => !shown.includes(f))];
    const numeric = fields.filter((f) => records.slice(0, 200).some((r) => parseFloat(val(r, f)) > 0));
    modal(`<h3>Viewer settings</h3><p class="muted">How the full-screen viewer looks on the public site. Visitors can still flip the background and hide the scale for themselves.</p>
      <div class="frm">
        <label>Background when the viewer opens <select id="vbg"><option value="dark">Black</option><option value="light">White</option></select></label>
        <label class="check"><input type="checkbox" id="vcut"> Hide the photo’s plain backdrop (white on white, black on black)</label>
        <label>How much counts as backdrop <input type="range" id="vtol" min="8" max="80" step="2"> <span class="muted small">Raise it if a pale edge or shadow is left behind; lower it if bright parts of the object disappear.</span></label>
        <label class="check"><input type="checkbox" id="vsc"> Show a scale bar and “actual size” zoom</label>
        <div class="row" id="vscRow"><label>Size comes from <select id="vscF">${numeric.map((f) => `<option value="${esc(f)}">${esc(label(f))}</option>`).join("")}</select></label>
          <label>in <select id="vscU"><option>mm</option><option>cm</option></select></label>
          <label title="Only used when a photo can’t be measured automatically">Object fills about <input type="number" id="vfill" min="20" max="100" step="5" style="width:70px"> % of the photo</label></div>
        <label>Info panel opens on <select id="vtab"><option value="key">Key fields (the ticked ones below)</option><option value="all">All fields</option></select></label>
      </div>
      <h4 style="margin:14px 0 2px">Key fields shown in the viewer</h4>
      <div class="col-pick">${order.map((f) => `<label class="check"><input type="checkbox" data-vf value="${esc(f)}" ${shown.includes(f) ? "checked" : ""}> ${esc(label(f))}</label>`).join("")}</div>
      <div class="modal-actions"><button class="btn ghost" id="vreset" title="Forget unsaved viewer settings in this browser">Reset to published</button><button class="btn" data-close>Cancel</button><button class="btn" id="vprev">Preview</button><button class="btn primary" id="vok">Save</button></div>`, (b) => {
      $("#vbg", b).value = v.background; $("#vcut", b).checked = !!v.removeBg; $("#vtol", b).value = v.bgTolerance;
      $("#vsc", b).checked = !!v.scale; if (sc.field) $("#vscF", b).value = sc.field; $("#vscU", b).value = sc.unit || "mm";
      $("#vfill", b).value = Math.round((sc.fill || 0.8) * 100); $("#vtab", b).value = v.infoDefault === "key" ? "key" : "all";
      const sync = () => { $("#vscRow", b).style.display = $("#vsc", b).checked ? "" : "none"; }; $("#vsc", b).onchange = sync; sync();
      const read = () => ({
        background: $("#vbg", b).value, removeBg: $("#vcut", b).checked, bgTolerance: +$("#vtol", b).value,
        scale: $("#vsc", b).checked && $("#vscF", b).value ? { field: $("#vscF", b).value, unit: $("#vscU", b).value, fill: Math.min(1, Math.max(0.2, +$("#vfill", b).value / 100 || 0.8)) } : null,
        scaleOn: v.scaleOn !== false, infoDefault: $("#vtab", b).value,
        fields: [...b.querySelectorAll("[data-vf]:checked")].map((i) => i.value),
      });
      const use = (n) => { for (const k of Object.keys(VIEW)) delete VIEW[k]; Object.assign(VIEW, VIEW_DEFAULTS, n); localStorage.removeItem((CFG.storageKey || CFG.key || "ga") + "-viewer-prefs"); lb.bg = VIEW.background; lb.allFields = VIEW.infoDefault !== "key"; applyPhotoTheme(); };
      $("#vprev", b).onclick = () => { use(read()); LS.set("viewer", VIEW); closeModal(); if (view.length) lb.open(view, Math.max(0, active.r)); };
      $("#vreset", b).onclick = () => { localStorage.removeItem(LSP + "viewer"); use(CFG.viewer || {}); closeModal(); toast("Back to the published viewer settings."); };
      $("#vok", b).onclick = async () => {
        const n = read(); use(n);
        try { await putJson(`sites/${CFG.key}/viewer.json`, n, `Viewer settings for ${CFG.key}`); localStorage.removeItem(LSP + "viewer"); closeModal(); toast("Saved. The public site updates in about a minute.", 6000); }
        catch (e) { LS.set("viewer", VIEW); toast("Could not save: " + e.message, 7000); }
      };
    });
  },
  // How this archive's columns feed the shared groupings of the combined site (sites/<site>/hub.json),
  // and the combined site's list of area names (sites/<hub>/areas.json).
  hub() {
    const h = Object.assign({ type: "", area: "", trench: "", people: "", year: "", only: "", search: [], cut: false }, CFG.hub || {});
    const HS = CFG.hubSite || { key: "", title: "the combined site", areas: {} };
    const pick = (id, cur, none) => `<select id="${id}"><option value="">${none}</option>${fields.map((f) => `<option value="${esc(f)}" ${f === cur ? "selected" : ""}>${esc(label(f))}</option>`).join("")}</select>`;
    const areaText = Object.entries(HS.areas || {}).map(([k, v]) => k + (v.length ? " = " + v.join(", ") : "")).join("\n");
    modal(`<h3>Combined search</h3><p class="muted">How records from this archive are grouped with the other archives on <b>${esc(HS.title)}</b>. Pick the column that holds each thing, or leave it to be found in the text.</p>
      <div class="frm">
        <label>These records are <input id="hType" value="${esc(h.type)}" placeholder="Coin, Photograph, Notebook page…"></label>
        <label>Area of the site ${pick("hArea", h.area, "(look for area names in the text)")}</label>
        <label>Trench ${pick("hTrench", h.trench, "(look for “TR 90-3” in the text)")}</label>
        <label>Ruler / authority ${pick("hPeople", h.people, "(look for known names in the text)")}</label>
        <label>Excavation year ${pick("hYear", h.year, "(use the created date)")}</label>
        <label>Text columns to look in, in order <input id="hSearch" value="${esc((h.search || []).join(", "))}" placeholder="Title, Subject"></label>
        <label>Only include records that mention <input id="hOnly" value="${esc(h.only || "")}" placeholder="leave blank to include every record"></label>
        <label class="check"><input type="checkbox" id="hCut" ${h.cut ? "checked" : ""}> Photos have a plain backdrop the viewer may hide</label>
      </div>
      <h4 style="margin:14px 0 2px">Area names (shared by every archive)</h4>
      <p class="muted small">One area per line. After “=”, other spellings that mean the same place. “#” stands for a number.</p>
      <textarea id="hAreas" rows="9" style="width:100%;font:13px ui-monospace,monospace">${esc(areaText)}</textarea>
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="hok">Save</button></div>`, (b) => {
      $("#hok", b).onclick = async () => {
        const n = { ...h, type: $("#hType", b).value.trim(), area: $("#hArea", b).value, trench: $("#hTrench", b).value, people: $("#hPeople", b).value, year: $("#hYear", b).value,
          search: $("#hSearch", b).value.split(",").map((x) => x.trim()).filter((x) => fields.includes(x)), only: $("#hOnly", b).value.trim(), cut: $("#hCut", b).checked };
        const areas = {};
        for (const line of $("#hAreas", b).value.split("\n")) { const [k, v] = line.split("="); if (k && k.trim()) areas[k.trim()] = (v || "").split(",").map((x) => x.trim()).filter(Boolean); }
        const areasChanged = JSON.stringify(areas) !== JSON.stringify(HS.areas || {});
        CFG.hub = n; if (CFG.hubSite) CFG.hubSite.areas = areas;
        try {
          await putJson(`sites/${CFG.key}/hub.json`, n, `Combined-search settings for ${CFG.key}`);
          if (areasChanged) await putJson(`sites/${HS.key}/areas.json`, areas, "Area names");
          closeModal(); toast("Saved. The combined site updates in a minute or two.", 6000);
        } catch (e) { toast("Could not save: " + e.message, 7000); }
      };
    });
  },
  // What this site calls its views and the find-areas tabs (sites/<site>/names.json). Blank = the standard name.
  names() {
    const N = CFG.names || {}, G = GROUP || {};
    const rows = [
      ["gallery", "Gallery view", "Gallery"], ["boxes", "Grouping view (cards by area, box…)", G.nav || "Find areas"], ["table", "Table view", "Table"],
      ["map", "Map view", "Map"], ["charts", "Charts view", "Charts"],
      ["tabGroups", "Find-areas tab: cards", G.tab || G.nav || "Areas"], ["tabMap", "Find-areas tab: map", "Map"], ["tabBoard", "Find-areas tab: board", "Board"],
    ].filter(([k]) => GROUP || !(k === "boxes" || k.startsWith("tab")));
    const shown = new Set(CFG.views || []);
    modal(`<h3>Names of views</h3><p class="muted">What visitors see in the menu at the top and on the tabs under ${esc(G.nav || "find areas")}. Leave a box empty for the standard name. Only this site changes.</p>
      <div class="frm">${rows.map(([k, l, d]) => `<label>${esc(l)}${k.startsWith("tab") || shown.has(k) ? "" : ' <i class="muted">(not shown on this site)</i>'}<input data-n="${k}" value="${esc(N[k] || "")}" placeholder="${esc(d)}" maxlength="40"></label>`).join("")}</div>
      <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="nOk">Save names</button></div>`, (b) => {
      $("#nOk", b).onclick = async () => {
        const n = {}; b.querySelectorAll("[data-n]").forEach((i) => { const v = i.value.trim(); if (v) n[i.dataset.n] = v; });
        try { await putJson(`sites/${CFG.key}/names.json`, n, `View names for ${CFG.key}`); CFG.names = n; closeModal(); toast("Saved. The public site updates in about a minute.", 6000); }
        catch (e) { toast("Could not save: " + e.message, 7000); }
      };
    });
  },
  // Where each area label sits on the combined site's map (sites/<hub>/places.json).
  // The list is the shared area names from "Combined search", so pins and labels always match.
  places() {
    const HS = CFG.hubSite, labels = Object.keys(HS.areas || {});
    const extra = new Set(); // numbered areas added in this session, before they get a pin
    const places = JSON.parse(JSON.stringify(HS.places || {}));
    // "Tower #" stands for every numbered tower: list the ones that already have a pin, and let more be added
    const isPattern = (n) => n.includes("#");
    const names = () => [...new Set([...labels.filter((n) => !isPattern(n)), ...Object.keys(places), ...extra])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const known = (n) => labels.includes(n) || labels.some((l) => isPattern(l) && new RegExp("^" + l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("#", "\\d+") + "$").test(n));
    let pick = null, map = null, group = null, dirty = false, modalPhoto = null;
    modal(`<h3>Area pins on the map</h3><p class="muted">Pick an area label, then click the map to place it. Drag a pin to adjust it. These are the pins visitors see on <b>${esc(HS.title)}</b>.</p>
      <div class="pin-wrap"><div class="pin-list"></div><div class="pin-map"></div></div>
      <div class="frm row" style="margin-top:8px">${labels.filter(isPattern).map((l) => `<label>Add a numbered area (${esc(l)}) <input data-num="${esc(l)}" type="number" min="1" style="width:80px" placeholder="14"></label>`).join("")}</div>
      ${HS.map && HS.map.photo ? `<div class="frm row align-row" id="alignRow"><label class="check"><input type="checkbox" id="alignOn"> Align the site photo</label>
        <span class="muted small" id="alignHelp">Turn this on, then drag the photo’s two corner handles (or the middle one to move it) until it lines up with the street map underneath.</span>
        <label hidden id="alignFade">Photo <input type="range" id="alignOp" min="0.2" max="1" step="0.05" value="0.6"></label></div>` : ""}
      <div class="modal-actions"><span class="muted small" id="pinNote" style="margin-right:auto"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="pinOk">Save pins</button></div>`, (b) => {
      $("#modal .modal-card").classList.add("wide");
      const list = $(".pin-list", b);
      const drawList = () => {
        const ns = names();
        list.innerHTML = ns.map((n) => `<div class="pin-row ${pick === n ? "on" : ""}"><button data-pick="${esc(n)}">${places[n] ? "✓" : "○"} ${esc(n)}${known(n) ? "" : " <i>(no such label)</i>"}</button>${places[n] ? `<button data-unpin="${esc(n)}" title="Remove this pin">×</button>` : ""}</div>`).join("");
        $("#pinNote", b).textContent = `${ns.filter((n) => places[n]).length} of ${ns.length} placed${pick ? ` · click the map to place “${pick}”` : ""}`;
      };
      const drawPins = () => {
        if (!group) return; group.clearLayers();
        for (const [n, at] of Object.entries(places)) {
          const m = L.marker(at, { draggable: true, title: n }).on("dragend", (e) => { const p = e.target.getLatLng(); places[n] = [+p.lat.toFixed(6), +p.lng.toFixed(6)]; dirty = true; })
            .on("click", () => { pick = n; drawList(); });
          m.bindTooltip(esc(n), { permanent: true, direction: "top", className: "map-label", offset: [-15, -14] });
          group.addLayer(m);
        }
      };
      list.onclick = (e) => {
        const u = e.target.closest("[data-unpin]"), p = e.target.closest("[data-pick]");
        if (u) { delete places[u.dataset.unpin]; dirty = true; drawPins(); drawList(); }
        else if (p) { pick = p.dataset.pick; drawList(); if (places[pick] && map) map.panTo(places[pick]); }
      };
      b.querySelectorAll("[data-num]").forEach((i) => (i.onchange = () => { if (i.value) { pick = i.dataset.num.replace("#", i.value); i.value = ""; extra.add(pick); drawList(); } }));
      if (!window.L) { $(".pin-map", b).textContent = "The map library is still loading. Close this and open it again in a moment."; drawList(); return; }
      const M = HS.map || {};
      map = L.map($(".pin-map", b), { maxZoom: 22 }).setView(M.center || [38.5, 24], M.zoom || 16);
      group = L.layerGroup().addTo(map);
      let photoBounds = null; // set when the photo has been moved
      addBase(map, M).then((base) => {
        if (!base.photo || !$("#alignOn", b)) return;
        const handles = L.layerGroup(), icon = (c) => L.divIcon({ className: "photo-handle " + c, iconSize: [18, 18] });
        const corners = () => { const bb = base.photo.getBounds(); return [bb.getSouthWest(), bb.getNorthEast(), bb.getCenter()]; };
        let sw, ne, mid;
        const place = () => { const [a, c, m] = corners(); sw.setLatLng(a); ne.setLatLng(c); mid.setLatLng(m); };
        const fix = (ll) => [+ll.lat.toFixed(6), +ll.lng.toFixed(6)];
        const setB = (a, c) => { base.photo.setBounds(L.latLngBounds(a, c)); const bb = base.photo.getBounds(); photoBounds = [fix(bb.getSouthWest()), fix(bb.getNorthEast())]; };
        sw = L.marker(corners()[0], { draggable: true, icon: icon("sw"), title: "South-west corner" }).on("drag", () => { setB(sw.getLatLng(), ne.getLatLng()); mid.setLatLng(base.photo.getBounds().getCenter()); });
        ne = L.marker(corners()[1], { draggable: true, icon: icon("ne"), title: "North-east corner" }).on("drag", () => { setB(sw.getLatLng(), ne.getLatLng()); mid.setLatLng(base.photo.getBounds().getCenter()); });
        let start = null;
        mid = L.marker(corners()[2], { draggable: true, icon: icon("mid"), title: "Move the whole photo" })
          .on("dragstart", () => { start = [mid.getLatLng(), sw.getLatLng(), ne.getLatLng()]; })
          .on("drag", () => { const d = [mid.getLatLng().lat - start[0].lat, mid.getLatLng().lng - start[0].lng];
            const a = L.latLng(start[1].lat + d[0], start[1].lng + d[1]), c = L.latLng(start[2].lat + d[0], start[2].lng + d[1]);
            sw.setLatLng(a); ne.setLatLng(c); setB(a, c); });
        handles.addLayer(sw).addLayer(ne).addLayer(mid);
        const op = $("#alignOp", b);
        op.oninput = () => base.photo.setOpacity(+op.value);
        $("#alignOn", b).onchange = (e) => {
          const on = e.target.checked;
          $("#alignFade", b).hidden = !on; $("#alignHelp", b).hidden = on;
          map.getContainer().classList.toggle("aligning", on);
          if (on) { base.setMode("photo", true); base.photo.setOpacity(+op.value); place(); handles.addTo(map); }
          else { base.photo.setOpacity(1); handles.remove(); }
        };
        modalPhoto = () => photoBounds;
      });
      map.on("click", (e) => { if (!pick) return toast("Pick an area label in the list first."); places[pick] = [+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]; dirty = true; pick = null; drawPins(); drawList(); });
      setTimeout(() => map.invalidateSize(), 60);
      modalCleanup = () => map.remove();
      drawPins(); drawList();
      $("#pinOk", b).onclick = async () => {
        HS.places = places;
        const pb = modalPhoto && modalPhoto();
        const photoJson = (bounds) => { const { file, label, attribution } = HS.map.photo; return Object.fromEntries(Object.entries({ file, label, attribution, bounds }).filter(([, v]) => v != null)); };
        if (pb) HS.map.photo.bounds = pb;
        try {
          await putJson(`sites/${HS.key}/places.json`, places, "Area pins");
          if (pb) await putJson(`sites/${HS.map.photo.home || HS.key}/photo.json`, photoJson(pb), "Site photo position");
          closeModal(); toast(pb ? "Pins and photo position saved. The maps update in a minute or two." : "Pins saved. The maps update in a minute or two.", 6000);
        } catch (e) { toast("Could not save: " + e.message, 7000); }
      };
    });
  },
  exportChanges() { exportChanges(); },
  discard() {
    modal(`<h3>Discard changes?</h3><p>This throws away all unsaved edits in this browser.</p><div class="modal-actions"><button class="btn" data-close>Keep them</button><button class="btn primary" id="dok">Discard</button></div>`, (b) => {
      $("#dok", b).onclick = () => { pending.clear(); original.clear(); persist(); closeModal(); refresh(); if (currentId) openForm(currentId); };
    });
  },
};
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ------------------------------------------------------------------ add images (upload to S3 + new rows)
const UP = ED.upload || {};
function addImages() {
  const live = mode === "live";
  modal(`<h3>Add images</h3>
    ${live ? "" : `<p class="warn">Demo mode: connect the Sheet in ⚙ settings to upload. You can still try the form.</p>`}
    <label class="drop" id="drop"><input type="file" id="files" accept="image/*" multiple hidden><b>Drop scans here</b> or click to choose files<br><small class="muted">Files go to the S3 bucket under their own names; one new record is created per image.</small></label>
    <div id="flist" class="flist"></div>
    <div class="frm grid2">${(UP.fields || []).filter((f) => fields.includes(f)).map((f) => `<label>${esc(label(f))} <input data-nf="${esc(f)}" list="dl-n-${slug(f)}" value="${esc(f === GF ? filter.box : (UP.defaults || {})[f] || "")}"><datalist id="dl-n-${slug(f)}"></datalist></label>`).join("")}</div>
    <p class="muted small">Titles default to the file name; edit them in the grid afterwards. Thumbnails are made in your browser during upload.</p>
    <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="upGo" disabled>Upload &amp; create records</button></div>`, (b) => {
    let files = [];
    b.querySelectorAll("[data-nf]").forEach((i) => fillDatalist(i.dataset.nf, i.getAttribute("list")));
    const existing = new Set(records.map((r) => r[FILE]));
    const show = () => {
      $("#flist", b).innerHTML = files.map((f, k) => `<div class="fi" data-k="${k}"><span>${esc(f.name)}</span>${existing.has(f.name) ? `<em>name already in archive — will overwrite</em>` : ""}<small>${(f.size / 1048576).toFixed(1)} MB</small><i class="prog"></i></div>`).join("");
      $("#upGo", b).disabled = !files.length || !live; $("#upGo", b).textContent = files.length ? `Upload ${files.length} & create records` : "Upload & create records";
    };
    const take = (list) => { files = files.concat([...list].filter((f) => f.type.startsWith("image/"))); show(); };
    $("#files", b).onchange = (e) => take(e.target.files);
    const drop = $("#drop", b);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); take(e.dataTransfer.files); };
    $("#upGo", b).onclick = async () => {
      const go = $("#upGo", b); go.disabled = true; go.textContent = "Uploading…";
      const shared = {}; b.querySelectorAll("[data-nf]").forEach((i) => { if (i.value) shared[i.dataset.nf] = i.value; });
      try {
        const safe = (n) => n.replace(/[^\w.\-]+/g, "_"), stemOf = (n) => safe(n).replace(/\.[^.]+$/, "");
        const names = files.flatMap((f) => [f.name, `thumbs/400/${stemOf(f.name)}.webp`, `thumbs/1600/${stemOf(f.name)}.webp`]);
        const { files: signed } = await api("presign", { files: names.map((name) => ({ name })) });
        const done = [];
        let noThumbs = 0;
        await pool(files.map((f, k) => async () => {
          const s = signed[k * 3], row = b.querySelector(`.fi[data-k="${k}"]`);
          await putWithProgress(s.put, f, (p) => (row.querySelector(".prog").style.width = p * 90 + "%"));
          // make the thumbnails here in the browser, so no server job has to download the scan again
          try {
            for (const [j, size, q] of [[1, 400, 0.76], [2, 1600, 0.82]]) {
              const blob = await resizeToWebp(f, size, q);
              if (!blob) { noThumbs++; break; }
              await putWithProgress(signed[k * 3 + j].put, blob, () => {}, "image/webp");
            }
          } catch { noThumbs++; }
          row.classList.add("ok");
          done.push({ ...shared, [ROLE.title]: f.name.replace(/\.[^.]+$/, ""), [FILE]: s.name, ...(URLF ? { [URLF]: s.url } : {}) });
        }), 4);
        go.textContent = "Creating records…";
        const res = await api("append", { records: done });
        toast(`${res.ids.length} images uploaded and added to the Sheet.${noThumbs ? " This browser couldn’t make WebP thumbnails; run the thumbnail script later." : ""}`, 6000);
        closeModal(); mode = "demo"; await load();
      } catch (e) { toast("Upload failed: " + e.message + ". Check the bucket CORS settings in the setup guide.", 9000); go.disabled = false; go.textContent = "Retry"; }
    };
  });
}
async function resizeToWebp(file, size, quality) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  const blob = await new Promise((r) => c.toBlob(r, "image/webp", quality));
  return blob && blob.type === "image/webp" ? blob : null; // some Safari versions can't encode WebP
}
function putWithProgress(url, file, onp, type) {
  return new Promise((ok, fail) => {
    const x = new XMLHttpRequest(); x.open("PUT", url); x.setRequestHeader("Content-Type", type || file.type || "image/jpeg");
    x.upload.onprogress = (e) => e.lengthComputable && onp(e.loaded / e.total);
    x.onload = () => (x.status < 300 ? ok() : fail(new Error(`S3 returned ${x.status}`)));
    x.onerror = () => fail(new Error("Network error / CORS blocked")); x.send(file);
  });
}
async function pool(tasks, n) { const q = tasks.slice(); await Promise.all(Array.from({ length: n }, async () => { while (q.length) await q.shift()(); })); }

function settingsModal() {
  modal(`<h3>Connect to the Google Sheet</h3>
    <p class="muted">Paste the Apps Script web-app URL and the editor key from the setup guide. They’re stored only in this browser.</p>
    <div class="frm"><label>Apps Script web-app URL <input id="su" value="${esc(settings.url)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
    <label>Editor key <input id="sk" type="password" value="${esc(settings.key)}"></label>
    <label>Your name (for the edit log) <input id="sn" value="${esc(settings.name)}"></label></div>
    <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="sok">Connect</button></div>`, (b) => {
    $("#sok", b).onclick = async () => {
      Object.assign(settings, { url: $("#su", b).value.trim(), key: $("#sk", b).value, name: $("#sn", b).value.trim() });
      LS.set("settings", settings); closeModal(); mode = "demo"; await load();
    };
  });
}

let toastT;
function toast(msg, ms = 3500) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); }

// ------------------------------------------------------------------ events
{ const d = LS.get("viewer", null); if (d) Object.assign(VIEW, VIEW_DEFAULTS, d); } // unsaved viewer settings being previewed in this browser
if (CFG.hub) document.getElementById("hubTool").hidden = false;
if (CFG.hubSite && CFG.hubSite.map) document.getElementById("placesTool").hidden = false;
applyPhotoTheme();
const lb = new Lightbox({ fieldsFor: () => fields, onIndex: (r) => { if (byId.has(r._id)) { currentId = null; const i = view.indexOf(r); if (i >= 0) setActive(i, active.c); } } });
function bind() {
  $("#q").addEventListener("input", debounce((e) => { filter.q = e.target.value.trim(); refresh(false); }, 200));
  $("#boxSel").onchange = (e) => { filter.box = e.target.value; refresh(false); };
  $("#issues").onclick = (e) => { if (e.target.id === "fixShift") return repairShifted(); const b = e.target.closest("[data-issue]"); if (!b) return; filter.issue = filter.issue === b.dataset.issue ? "" : b.dataset.issue; refresh(false); };
  $("#clear").onclick = () => { filter = { q: "", box: "", issue: "" }; $("#q").value = ""; $("#boxSel").value = ""; refresh(false); };
  $("#chips").onclick = (e) => { const c = e.target.closest("[data-chip]"); if (!c) return; filter[c.dataset.chip] = ""; if (c.dataset.chip === "q") $("#q").value = ""; if (c.dataset.chip === "box") $("#boxSel").value = ""; refresh(false); };
  $("#selAll").onclick = () => { view.forEach((r) => selected.add(r._id)); drawRows(); renderBar(); };
  $("#selNone").onclick = () => { selected.clear(); drawRows(); renderBar(); };

  const sheet = $("#sheet");
  let raf = 0;
  sheet.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (!editing) drawRows(); }); }, { passive: true });
  sheet.addEventListener("click", (e) => {
    if (e.target.id === "selPage") { const on = e.target.checked; view.forEach((r) => (on ? selected.add(r._id) : selected.delete(r._id))); drawRows(); renderBar(); return; }
    const row = e.target.closest(".sh-r"); if (!row) return;
    const i = +row.dataset.i;
    if (e.target.matches('input[type="checkbox"]')) { const id = view[i]._id; e.target.checked ? selected.add(id) : selected.delete(id); row.classList.toggle("sel", e.target.checked); renderBar(); return; }
    if (e.target.closest(".img")) { lb.open(view, i); return; }
    const c = e.target.closest(".sh-c[data-c]");
    if (c && !e.target.classList.contains("cell-input")) { if (editing) commitEdit(); setActive(i, +c.dataset.c, false); sheet.focus(); }
  });
  sheet.addEventListener("dblclick", (e) => { if (e.target.closest(".sh-c[data-c]")) startEdit(); });
  sheet.addEventListener("keydown", (e) => {
    if (editing || !view.length) return;
    const k = e.key;
    if (k === "ArrowDown") setActive(active.r + 1, active.c);
    else if (k === "ArrowUp") setActive(active.r - 1, active.c);
    else if (k === "ArrowRight" || (k === "Tab" && !e.shiftKey)) setActive(active.r, active.c + 1);
    else if (k === "ArrowLeft" || (k === "Tab" && e.shiftKey)) setActive(active.r, active.c - 1);
    else if (k === "PageDown") setActive(active.r + 15, active.c);
    else if (k === "PageUp") setActive(active.r - 15, active.c);
    else if (k === "Enter" || k === "F2") startEdit();
    else if (k === " ") lb.open(view, active.r);
    else if (k === "Backspace" || k === "Delete") { setValue(view[active.r], cols[active.c], ""); drawRows(); renderBar(); openForm(view[active.r]._id); }
    else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { startEdit(k); }
    else return;
    e.preventDefault();
  });
  document.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); if (editing) commitEdit(); save(); } });

  const form = $("#form");
  form.addEventListener("change", (e) => {
    const el = e.target.closest("[data-f]"); if (!el) return;
    const r = byId.get(currentId); setValue(r, el.dataset.f, el.value);
    el.closest("label").classList.toggle("dirty", isDirty(r, el.dataset.f)); drawRows(); renderBar();
  });
  form.addEventListener("click", (e) => {
    const n = e.target.closest("[data-nav]"); if (n) { setActive(active.r + +n.dataset.nav, active.c); return; }
    if (e.target.closest("[data-open]")) { const i = view.findIndex((r) => r._id === currentId); lb.open(i >= 0 ? view : [byId.get(currentId)], Math.max(0, i)); return; }
    const rv = e.target.closest("[data-revert]"); if (rv) { e.preventDefault(); const r = byId.get(currentId), f = rv.dataset.revert; setValue(r, f, original.get(r._id)?.[f] ?? r[f]); openForm(currentId); renderBar(); }
  });

  $("#saveBtn").onclick = save;
  $("#publishBtn").onclick = publish;
  $("#settingsBtn").onclick = settingsModal;
  // one-image-per-record archives only; multi-image archives (coins) add images through the Sheet for now
  if (ED.upload === false || ROLE.images.length !== 1) $("#addBtn").hidden = true; else $("#addBtn").onclick = addImages;
  $("#toolsBtn").onclick = (e) => { e.stopPropagation(); $("#toolsMenu").hidden = !$("#toolsMenu").hidden; };
  document.addEventListener("click", () => ($("#toolsMenu").hidden = true));
  $("#toolsMenu").onclick = (e) => { const t = e.target.closest("[data-tool]"); if (t) TOOLS[t.dataset.tool](); };
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });
  addEventListener("beforeunload", (e) => { if (pending.size && mode === "live") { e.preventDefault(); e.returnValue = ""; } });
  new ResizeObserver(() => drawRows()).observe(sheet);
}

bind();
load().catch((e) => { $("#count").textContent = "Couldn’t load: " + e.message; });
