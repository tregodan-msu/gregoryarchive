// Lock for the admin pages (every site's editor and the overview). One GitHub key works for all of them: a fine-grained
// token with Contents read & write on the private repo. The page opens only if the key can change that repo, and the
// same key commits settings (view names, viewer settings, pins, features) straight to it, which republishes the sites.
// The sites share one address (tregodan-msu.github.io), so entering the key once unlocks every admin page in that browser.
// Note: the pages' code and the published data are public anyway; what the key protects is changing anything.
const KEY = "isthmia-gh-key";
const REPO = (window.GA_CONFIG && window.GA_CONFIG.adminRepo) || "tregodan-msu/isthmia";
const API = "https://api.github.com";
const store = {
  get: () => { try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY); } catch { return null; } },
  set: (v, remember) => { try { (remember ? localStorage : sessionStorage).setItem(KEY, v); } catch {} },
  clear: () => { try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch {} },
};
export const gh = { repo: REPO, token: null, user: "" };
const H = (t) => ({ Authorization: "Bearer " + t, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function check(token) {
  let r;
  try { r = await fetch(`${API}/repos/${REPO}`, { headers: H(token), cache: "no-store" }); }
  catch { throw new Error("Couldn’t reach GitHub. Check the connection and try again."); }
  if (r.status === 401) throw new Error("GitHub didn’t accept this key (mistyped, expired or revoked).");
  if (r.status === 403 || r.status === 404) throw new Error(`This key doesn’t have access to ${REPO}.`);
  if (!r.ok) throw new Error("GitHub said " + r.status + ". Try again in a moment.");
  const d = await r.json();
  if (!(d.permissions && (d.permissions.push || d.permissions.admin))) throw new Error(`This key can read ${REPO} but not change it.`);
  const u = await fetch(`${API}/user`, { headers: H(token) }).then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
  return u.login || "";
}

// Shows the lock screen until a working key is entered. Resolves once the page may load.
export async function unlock(title = "Admin") {
  const saved = store.get();
  if (saved) {
    try { gh.user = await check(saved); gh.token = saved; return open(); }
    catch (e) { if (/accept|access|change/.test(e.message)) store.clear(); else return lockScreen(title, e.message); }
  }
  return lockScreen(title, "");
}
function open() { document.body.classList.remove("locked"); addSignOut(); return gh; }
function lockScreen(title, msg) {
  return new Promise((resolve) => {
    const g = document.createElement("div");
    g.className = "gate";
    g.innerHTML = `<form class="gate-card"><div class="gate-mark">🔒</div><h2>${esc(title)}</h2>
      <p>This page is for the archive team. Enter the GitHub key (the same one for every Isthmia archive).</p>
      <input type="password" autocomplete="current-password" placeholder="github_pat_…" aria-label="GitHub key" required>
      <label class="gate-check"><input type="checkbox" checked> Remember on this device</label>
      <p class="gate-err" role="alert">${esc(msg)}</p>
      <button class="btn primary" type="submit">Unlock</button>
      <details><summary>Making a key</summary><p>GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Resource owner
      <b>${esc(REPO.split("/")[0])}</b>, only the repository <b>${esc(REPO.split("/")[1])}</b>, permission <b>Contents: Read and write</b>.
      Share it only with people who should be able to change the sites.</p></details>
      <a class="gate-back" href="${document.querySelector(".brand")?.getAttribute("href") || "./"}">← Back to the public site</a></form>`;
    document.body.appendChild(g);
    const f = g.querySelector("form"), inp = f.querySelector("input[type=password]"), err = f.querySelector(".gate-err");
    inp.focus();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const t = inp.value.trim(); if (!t) return;
      err.textContent = "Checking…"; f.querySelector("button").disabled = true;
      try {
        gh.user = await check(t); gh.token = t; store.set(t, f.querySelector(".gate-check input").checked);
        g.remove(); resolve(open());
      } catch (x) { err.textContent = x.message; f.querySelector("button").disabled = false; inp.select(); }
    };
  });
}
function addSignOut() {
  const host = document.querySelector(".ed-actions, .adm-actions");
  if (!host || host.querySelector(".signout")) return;
  const b = Object.assign(document.createElement("button"), { className: "btn ghost signout", textContent: gh.user ? `${gh.user} · Lock` : "Lock", title: "Forget the GitHub key in this browser" });
  b.onclick = () => { store.clear(); location.reload(); };
  host.appendChild(b);
}

// Commit a JSON file to the private repo (creates or replaces it). The commit starts the publish workflow.
export async function putJson(path, obj, message) {
  if (!gh.token) throw new Error("Locked: enter the GitHub key first.");
  const url = `${API}/repos/${REPO}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const cur = await fetch(url, { headers: H(gh.token), cache: "no-store" });
  const sha = cur.ok ? (await cur.json()).sha : undefined;
  if (!cur.ok && cur.status !== 404) throw new Error("GitHub said " + cur.status + " reading " + path);
  const bytes = new TextEncoder().encode(JSON.stringify(obj, null, 1) + "\n");
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  const res = await fetch(url, { method: "PUT", headers: { ...H(gh.token), "Content-Type": "application/json" },
    body: JSON.stringify({ message: message + (gh.user ? ` (${gh.user})` : ""), content: btoa(bin), sha }) });
  if (!res.ok) { const t = await res.text(); throw new Error("GitHub said " + res.status + ": " + t.slice(0, 160)); }
  return res.json();
}
