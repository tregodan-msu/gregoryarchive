// Looks at a photo's pixels to (1) find the object on a plain backdrop, so a scale can be worked out
// from its known diameter, and (2) build a cut-out mask that hides the backdrop.
// Reading pixels from another domain needs that server to allow it (S3: a CORS rule on the bucket).
// When it doesn't, analyze() resolves { ok: false } and the viewer falls back to estimates.
const cache = new Map();
const SIZE = 512;

export function analyze(url, tol = 32) {
  const key = tol + "|" + url;
  if (!cache.has(key)) cache.set(key, run(url, tol).catch(() => ({ ok: false, reason: "blocked" })));
  return cache.get(key);
}

function loadCors(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im); im.onerror = () => rej(new Error("cors"));
    // separate cache entry from the plain <img> request, whose cached copy carries no CORS headers
    im.src = /^(data|blob):/.test(url) ? url : url + (url.includes("?") ? "&" : "?") + "cors=1";
  });
}

async function run(url, tol) {
  const im = await loadCors(url);
  const k = Math.min(1, SIZE / Math.max(im.naturalWidth, im.naturalHeight));
  const w = Math.max(8, Math.round(im.naturalWidth * k)), h = Math.max(8, Math.round(im.naturalHeight * k));
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(im, 0, 0, w, h);
  const px = cx.getImageData(0, 0, w, h).data, n = w * h; // throws if the server did not allow reading

  // backdrop colour = median of the border pixels
  const br = [], bg = [], bb = [], border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  for (const i of border) { br.push(px[i * 4]); bg.push(px[i * 4 + 1]); bb.push(px[i * 4 + 2]); }
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  const R = med(br), G = med(bg), B = med(bb);
  const isBg = (i) => Math.abs(px[i * 4] - R) <= tol && Math.abs(px[i * 4 + 1] - G) <= tol && Math.abs(px[i * 4 + 2] - B) <= tol;
  let plain = 0; for (const i of border) plain += isBg(i);
  if (plain / border.length < 0.6) return { ok: false, reason: "busy" }; // not a plain backdrop (e.g. a landscape slide)

  // flood-fill the backdrop inwards from the edges, so bright spots inside the object are kept
  const back = new Uint8Array(n), stack = [];
  for (const i of border) if (!back[i] && isBg(i)) { back[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop(), x = i % w;
    if (x > 0 && !back[i - 1] && isBg(i - 1)) { back[i - 1] = 1; stack.push(i - 1); }
    if (x < w - 1 && !back[i + 1] && isBg(i + 1)) { back[i + 1] = 1; stack.push(i + 1); }
    if (i >= w && !back[i - w] && isBg(i - w)) { back[i - w] = 1; stack.push(i - w); }
    if (i < n - w && !back[i + w] && isBg(i + w)) { back[i + w] = 1; stack.push(i + w); }
  }

  // bounding box of the object, ignoring specks (rows / columns with almost nothing in them)
  const cols = new Uint32Array(w), rows = new Uint32Array(h);
  for (let i = 0; i < n; i++) if (!back[i]) { cols[i % w]++; rows[(i / w) | 0]++; }
  const span = (a, min) => { let s = 0, e = a.length - 1; while (s < e && a[s] < min) s++; while (e > s && a[e] < min) e--; return a[s] < min ? null : [s, e]; };
  const sx = span(cols, Math.max(2, h * 0.01)), sy = span(rows, Math.max(2, w * 0.01));
  if (!sx || !sy) return { ok: false, reason: "empty" };
  const bw = sx[1] - sx[0] + 1, bh = sy[1] - sy[0] + 1;

  // mask: object opaque, backdrop transparent; shrink one pixel to drop the pale fringe, then soften
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (back[i]) continue;
    const x = i % w;
    a[i] = (x > 0 && back[i - 1]) || (x < w - 1 && back[i + 1]) || (i >= w && back[i - w]) || (i < n - w && back[i + w]) ? 0 : 255;
  }
  const out = cx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += a[yy * w + xx]; c++;
    }
    out.data[(y * w + x) * 4 + 3] = s / c;
  }
  cx.putImageData(out, 0, 0);
  return {
    ok: true, mask: cv.toDataURL("image/png"),
    // the object's longest side as a share of the image width, and where it sits (shares of width / height)
    size: Math.max(bw, bh) / w, box: [sx[0] / w, sy[0] / h, bw / w, bh / h],
    light: (R + G + B) / 3 > 128,
  };
}

// Screen size: CSS assumes 96 px per inch, which real screens only roughly match.
// The viewer's "Calibrate screen" stores the true value for this device.
const CAL_KEY = "isthmia-screen-px-per-mm";
export const DEFAULT_PPM = 96 / 25.4;
export function screenPpm() { const v = parseFloat(localStorage.getItem(CAL_KEY)); return v > 1 && v < 20 ? v : DEFAULT_PPM; }
export function setScreenPpm(v) { try { v ? localStorage.setItem(CAL_KEY, String(v)) : localStorage.removeItem(CAL_KEY); } catch {} }

// An archaeological photo scale as SVG: checkered bar, ticks and labels, in the current text colour.
// ppm = screen pixels per millimetre at the current zoom; picks the longest "nice" length that fits maxPx.
export function scaleSvg(ppm, maxPx = 260, approx = false) {
  const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  let L = nice[0]; for (const v of nice) if (v * ppm <= maxPx) L = v;
  const lead = +String(L).replace(/[0.]/g, "")[0]; // 1, 2 or 5
  const u = L / lead;
  const ticks = (lead === 1 ? [0, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 1] : lead === 2 ? [0, 0.5, 1, 2] : [0, 0.5, 1, 2, 3, 4, 5]).map((t) => t * (lead === 1 ? L : u));
  const cm = L >= 100, unit = cm ? "cm" : "mm", f = (v) => String(+(cm ? v / 10 : v).toFixed(2)).replace(".", ",");
  const W = L * ppm, bar = 9, pad = 14, top = 16, H = top + bar * 2 + 16;
  let g = "", last = -99;
  ticks.forEach((t, i) => {
    const x = pad + t * ppm;
    if (i < ticks.length - 1) g += `<rect x="${x}" y="${top + (i % 2 ? bar : 0)}" width="${(ticks[i + 1] - t) * ppm}" height="${bar}" fill="currentColor"/>`;
    g += `<path d="M${x} ${top - 3}V${top + bar * 2}" stroke="currentColor" stroke-width="1"/>`;
    if (x - last >= 20 || i === ticks.length - 1) { g += `<text x="${x}" y="${top - 6}" text-anchor="middle">${f(t)}</text>`; last = x; }
  });
  return `<svg width="${W + pad * 2}" height="${H}" viewBox="0 0 ${W + pad * 2} ${H}" role="img" aria-label="Scale: ${f(L)} ${unit}${approx ? " (approximate)" : ""}">
    <rect x="${pad}" y="${top}" width="${W}" height="${bar * 2}" fill="none" stroke="currentColor" stroke-width="1"/>${g}
    <text x="${pad + W / 2}" y="${H - 3}" text-anchor="middle">${approx ? "≈ " : ""}${unit}</text></svg>`;
}
