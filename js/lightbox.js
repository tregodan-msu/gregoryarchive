// Fullscreen single-image viewer: next/prev, rotate, zoom + pan, all metadata,
// download, keyboard, filmstrip, shareable link. Ported from the Airtable extension.
import { CFG, ROLE, GROUP, VIEW, viewerPrefs, saveViewerPref, currentBg, applyPhotoTheme, label, titleOf, imageCount, imageLabel, fullUrl, mediumUrl, thumbUrl, downloadUrl, originalsHidden, attachFallback, esc, fmtN, uri } from "./data.js";
import { analyze, screenPpm, setScreenPpm, DEFAULT_PPM, scaleSvg } from "./imgtools.js";

const ICON = {
  prev: '<path d="M15 18l-6-6 6-6"/>', next: '<path d="M9 18l6-6-6-6"/>',
  rotL: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  rotR: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  zin: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
  zout: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  fs: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  bg: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  ruler: '<rect x="2" y="8" width="20" height="8" rx="1"/><path d="M6 8v3M10 8v4M14 8v3M18 8v4"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

export class Lightbox {
  // set (optional): lets the viewer narrow and reorder the records it steps through without closing:
  //   { sorts: [[key, label]], sort: () => key, setSort(key), chips: () => [{ k, label }], remove(k), clear(), filter(field, value) }
  //   setSort / remove / clear / filter change the page's own filters and sort, then hand back the new list (see setList).
  constructor({ onFilter, onClose, onIndex, onEdit, fieldsFor, set, edit } = {}) {
    this.set = set || null;
    // the editor passes `edit` ({get, set, dirty, readonly, textarea, status, save}): the info panel then shows every
    // field as an input, empty ones too, and a Save button; nothing else about the viewer changes
    this.edit = edit || null;
    this.onFilter = onFilter; this.onClose = onClose; this.onIndex = onIndex; this.onEdit = onEdit;
    this.fieldsFor = fieldsFor || ((r) => Object.keys(r).filter((k) => !k.startsWith("_")));
    this.list = []; this.i = 0; this.k = 0; this.rot = 0; this.zoom = 1; this.tx = 0; this.ty = 0;
    // what a visitor sets stays set from image to image and from visit to visit (viewerPrefs, kept in this browser):
    // info panel open / closed and its tab, the fields they chose, which side of a two-sided record, background, scale bar.
    // Zoom and position stay while moving through images (this.keep) and start again from "fit" when the viewer is reopened.
    const P = viewerPrefs();
    this.showInfo = P.info ?? matchMedia("(min-width: 800px)").matches;
    this.allFields = P.tab ? P.tab === "all" : VIEW.infoDefault !== "key";
    this.myFields = Array.isArray(P.fields) ? P.fields : null;  // the visitor's own pick of fields, instead of the site's key fields
    this.choosing = false;
    this.sideK = +P.side || 0;
    this.keep = null;  // null = fit; {life: 2} = 200% of actual size (records with a known size); {z: 2.5} = 2.5 × the fitted view
    this.bg = currentBg();
    this.scaleOn = viewerPrefs().scale ?? VIEW.scaleOn !== false;
    this.meas = null; this.mode = "fit";
    this.build();
  }

  build() {
    const el = (this.el = document.createElement("div"));
    el.className = "lb"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    el.innerHTML = `
      <header class="lb-head">
        <div class="lb-title"><span class="lb-pos"></span><h2></h2></div>
        <div class="lb-sides" hidden></div>
        <div class="lb-tools">
          <button data-a="rotL" title="Rotate left (Shift+R)">${svg("rotL")}</button>
          <button data-a="rotR" title="Rotate right (R)">${svg("rotR")}</button>
          <button data-a="zout" title="Zoom out (−)">${svg("zout")}</button>
          <label class="lb-zoom" title="Zoom"><span>Fit</span><select aria-label="Zoom"></select></label>
          <button data-a="zin" title="Zoom in (+)">${svg("zin")}</button>
          <button data-a="fit" title="Fit (0)">${svg("fit")}</button>
          <span class="sep"></span>
          <button data-a="scale" title="Scale bar (M)" hidden>${svg("ruler")}</button>
          <button data-a="bg" title="Black / white background (B)">${svg("bg")}</button>
          <button data-a="info" title="Information (I)">${svg("info")}</button>
          <button data-a="edit" title="Edit record (E)" hidden>${svg("edit")}</button>
          <a data-a="dl" title="Download original" target="_blank" rel="noopener">${svg("dl")}</a>
          <button data-a="link" title="Copy permanent link">${svg("link")}</button>
          <button data-a="fs" title="Fullscreen (F)">${svg("fs")}</button>
          <button data-a="close" title="Close (Esc)">${svg("close")}</button>
        </div>
      </header>
      <div class="lb-set" hidden><div class="lb-chips"></div><label class="lb-sort">Sort <select aria-label="Sort"></select></label></div>
      <div class="lb-body">
        <aside class="lb-info"><div class="lb-info-tabs"><button data-t="key">Key fields</button><button data-t="all">All fields</button></div><div class="lb-choose"></div><dl></dl></aside>
        <div class="lb-stage">
          <img class="lb-img" alt="" draggable="false">
          <div class="lb-spin"></div>
          <button class="lb-nav prev" data-a="prev" title="Previous (←)">${svg("prev")}</button>
          <button class="lb-nav next" data-a="next" title="Next (→)">${svg("next")}</button>
          <div class="lb-res"></div>
          <div class="lb-scale" hidden></div>
          <div class="lb-cal" hidden></div>
        </div>
      </div>
      <footer class="lb-strip"></footer>
      <div class="lb-toast" hidden></div>`;
    document.body.appendChild(el);
    this.img = el.querySelector(".lb-img");
    this.stage = el.querySelector(".lb-stage");
    if (this.onEdit) el.querySelector('[data-a="edit"]').hidden = false;

    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (b) { if (b.dataset.a !== "dl") e.preventDefault(); this.act(b.dataset.a); return; }
      const t = e.target.closest("[data-t]");
      if (t) {
        this.choosing = false; this.allFields = t.dataset.t === "all"; saveViewerPref("tab", this.allFields ? "all" : "key");
        this.renderInfo(); return;
      }
      const pk = e.target.closest("[data-pk]");
      if (pk) {
        if (pk.dataset.pk === "toggle") this.choosing = !this.choosing;
        else { if (pk.dataset.pk === "reset") { this.myFields = null; saveViewerPref("fields", null); } this.choosing = false; }
        this.renderInfo(); return;
      }
      if (this.choosing && !e.target.closest(".lb-choose")) { this.choosing = false; this.renderInfo(); }
      const f = e.target.closest("[data-ff]");
      if (f && this.set) { e.preventDefault(); this.setList(this.set.filter(f.dataset.ff, f.dataset.fv), `${label(f.dataset.ff)}: ${f.dataset.fv}`); return; }
      if (f && this.onFilter) { this.onFilter(f.dataset.ff, f.dataset.fv); this.close(); return; }
      const ch = e.target.closest("[data-chip]");
      if (ch && this.set) { this.setList(ch.dataset.chip === "*" ? this.set.clear() : this.set.remove(ch.dataset.chip)); return; }
      const sd = e.target.closest("[data-side]");
      if (sd) { this.side(+sd.dataset.side); return; }
      const s = e.target.closest("[data-si]");
      if (s) this.go(+s.dataset.si);
    });
    el.addEventListener("change", (e) => {
      const c = e.target.closest("[data-pf]"); if (!c) return;
      const all = this.fieldsFor(this.rec), on = new Set(this.keyFields());
      c.checked ? on.add(c.value) : on.delete(c.value);
      this.myFields = [...this.keyFields().filter((f) => on.has(f)), ...all.filter((f) => on.has(f) && !this.keyFields().includes(f))];
      this.allFields = false; saveViewerPref("fields", this.myFields); saveViewerPref("tab", "key");
      this.renderInfo(true);  // the fields below follow each tick; the open list stays as it is
    });
    if (this.set) {
      const ss = el.querySelector(".lb-sort select");
      ss.innerHTML = this.set.sorts.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join("");
      ss.addEventListener("change", () => this.setList(this.set.setSort(ss.value)));
      el.querySelector(".lb-set").hidden = false;
    }
    this.zsel = el.querySelector(".lb-zoom select");
    this.zsel.addEventListener("change", () => { const v = this.zsel.value; this.zsel.value = ""; this.zoomTo(v); });
    this.keyHandler = (e) => this.key(e);
    addEventListener("resize", () => { if (!this.el.hidden) this.apply(); });

    // pan + wheel zoom
    let drag = null;
    this.stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button, .lb-cal")) return;
      drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, moved: false };
      this.stage.setPointerCapture(e.pointerId);
    });
    this.stage.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (this.zoom !== 1) { this.tx = drag.tx + dx; this.ty = drag.ty + dy; this.apply(); }
    });
    this.stage.addEventListener("pointerup", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (this.zoom === 1 && drag.moved && Math.abs(dx) > 60) this.go(this.i + (dx < 0 ? 1 : -1)); // swipe
      drag = null;
    });
    el.addEventListener("change", (e) => {
      const inp = e.target.closest("[data-ef]"); if (!inp || !this.edit) return;
      this.edit.set(this.rec, inp.dataset.ef, inp.value);
      inp.classList.toggle("dirty", this.edit.dirty(this.rec, inp.dataset.ef));
      this.renderEditStatus();
    });
    el.addEventListener("click", (e) => {
      if (!e.target.closest("[data-es]") || !this.edit) return;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      setTimeout(() => Promise.resolve(this.edit.save()).then(() => { if (!this.el.hidden) this.renderInfo(); }), 0);
    });
    this.stage.addEventListener("dblclick", (e) => { this.zoom !== 1 ? this.fit() : this.setZoom(2.5, e); });
    this.stage.addEventListener("wheel", (e) => { if (e.target.closest(".lb-cal")) return; e.preventDefault(); this.setZoom(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e); }, { passive: false });
  }

  open(list, index) {
    this.list = list; this.el.hidden = false; document.body.classList.add("lb-open");
    document.addEventListener("keydown", this.keyHandler);
    this.el.classList.toggle("noinfo", !this.showInfo);
    this.theme();
    this.keep = null; this.zoom = 1; this.tx = this.ty = 0;
    this.go(index, true);
  }
  close() {
    if (this.el.hidden) return;
    this.el.hidden = true; document.body.classList.remove("lb-open");
    document.removeEventListener("keydown", this.keyHandler);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.onClose && this.onClose();
  }
  get rec() { return this.list[this.i]; }
  // A new set of records after a filter or sort change made in the viewer: stay on the image being shown.
  setList(list, said) {
    const r = this.rec; if (!r || !list) return;
    let i = list.indexOf(r);
    if (i < 0) { list = [r, ...list]; i = 0; }  // the image on screen is outside the filters (opened by its link): keep it, first in line
    this.list = list; this.i = i;
    this.renderPos(); this.renderSet(); this.renderInfo(); this.renderStrip(); this.prefetch();
    if (said) this.toast(`${fmtN(list.length)} with ${said}`);
  }
  renderPos() { this.el.querySelector(".lb-pos").textContent = `${fmtN(this.i + 1)} / ${fmtN(this.list.length)}`; }
  // the bar under the header: active filters as chips (× removes one), and the sort order
  renderSet() {
    if (!this.set) return;
    const chips = this.set.chips();
    this.el.querySelector(".lb-chips").innerHTML = chips.length
      ? chips.map((c) => `<button data-chip="${esc(c.k)}" title="Remove this filter">${esc(c.label)}<span>×</span></button>`).join("") + (chips.length > 1 ? `<button data-chip="*" class="all">Clear all</button>` : "")
      : `<span class="lb-hint">No filters. Click a linked value in the information panel to show only records like it.</span>`;
    this.el.querySelector(".lb-sort select").value = this.set.sort();
  }

  go(i, first) {
    if (!this.list.length) return;
    i = (i + this.list.length) % this.list.length;
    this.i = i; this.rot = 0;
    const r = this.rec;
    this.k = Math.min(this.sideK, Math.max(0, imageCount(r) - 1));  // stay on the side last chosen (obverse / reverse)
    if (!this.keep) { this.zoom = 1; this.tx = this.ty = 0; }       // else zoom and position carry over (restore(), once the image is in)
    this.choosing = false;
    this.renderPos(); this.renderSet();
    this.el.querySelector("h2").textContent = titleOf(r);
    this.renderSides(r);
    this.loadImage(r);
    this.renderInfo(); this.renderStrip();
    this.prefetch();
    this.onIndex && this.onIndex(r, i);
  }

  // records with several images (coin obverse / reverse): a switch in the header, S key flips
  renderSides(r) {
    const n = imageCount(r), box = this.el.querySelector(".lb-sides");
    box.hidden = n < 2;
    box.innerHTML = n < 2 ? "" : Array.from({ length: n }, (_, k) => `<button data-side="${k}" class="${k === this.k ? "on" : ""}">${esc(imageLabel(k) || "Image " + (k + 1))}</button>`).join("");
  }
  side(k) {
    const r = this.rec, n = imageCount(r); if (n < 2) return;
    this.k = this.sideK = (k + n) % n; saveViewerPref("side", this.sideK);
    this.rot = 0; if (!this.keep) { this.zoom = 1; this.tx = this.ty = 0; }
    this.renderSides(r); this.loadImage(r);
  }
  loadImage(r) {
    const k = this.k, img = this.img, med = mediumUrl(r, k), full = fullUrl(r, k);
    const dl = this.el.querySelector('[data-a="dl"]'); dl.href = downloadUrl(r, k);
    dl.title = originalsHidden() ? "Download image (1600 px)" : "Download original";
    this.el.classList.add("loading");
    img.onload = () => { this.el.classList.remove("loading"); this.restore(); this.apply(); };
    attachFallback(img, r, k);
    this.measure(r, k, med);
    img.src = med; this.res = !full || med === full ? "full" : "medium"; // no original to switch to when hidden
    this.el.querySelector(".lb-res").textContent = this.res === "full" ? "" : "Preview · zoom in for full resolution";
  }
  upgrade() {
    // switch to the original scan when zooming past fit
    if (this.res === "full") return;
    const r = this.rec, k = this.k, full = fullUrl(r, k), pre = new Image();
    this.res = "full";
    this.el.querySelector(".lb-res").textContent = "Loading full resolution…";
    pre.onload = () => { if (this.rec === r && this.k === k) { this.img.src = full; this.el.querySelector(".lb-res").textContent = ""; } };
    pre.src = full;
  }
  prefetch() {
    for (const d of [1, -1, 2]) {
      const r = this.list[(this.i + d + this.list.length) % this.list.length];
      if (r) new Image().src = mediumUrl(r);
    }
  }

  // Two tabs: Key fields (left) and All fields (right). Under Key fields, a small "Choose fields" dropdown: a tick list
  // of every field, the visitor's own choice of key fields, kept in this browser. The viewer in the editor is the same.
  renderInfo(keepChooser) {
    const r = this.rec; if (!r) return;
    this.el.querySelectorAll("[data-t]").forEach((b) => b.classList.toggle("on", (b.dataset.t === "all") === this.allFields));
    const ch = this.el.querySelector(".lb-choose");
    ch.hidden = this.allFields;
    if (this.allFields) this.choosing = false;
    if (!keepChooser || !this.choosing) {
      const on = new Set(this.keyFields());
      ch.innerHTML = `<button class="lb-choose-btn ${this.choosing ? "on" : ""}" data-pk="toggle" aria-expanded="${this.choosing}">Choose fields${this.myFields ? " (your choice)" : ""}<span>▾</span></button>` +
        (this.choosing ? `<div class="lb-pick">${this.fieldsFor(r).map((f) => `<label><input type="checkbox" data-pf value="${esc(f)}" ${on.has(f) ? "checked" : ""}> ${esc(label(f))}</label>`).join("")}
          <div class="lb-pick-actions"><button data-pk="reset">Site’s choice</button><button data-pk="done" class="on">Done</button></div></div>` : "");
    }
    const fields = this.allFields ? this.fieldsFor(r) : this.keyFields();
    if (this.edit) {
      const E = this.edit, known = new Set(this.fieldsFor(r));
      const row = (f) => {
        const v = esc(E.get(r, f)), cls = E.dirty(r, f) ? ' class="dirty"' : "";
        if (!known.has(f) || E.readonly(f)) return `<dt>${esc(label(f))}</dt><dd>${v}</dd>`;
        return `<dt>${esc(label(f))}</dt><dd>${E.textarea(f) ? `<textarea rows="2" data-ef="${esc(f)}"${cls}>${v}</textarea>` : `<input data-ef="${esc(f)}" value="${v}"${cls}>`}</dd>`;
      };
      this.el.querySelector(".lb-info dl").innerHTML = `<dt>ID</dt><dd>${esc(r._id)}</dd>` + fields.map(row).join("") +
        `<div class="lb-edit-actions"><span class="lb-edit-n"></span><button data-es>Save</button></div>`;
      this.renderEditStatus();
      return;
    }
    const filterable = new Set([...CFG.facetFields, ...(CFG.linkFields || []), GROUP && GROUP.field].filter(Boolean));
    const rows = fields.filter((f) => r[f] != null && String(r[f]).trim() !== "").map((f) => {
      const v = esc(r[f]);
      const val = filterable.has(f) && (this.onFilter || this.set) ? `<a href="#" data-ff="${esc(f)}" data-fv="${v}" title="${this.set ? "Show only records" : "Show all"} with this ${esc(label(f))}">${v}</a>` : /^https?:\/\//.test(r[f]) ? `<a href="${v}" target="_blank" rel="noopener">${v}</a>` : v;
      return `<dt>${esc(label(f))}</dt><dd>${val}</dd>`;
    });
    // the ID line is skipped when the ID is a visible field already (e.g. a coin's inventory number)
    if (r._id && !String(r._id).startsWith("r")) rows.unshift(...(r[ROLE.id] === r._id ? [] : [`<dt>ID</dt><dd>${esc(r._id)}</dd>`]), `<dt>Permanent link</dt><dd><a href="${esc(uri(r))}" target="_blank" rel="noopener">${esc(uri(r))}</a></dd>`);
    if (r._lat != null) rows.push(`<dt>Map</dt><dd><a href="https://www.openstreetmap.org/?mlat=${r._lat}&mlon=${r._lng}#map=14/${r._lat}/${r._lng}" target="_blank" rel="noopener">Open in OpenStreetMap</a></dd>`);
    this.el.querySelector(".lb-info dl").innerHTML = rows.join("") || "<dd class='muted'>No metadata for this record.</dd>";
  }

  renderEditStatus() {
    const n = this.el.querySelector(".lb-edit-n"); if (!n || !this.edit) return;
    const s = this.edit.status();
    n.textContent = s.text; this.el.querySelector("[data-es]").disabled = !s.dirty;
  }

  // fields on the "Key fields" tab: the visitor's own pick, else the site's (editor → Tools → Fields shown), else site.json keyFields
  keyFields() { return this.myFields || (VIEW.fields && VIEW.fields.length ? VIEW.fields : CFG.keyFields) || []; }

  renderStrip() {
    const n = this.list.length, out = [];
    for (let d = -7; d <= 7; d++) {
      if (n < 15 && (d < -Math.floor((n - 1) / 2) || d > Math.ceil((n - 1) / 2))) continue;
      const j = (this.i + d + n) % n, r = this.list[j];
      out.push(`<button data-si="${j}" class="${d === 0 ? "on" : ""}"><img loading="lazy" src="${esc(thumbUrl(r))}" alt=""${r._cut === 0 ? ' class="keep"' : ""}></button>`);
    }
    const strip = this.el.querySelector(".lb-strip");
    strip.innerHTML = out.join("");
    strip.querySelectorAll("img").forEach((im, k) => attachFallback(im, this.list[+strip.children[k].dataset.si]));
  }

  // ---------------------------------------------------------------- background, cut-out, scale
  theme() {
    const c = this.el.classList, light = this.bg === "light";
    c.toggle("light", light); c.toggle("dark", !light);
    c.toggle("cut", !!VIEW.removeBg);
    this.el.querySelector('[data-a="scale"]').hidden = !VIEW.scale;
    this.el.querySelector('[data-a="scale"]').classList.toggle("on", this.scaleOn);
  }
  // Reads the photo to find the object and build the cut-out. Until (or unless) that works,
  // the "cutfb" class hides the backdrop with a blend / filter, and the scale uses the estimate.
  measure(r, k, url) {
    this.meas = null; this.setMask(null);
    const cut = !!VIEW.removeBg && r._cut !== 0; // combined sites mark which records have a plain backdrop
    const want = cut || (VIEW.scale && this.diameter());
    this.el.classList.toggle("cutfb", cut);
    if (!want || !url) return;
    analyze(url, VIEW.bgTolerance).then((m) => {
      if (this.rec !== r || this.k !== k || this.el.hidden) return;
      this.meas = m;
      if (m.ok && cut) { this.setMask(m.mask); this.el.classList.remove("cutfb"); }
      else if (m.reason === "busy") this.el.classList.remove("cutfb"); // a full-frame photo: nothing to hide
      this.restore(); this.apply();
    });
  }
  setMask(url) {
    const st = this.img.style, v = url ? `url("${url}")` : "";
    st.webkitMaskImage = st.maskImage = v;
    st.webkitMaskRepeat = st.maskRepeat = url ? "no-repeat" : "";
    st.webkitMaskPosition = st.maskPosition = url ? "center" : "";
  }
  // millimetres of the object in this record, or null
  diameter() {
    if (!VIEW.scale || !this.rec) return null;
    const v = parseFloat(String(this.rec[VIEW.scale.field] ?? "").replace(",", "."));
    return v > 0 ? v * ({ cm: 10, m: 1000 }[VIEW.scale.unit] || 1) : null;
  }
  // screen pixels per millimetre of the object at zoom 1 (image fitted to the stage), or null
  ppmAtFit() {
    const d = this.diameter(), im = this.img;
    if (!d || !im.naturalWidth) return null;
    const k = Math.min(im.clientWidth / im.naturalWidth, im.clientHeight / im.naturalHeight);
    const measured = this.meas && this.meas.ok;
    const objPx = measured ? this.meas.size * im.naturalWidth : (VIEW.scale.fill || 0.8) * Math.min(im.naturalWidth, im.naturalHeight);
    return { ppm: (objPx * k * this.rotFit()) / d, approx: !measured };
  }
  rotFit() {
    // when turned sideways, shrink so the whole rotated image still fits the stage
    const im = this.img;
    if (Math.abs(this.rot) % 180 !== 90 || !im.naturalWidth) return 1;
    const W = im.clientWidth, H = im.clientHeight, k = Math.min(W / im.naturalWidth, H / im.naturalHeight);
    return Math.min(W / (im.naturalHeight * k), H / (im.naturalWidth * k), 1);
  }

  apply() {
    const im = this.img, fit = this.rotFit();
    im.style.transform = `translate(${this.tx}px, ${this.ty}px) rotate(${this.rot}deg) scale(${this.zoom * fit})`;
    if (im.naturalWidth && im.style.maskImage) {
      const k = Math.min(im.clientWidth / im.naturalWidth, im.clientHeight / im.naturalHeight);
      im.style.webkitMaskSize = im.style.maskSize = `${im.naturalWidth * k}px ${im.naturalHeight * k}px`;
    }
    this.stage.classList.toggle("zoomed", this.zoom !== 1);

    // zoom read-out and menu: % of real size when the object's size is known, else % of the fitted view
    const f = this.ppmAtFit(), life = f ? (f.ppm * this.zoom) / screenPpm() : null;
    const pct = life != null ? life * 100 : this.zoom * 100;
    this.el.querySelector(".lb-zoom span").textContent = (this.zoom === 1 ? "Fit · " : "") + (pct >= 10 ? Math.round(pct) : pct.toFixed(1)) + "%";
    const menuKey = f ? "life" : "plain";
    if (this.zsel.dataset.k !== menuKey) {
      this.zsel.dataset.k = menuKey;
      this.zsel.innerHTML = `<option value="" disabled selected>${f ? "Zoom (% of actual size)" : "Zoom"}</option><option value="fit">Fit to screen</option>` +
        (f ? `<option value="l0.5">50%</option><option value="l1">Actual size (100%)</option><option value="l2">200%</option><option value="l4">400%</option><option value="l8">800%</option><option value="l16">1600%</option><option value="cal">Calibrate screen size…</option>`
           : `<option value="z1.5">150%</option><option value="z2.5">250%</option><option value="z4">400%</option><option value="z8">800%</option>`);
    }
    // scale bar
    const sc = this.el.querySelector(".lb-scale"), show = !!(f && this.scaleOn);
    sc.hidden = !show;
    if (show) {
      const key = `${(f.ppm * this.zoom).toFixed(3)}|${f.approx}|${this.stage.clientWidth}`;
      if (sc.dataset.k !== key) {
        sc.dataset.k = key;
        sc.innerHTML = scaleSvg(f.ppm * this.zoom, Math.min(300, this.stage.clientWidth * 0.45), f.approx);
        sc.title = f.approx ? "Approximate scale: this photo could not be measured, so the object is assumed to fill a set share of the frame." : "Scale worked out from the recorded diameter.";
      }
    }
  }
  fit() { this.keep = null; this.zoom = 1; this.tx = 0; this.ty = 0; this.apply(); }
  // remember the zoom just chosen: as a share of actual size where the record's size is known (so every coin
  // then shows at the same real scale), else as a multiple of the fitted view
  remember() {
    if (this.zoom === 1) { this.keep = null; return; }
    const f = this.ppmAtFit();
    this.keep = f ? { life: (f.ppm * this.zoom) / screenPpm(), z: this.zoom } : { z: this.zoom };
  }
  // put the remembered zoom back on a newly loaded image (called when it loads and again when it has been measured)
  restore() {
    if (!this.keep) return;
    const f = this.keep.life ? this.ppmAtFit() : null, max = this.diameter() ? 40 : 8, min = this.diameter() ? 0.02 : 0.2;
    this.zoom = Math.max(min, Math.min(max, f ? (this.keep.life * screenPpm()) / f.ppm : this.keep.z));
    if (this.zoom > 1.2) this.upgrade();
  }
  zoomTo(v) {
    if (v === "fit") return this.fit();
    if (v === "cal") return this.calibrate();
    if (v[0] === "z") return this.setZoom(+v.slice(1));
    const f = this.ppmAtFit(); if (!f) return;
    this.tx = this.ty = 0;
    this.setZoom((+v.slice(1) * screenPpm()) / f.ppm);
    if (f.approx) this.toast("Approximate: this photo could not be measured");
  }
  // one-off per device: match an on-screen box to a real bank card so "actual size" is true to life
  calibrate() {
    const box = this.el.querySelector(".lb-cal"); let ppm = screenPpm();
    box.hidden = false;
    box.innerHTML = `<b>Calibrate this screen</b><p>Hold a bank card (85.6 mm wide) against the screen and drag the slider until the box is exactly as wide as the card.</p>
      <div class="lb-card"></div><input type="range" min="2" max="9" step="0.005" value="${ppm}" aria-label="Box width">
      <div class="lb-cal-actions"><button data-c="reset">Reset</button><button data-c="ok">Done</button></div>`;
    const card = box.querySelector(".lb-card"), draw = () => { card.style.width = 85.6 * ppm + "px"; card.style.height = 53.98 * ppm + "px"; };
    draw();
    box.querySelector("input").oninput = (e) => { ppm = +e.target.value; draw(); };
    box.querySelector('[data-c="reset"]').onclick = () => { ppm = DEFAULT_PPM; box.querySelector("input").value = ppm; draw(); };
    box.querySelector('[data-c="ok"]').onclick = () => { setScreenPpm(Math.abs(ppm - DEFAULT_PPM) < 0.003 ? null : ppm); box.hidden = true; this.apply(); };
  }
  setZoom(z, e) {
    z = Math.max(this.diameter() ? 0.02 : 0.2, Math.min(this.diameter() ? 40 : 8, z));
    if (Math.abs(z - 1) < 0.04 && e) z = 1;
    if (e && e.clientX != null) {
      const b = this.stage.getBoundingClientRect();
      const cx = e.clientX - b.left - b.width / 2, cy = e.clientY - b.top - b.height / 2;
      this.tx = cx - (cx - this.tx) * (z / this.zoom); this.ty = cy - (cy - this.ty) * (z / this.zoom);
    } else { this.tx *= z / this.zoom; this.ty *= z / this.zoom; }
    this.zoom = z; if (z === 1) { this.tx = this.ty = 0; }
    if (z > 1.2) this.upgrade();
    this.apply();
    this.remember();
  }

  async act(a) {
    switch (a) {
      case "prev": return this.go(this.i - 1);
      case "next": return this.go(this.i + 1);
      case "rotL": this.rot -= 90; return this.apply();
      case "rotR": this.rot += 90; return this.apply();
      case "zin": return this.setZoom(this.zoom * 1.5);
      case "zout": return this.setZoom(this.zoom / 1.5);
      case "fit": return this.fit();
      case "bg": this.bg = this.bg === "light" ? "dark" : "light"; saveViewerPref("bg", this.bg); this.theme(); applyPhotoTheme(); return;
      case "scale": this.scaleOn = !this.scaleOn; saveViewerPref("scale", this.scaleOn); this.theme(); return this.apply();
      case "info": this.showInfo = !this.showInfo; saveViewerPref("info", this.showInfo); this.el.classList.toggle("noinfo", !this.showInfo); return;
      case "edit": return this.onEdit && this.onEdit(this.rec);
      case "close": return this.close();
      case "fs":
        try { document.fullscreenElement ? await document.exitFullscreen() : await this.el.requestFullscreen(); } catch {}
        return;
      case "link":
        try { await navigator.clipboard.writeText(uri(this.rec)); this.toast("Permanent link copied"); }
        catch { this.toast(uri(this.rec)); }
    }
  }
  toast(msg) {
    const t = this.el.querySelector(".lb-toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(this._tt); this._tt = setTimeout(() => (t.hidden = true), 2200);
  }
  key(e) {
    if (e.target.closest("input, textarea, select")) return;
    const k = e.key;
    if (k === "ArrowRight" || k === "j") this.act("next");
    else if (k === "ArrowLeft" || k === "k") this.act("prev");
    else if (k === "Escape") { if (!document.fullscreenElement) this.close(); }
    else if (k === "r") this.act("rotR");
    else if (k === "R") this.act("rotL");
    else if (k === "+" || k === "=") this.act("zin");
    else if (k === "-" || k === "_") this.act("zout");
    else if (k === "0") this.act("fit");
    else if (k === "i") this.act("info");
    else if (k === "f") this.act("fs");
    else if (k === "e" && this.onEdit) this.act("edit");
    else if (k === "s") this.side(this.k + 1);
    else if (k === "b") this.act("bg");
    else if (k === "m" && VIEW.scale) this.act("scale");
    else if (k === "1" && this.diameter()) this.zoomTo("l1");
    else return;
    e.preventDefault();
  }
}
