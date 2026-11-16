// Info pages editor: one site's Info tab (its list of pages, their titles and their text), edited in place and saved
// to the private repo with the GitHub key (js/gate.js). Opened from an archive's editor (Tools → Info pages) and
// from the overview page (any site, including the combined one). Saves, in one commit:
//   sites/<site>/pages.json         the tab name, the footer and the list of pages (wins over "pages" in site.json)
//   sites/<site>/pages/<slug>.html  the text of each page that was changed
// A page the site hasn't written yet shows the standard placeholder from core/pages/; it becomes the site's own copy
// the first time it is saved. The commit republishes the site (about 2 minutes).
import { getText, putFiles } from "./gate.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const RESERVED = new Set(["css", "js", "data", "img", "media", "admin", "pages", "edit", "coin", "slide", "record"]);
const slugify = (t) => t.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "page";

const CSS = `
.pe-bg { position: fixed; inset: 0; z-index: 80; background: rgba(20,16,12,.5); display: grid; place-items: center; padding: 14px; }
.pe { background: var(--panel, #fff); border-radius: 14px; width: min(1180px, 100%); height: min(860px, calc(100vh - 28px)); display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
.pe-head, .pe-foot { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--line, #e5ded5); }
.pe-foot { border-bottom: 0; border-top: 1px solid var(--line, #e5ded5); }
.pe-head h3 { margin: 0; font: 600 19px var(--serif, Georgia, serif); flex: 1; }
.pe-foot .pe-msg { flex: 1; color: var(--muted, #8b8178); font-size: 13px; }
.pe-body { flex: 1; display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 0; }
.pe-side { border-right: 1px solid var(--line, #e5ded5); padding: 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; font-size: 14px; }
.pe-side label, .pe-meta label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted, #8b8178); font-weight: 500; }
.pe input, .pe textarea { font: 14px var(--sans, system-ui); padding: 7px 9px; border: 1px solid var(--line2, #d6ccbf); border-radius: 7px; background: #fff; color: var(--ink, #1f1b16); }
.pe-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.pe-list li { display: flex; align-items: center; gap: 2px; border-radius: 7px; padding: 4px 4px 4px 9px; cursor: pointer; }
.pe-list li.on { background: var(--accent-soft, #f3e6dc); }
.pe-list li span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pe-list li i { font-style: normal; font-size: 11px; color: var(--muted, #8b8178); margin-right: 4px; }
.pe-list button, .pe-tools button { border: 0; background: none; cursor: pointer; color: var(--ink2, #5c544b); border-radius: 6px; padding: 3px 6px; font: 13px var(--sans, system-ui); }
.pe-list button:hover, .pe-tools button:hover { background: rgba(0,0,0,.06); }
.pe-main { display: flex; flex-direction: column; min-height: 0; }
.pe-meta { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; padding: 12px 18px 8px; }
.pe-addr { grid-column: 1 / -1; font-size: 12px; color: var(--muted, #8b8178); }
.pe-note { margin: 0 18px 8px; padding: 8px 12px; border-radius: 8px; background: #fff6dc; font-size: 13px; }
.pe-tools { display: flex; flex-wrap: wrap; gap: 2px; padding: 4px 14px; border-top: 1px solid var(--line, #e5ded5); border-bottom: 1px solid var(--line, #e5ded5); background: var(--bg, #faf7f2); }
.pe-tools .sep { width: 1px; background: var(--line, #e5ded5); margin: 3px 4px; }
.pe-tools button.on { background: var(--accent-soft, #f3e6dc); }
.pe-doc { flex: 1; overflow-y: auto; padding: 18px 26px 40px; outline: none; }
.pe-doc:focus { box-shadow: inset 0 0 0 2px var(--accent-soft, #f3e6dc); }
.pe-html { flex: 1; margin: 0; border: 0 !important; border-radius: 0 !important; font: 13px/1.5 ui-monospace, Menlo, monospace !important; padding: 14px 18px !important; resize: none; }
.pe-help { padding: 6px 18px; font-size: 12px; color: var(--muted, #8b8178); border-top: 1px solid var(--line, #e5ded5); }
@media (max-width: 760px) {
  /* phones: one scroll for the whole editor (page list, details, toolbar, text) so the text gets the screen */
  .pe-bg { padding: 0; } .pe { height: 100dvh; max-height: none; border-radius: 0; }
  .pe-body { display: block; overflow-y: auto; -webkit-overflow-scrolling: touch; }
  .pe-side { border-right: 0; border-bottom: 1px solid var(--line, #e5ded5); max-height: none; overflow: visible; }
  .pe-main { display: block; min-height: 0; }
  .pe-meta { grid-template-columns: 1fr; padding: 12px 14px 8px; } .pe-note { margin: 0 14px 8px; }
  .pe-tools { position: sticky; top: 0; z-index: 2; padding: 4px 10px; } .pe-tools button { padding: 8px 9px; }
  .pe-doc { overflow: visible; min-height: 55vh; padding: 14px 16px 30px; }
  .pe-html { min-height: 55vh; width: 100%; }
  .pe-head, .pe-foot { padding: 10px 14px; }
  .pe-foot { flex-wrap: wrap; } .pe-foot .btn { height: 40px; }
  .pe input, .pe textarea, .pe select { font-size: 16px; }
}`;

/** site: {key, title, pages: {tab, footer, list: [{slug, title, description}]}, publicUrl} */
export function editPages(site) {
  if (!document.getElementById("pe-css")) document.head.insertAdjacentHTML("beforeend", `<style id="pe-css">${CSS}</style>`);
  const P = JSON.parse(JSON.stringify(site.pages || { tab: "Info", list: [] }));
  P.list = P.list || [];
  const start = JSON.stringify({ tab: P.tab || "", footer: P.footer || "", list: P.list });
  const pub = (site.publicUrl || "").replace(/\/?$/, "/");
  // images saved as media/<file> show from the published site while editing
  const toEdit = (h) => (pub.length > 1 ? h.replaceAll('src="media/', `src="${pub}media/`) : h);
  const fromEdit = (h) => (pub.length > 1 ? h.replaceAll(`src="${pub}media/`, 'src="media/') : h);
  const texts = new Map(); // slug -> {html, orig, from: "site" | "core" | "new"}
  let cur = P.list[0] ? P.list[0].slug : null, htmlMode = false, saving = false;

  const bg = document.createElement("div");
  bg.className = "pe-bg";
  bg.innerHTML = `<div class="pe" role="dialog" aria-label="Info pages">
    <div class="pe-head"><h3>Info pages · ${esc(site.title || site.key)}</h3><button class="btn ghost" data-x>Close</button></div>
    <div class="pe-body">
      <aside class="pe-side">
        <label>Name of the tab<input id="peTab" maxlength="30" placeholder="Info"></label>
        <div><ol class="pe-list" id="peList"></ol><button class="btn" id="peAdd" style="margin-top:8px">+ Add page</button></div>
        <label>Footer on every page<textarea id="peFoot" rows="4"></textarea></label>
      </aside>
      <section class="pe-main">
        <div class="pe-meta">
          <label>Title<input id="peTitle" maxlength="80"></label>
          <label>Short description (for search engines and link previews)<input id="peDesc" maxlength="220"></label>
          <div class="pe-addr" id="peAddr"></div>
        </div>
        <div class="pe-note" id="peNote" hidden></div>
        <div class="pe-tools" id="peTools">
          <button data-c="h2" title="Heading">Heading</button><button data-c="h3" title="Subheading">Subheading</button><button data-c="p" title="Normal text">Text</button>
          <span class="sep"></span><button data-c="bold" title="Bold"><b>B</b></button><button data-c="italic" title="Italic"><i>I</i></button>
          <button data-c="ul" title="Bulleted list">• List</button><button data-c="link" title="Link selected text">Link</button><button data-c="unlink" title="Remove link">Unlink</button>
          <span class="sep"></span><button data-c="img" title="Insert an image by its web address">Image</button><button data-c="btn" title="Insert a button that links somewhere">Button</button>
          <span class="sep"></span><button data-c="html" title="Edit the page as HTML">HTML</button>
        </div>
        <div class="pe-doc prose" id="peDoc" contenteditable="true" spellcheck="true"></div>
        <textarea class="pe-html" id="peHtml" spellcheck="false" hidden></textarea>
        <div class="pe-help">Filled in when the site publishes: <code>{{siteTitle}}</code> the site’s name, <code>{{contact}}</code> its contact email, <code>{{archiveList}}</code> a list of every Isthmia archive. Links to <code>../#gallery</code> etc. open the site’s views. The first page is the site’s home page.</div>
      </section>
    </div>
    <div class="pe-foot"><span class="pe-msg" id="peMsg"></span><a class="btn ghost" id="peView" target="_blank" rel="noopener">View page ↗</a><button class="btn" data-x>Cancel</button><button class="btn primary" id="peSave">Save and publish</button></div>
  </div>`;
  document.body.appendChild(bg);
  const $ = (s) => bg.querySelector(s);
  const doc = $("#peDoc"), raw = $("#peHtml");
  $("#peTab").value = P.tab || "";
  $("#peFoot").value = P.footer || "";
  const msg = (t) => ($("#peMsg").textContent = t);

  const page = () => P.list.find((p) => p.slug === cur);
  const pull = () => { // the open page's text from the screen into texts
    const t = cur && texts.get(cur);
    if (t) t.html = htmlMode ? raw.value : fromEdit(doc.innerHTML);
  };
  const dirty = () => {
    pull();
    P.tab = $("#peTab").value.trim(); P.footer = $("#peFoot").value.trim();
    const cfg = JSON.stringify({ tab: P.tab, footer: P.footer, list: P.list }) !== start;
    return cfg || [...texts.values()].some((t) => t.html !== t.orig);
  };

  function renderList() {
    $("#peList").innerHTML = P.list.map((p, i) => {
      const t = texts.get(p.slug);
      const tag = t && t.from === "core" && t.html === t.orig ? "<i>placeholder</i>" : t && t.html !== t.orig ? "<i>edited</i>" : "";
      return `<li data-s="${esc(p.slug)}" class="${p.slug === cur ? "on" : ""}"><span>${esc(p.title || p.slug)}</span>${tag}
        <button data-m="-1" title="Move up" ${i ? "" : "disabled"}>↑</button><button data-m="1" title="Move down" ${i < P.list.length - 1 ? "" : "disabled"}>↓</button><button data-d title="Remove from the tab">✕</button></li>`;
    }).join("") || `<li class="muted">No pages: the Info tab is hidden.</li>`;
  }

  async function open(slug) {
    pull();
    cur = slug;
    renderList();
    const p = page();
    $("#peTitle").value = p ? p.title || "" : ""; $("#peDesc").value = p ? p.description || "" : "";
    $("#peTitle").disabled = $("#peDesc").disabled = !p;
    $("#peAddr").textContent = p ? `Address: ${pub}${p.slug === P.list[0].slug ? "" : p.slug + "/"}` : "";
    $("#peView").hidden = !p || !pub || pub === "/"; if (p) $("#peView").href = `${pub}${p.slug === P.list[0].slug ? "" : p.slug + "/"}`;
    if (!p) { doc.innerHTML = ""; raw.value = ""; $("#peNote").hidden = true; return; }
    if (!texts.has(slug)) {
      doc.innerHTML = '<p class="muted">Loading…</p>'; doc.contentEditable = "false";
      try {
        let html = await getText(`sites/${site.key}/pages/${slug}.html`), from = "site";
        if (html == null) { html = await getText(`core/pages/${slug}.html`); from = html == null ? "new" : "core"; }
        html = html == null ? `<h1>${esc(p.title || "")}</h1>\n<p></p>\n` : html;
        texts.set(slug, { html, orig: from === "new" ? "" : html, from });
      } catch (e) { doc.innerHTML = `<p>Could not load the page: ${esc(e.message)}</p>`; return; }
      if (cur !== slug) return; // another page was opened meanwhile
      renderList();
    }
    const t = texts.get(slug);
    $("#peNote").hidden = t.from === "site";
    $("#peNote").textContent = t.from === "core" ? "This is the standard text every new archive starts with. Change it and save to make it this site’s own."
      : "A new page. It appears on the site once you save.";
    doc.contentEditable = "true";
    doc.innerHTML = toEdit(t.html); raw.value = t.html;
  }

  function setHtmlMode(on) {
    pull(); htmlMode = on;
    const t = texts.get(cur);
    if (t) { doc.innerHTML = toEdit(t.html); raw.value = t.html; }
    doc.hidden = on; raw.hidden = !on;
    $('#peTools [data-c="html"]').classList.toggle("on", on);
    bg.querySelectorAll("#peTools button:not([data-c=html])").forEach((b) => (b.disabled = on));
  }

  function command(c) {
    if (htmlMode && c !== "html") return;
    doc.focus();
    const ins = (h) => document.execCommand("insertHTML", false, h);
    if (c === "h2" || c === "h3" || c === "p") document.execCommand("formatBlock", false, c);
    else if (c === "bold" || c === "italic") document.execCommand(c);
    else if (c === "ul") document.execCommand("insertUnorderedList");
    else if (c === "unlink") document.execCommand("unlink");
    else if (c === "link") {
      const u = prompt("Link to (a web address, an email as mailto:…, or ../#gallery for a view of this site):", "https://");
      if (u) document.execCommand("createLink", false, u.trim());
    } else if (c === "img") {
      const u = prompt("Web address of the image (for example a photo in the archive’s S3 bucket):", "https://");
      if (!u) return;
      const alt = prompt("Describe the image in a few words (read aloud to blind visitors):", "") || "";
      ins(`<figure><img src="${esc(u.trim())}" alt="${esc(alt)}" loading="lazy"></figure><p></p>`);
    } else if (c === "btn") {
      const label = prompt("Button text:", "Browse the collection"); if (!label) return;
      const u = prompt("Button links to:", "../#gallery"); if (!u) return;
      ins(`<p><a class="btn primary" href="${esc(u.trim())}">${esc(label)}</a></p>`);
    } else if (c === "html") setHtmlMode(!htmlMode);
    renderList();
  }

  function addPage() {
    pull();
    const title = (prompt("Title of the new page:", "") || "").trim(); if (!title) return;
    let slug = slugify(title), n = 2;
    while (RESERVED.has(slug) || P.list.some((p) => p.slug === slug)) slug = `${slugify(title)}-${n++}`;
    P.list.push({ slug, title, description: "" });
    open(slug);
  }

  async function save() {
    if (saving) return;
    if (!dirty()) { msg("Nothing to save."); return; }
    if (P.list.some((p) => !p.title)) { msg("Every page needs a title."); return; }
    const files = [{ path: `sites/${site.key}/pages.json`, text: JSON.stringify({ tab: P.tab || "Info", footer: P.footer, list: P.list }, null, 1) + "\n" }];
    for (const p of P.list) {
      const t = texts.get(p.slug);
      if (t && (t.html !== t.orig || t.from === "new")) files.push({ path: `sites/${site.key}/pages/${p.slug}.html`, text: t.html.trim() + "\n" });
    }
    saving = true; $("#peSave").disabled = true; msg("Saving…");
    try {
      await putFiles(files, `Info pages for ${site.key}`);
      for (const t of texts.values()) { t.orig = t.html; t.from = "site"; }
      site.pages = JSON.parse(JSON.stringify(P));
      close(true);
      (site.onSaved || (() => {}))("Saved. The site’s Info pages update in about 2 minutes.");
    } catch (e) { msg("Could not save: " + e.message); }
    finally { saving = false; $("#peSave").disabled = false; }
  }

  function close(force) {
    if (!force && dirty() && !confirm("Close without saving your changes to the Info pages?")) return;
    bg.remove();
  }

  // events
  $("#peList").onclick = (e) => {
    const li = e.target.closest("li[data-s]"); if (!li) return;
    const i = P.list.findIndex((p) => p.slug === li.dataset.s);
    if (e.target.closest("[data-m]")) { const j = i + +e.target.closest("[data-m]").dataset.m; [P.list[i], P.list[j]] = [P.list[j], P.list[i]]; renderList(); return; }
    if (e.target.closest("[data-d]")) {
      if (!confirm(`Remove “${P.list[i].title}” from the Info tab? Its text stays in the repo’s history.`)) return;
      P.list.splice(i, 1); texts.delete(li.dataset.s);
      open(cur === li.dataset.s ? (P.list[0] || {}).slug || null : cur); return;
    }
    open(li.dataset.s);
  };
  $("#peTitle").oninput = () => { const p = page(); if (p) { p.title = $("#peTitle").value; renderList(); } };
  $("#peDesc").oninput = () => { const p = page(); if (p) p.description = $("#peDesc").value; };
  $("#peTools").onmousedown = (e) => { if (e.target.closest("button")) e.preventDefault(); }; // keep the text selection
  $("#peTools").onclick = (e) => { const b = e.target.closest("[data-c]"); if (b) command(b.dataset.c); };
  doc.addEventListener("paste", (e) => { // paste words, not the formatting of Word or a web page
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertHTML", false, t.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join(""));
  });
  doc.addEventListener("input", () => { const t = texts.get(cur); if (t) { t.html = fromEdit(doc.innerHTML); renderList(); } });
  $("#peAdd").onclick = addPage;
  $("#peSave").onclick = save;
  bg.querySelectorAll("[data-x]").forEach((b) => (b.onclick = () => close(false)));
  open(cur);
}
