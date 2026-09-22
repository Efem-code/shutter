/* White balance meter: uses the phone camera to estimate the colour temperature
   of the light, then suggests a Kelvin value and WB shift for the Canons.

   The trick: a phone camera normally auto-corrects white balance, which would
   make every grey card read neutral and tell us nothing. So we ask Chrome to
   lock the phone's white balance to a fixed daylight preset (Image Capture
   constraints: whiteBalanceMode 'manual' + colorTemperature). Under that fixed
   rendering a neutral card turns orange under tungsten and blue in shade, and
   the size of that cast tells us the light's Kelvin.

   It's an estimate: phone colour processing isn't a lab instrument. In-camera
   Custom WB off a grey card is still the gold standard, and the meter says so. */

const WB = (() => {
  const $ = s => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('shutter.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('shutter.' + k, JSON.stringify(v)); } catch {} }
  };

  /* ---- colour science ---------------------------------------------- */
  // Planckian locus in CIE xy, Kim et al. cubic spline (1667–25000 K)
  function planckXY(T) {
    const t = 1e3 / T, t2 = t * t, t3 = t2 * t;
    const x = T <= 4000
      ? -0.2661239 * t3 - 0.2343589 * t2 + 0.8776956 * t + 0.179910
      : -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t + 0.240390;
    const x2 = x * x, x3 = x2 * x;
    const y = T <= 2222 ? -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683
            : T <= 4000 ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
            :              3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;
    return [x, y];
  }
  // Linear sRGB of a light with CCT T (Y = 1)
  function planckRGB(T) {
    const [x, y] = planckXY(T);
    const X = x / y, Y = 1, Z = (1 - x - y) / y;
    return [ 3.2406 * X - 1.5372 * Y - 0.4986 * Z,
            -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
             0.0557 * X - 0.2040 * Y + 1.0570 * Z];
  }
  const lin = c => (c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  /* Predicted colour of a grey card lit by T, photographed with WB fixed at ref:
     von Kries-style scaling in RGB. Precomputed per mired for a fast lookup. */
  function table(ref) {
    const r0 = planckRGB(ref), rows = [];
    for (let m = 40; m <= 560; m++) {
      const c = planckRGB(1e6 / m).map((v, i) => v / r0[i]);
      rows.push({ m, br: Math.log(c[2] / c[0]), g: Math.log(c[1] / Math.sqrt(c[0] * c[2])) });
    }
    return rows;
  }

  /* ---- state ---------------------------------------------------------- */
  let stream = null, track = null, timer = null, rows = null, ref = 5500;
  let mode = 'none', hold = false, last = null, calibrating = false;
  const smooth = [];

  function estimate(rgb) {
    const [r, g, b] = rgb.map(lin);
    const br = Math.log(b / r), gg = Math.log(g / Math.sqrt(r * b));
    let best = rows[0];
    for (const row of rows) if (Math.abs(row.br - br) < Math.abs(best.br - br)) best = row;
    const offset = store.get('wbOffset', 0);            // mireds, from calibration
    const mired = best.m - offset;
    return { mired: best.m, T: 1e6 / Math.min(560, Math.max(40, mired)), tint: gg - best.g };
  }

  /* ---- UI ------------------------------------------------------------- */
  function open() {
    let el = $('#wb');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wb';
      el.innerHTML = `
        <video id="wb-v" playsinline muted></video>
        <div class="wb-reticle"></div>
        <div class="wb-top">
          <div class="wb-k" id="wb-k">—</div>
          <div class="wb-sub" id="wb-sub">Starting camera…</div>
        </div>
        <div class="wb-bottom">
          <div class="wb-rec" id="wb-rec"></div>
          <div class="wb-btns">
            <button class="btn" id="wb-close">Close</button>
            <button class="btn" id="wb-cal">Calibrate</button>
            <button class="btn primary" id="wb-hold">Hold</button>
          </div>
        </div>
        <canvas id="wb-c" width="64" height="64" hidden></canvas>`;
      document.body.appendChild(el);
      $('#wb-close').onclick = close;
      $('#wb-hold').onclick = () => { hold = !hold; $('#wb-hold').textContent = hold ? 'Resume' : 'Hold'; };
      $('#wb-cal').onclick = calibrate;
    }
    el.hidden = false;
    document.body.style.overflow = 'hidden';
    hold = false; $('#wb-hold').textContent = 'Hold';
    start();
  }

  function close() {
    if (timer) clearInterval(timer), timer = null;
    if (stream) stream.getTracks().forEach(t => t.stop()), stream = null;
    const el = $('#wb'); if (el) el.hidden = true;
    document.body.style.overflow = '';
  }

  async function start() {
    const sub = $('#wb-sub');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    } catch (e) {
      sub.textContent = 'Camera permission was blocked. Allow the camera for Shutter in Android settings and try again.';
      return;
    }
    track = stream.getVideoTracks()[0];
    const v = $('#wb-v'); v.srcObject = stream; await v.play().catch(() => {});

    const caps = track.getCapabilities ? track.getCapabilities() : {};
    mode = 'none';
    if ((caps.whiteBalanceMode || []).includes('manual') && caps.colorTemperature) {
      const want = Math.min(caps.colorTemperature.max, Math.max(caps.colorTemperature.min, 5500));
      try {
        await track.applyConstraints({ advanced: [{ whiteBalanceMode: 'manual', colorTemperature: want }] });
        const st = track.getSettings();
        if (st.whiteBalanceMode === 'manual') { mode = 'locked'; ref = st.colorTemperature || want; }
      } catch {}
    }
    if (mode === 'none' && 'colorTemperature' in (track.getSettings() || {})) mode = 'phone';
    rows = table(ref);
    smooth.length = 0;
    sub.textContent = mode === 'none'
      ? 'This phone won’t let the browser lock its white balance, so a live reading isn’t possible. Use Custom WB in the camera (below).'
      : 'Point at white paper or a grey card in the light that falls on your subject.';
    timer = setInterval(tick, 250);
  }

  function sample() {
    const v = $('#wb-v'), c = $('#wb-c'), ctx = c.getContext('2d', { willReadFrequently: true });
    if (!v.videoWidth) return null;
    const s = Math.min(v.videoWidth, v.videoHeight) * 0.22;          // centre patch
    ctx.drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    let r = 0, g = 0, b = 0, n = 0, lum = 0, lum2 = 0, clipped = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      if (R > 250 || G > 250 || B > 250) { clipped++; continue; }
      if (R + G + B < 30) continue;
      r += R; g += G; b += B; n++;
      const L = (R + G + B) / 3; lum += L; lum2 += L * L;
    }
    if (n < 200) return { bad: clipped > 400 ? 'Too bright — tilt the card away from the light a little.' : 'Too dark — get more light on the card.' };
    const mean = lum / n, sd = Math.sqrt(Math.max(0, lum2 / n - mean * mean));
    return { rgb: [r / n, g / n, b / n], uneven: sd / mean > 0.18 };
  }

  function tick() {
    if (hold || mode === 'none') return;
    const k = $('#wb-k'), rec = $('#wb-rec');
    if (mode === 'phone') {                    // fallback: the phone's own AWB guess
      const T = track.getSettings().colorTemperature;
      if (T) show(T, 0, 'Phone’s own estimate (less reliable: it can’t be locked on this device).');
      return;
    }
    const s = sample(); if (!s) return;
    if (s.bad) { $('#wb-sub').textContent = s.bad; return; }
    const e = estimate(s.rgb);
    if (calibrating) return finishCalibration(e);
    smooth.push(e); if (smooth.length > 8) smooth.shift();
    const m = smooth.reduce((a, x) => a + 1e6 / x.T, 0) / smooth.length;
    const tint = smooth.reduce((a, x) => a + x.tint, 0) / smooth.length;
    show(1e6 / m, tint, s.uneven ? 'The patch isn’t even: fill the circle with plain white or grey.' :
      'Point at white paper or a grey card in the light that falls on your subject.');
  }

  function show(T, tint, msg) {
    last = { T, tint };
    const round = x => Math.round(x / 100) * 100;
    const camK = x => Math.min(10000, Math.max(2500, round(x)));
    const natural = T < 5000 ? T + 0.2 * (5500 - T) : T + 300;     // keep a hint of warmth
    const steps = Math.max(-9, Math.min(9, Math.round(tint / 0.03)));
    const shift = steps > 0 ? `M${steps}` : steps < 0 ? `G${-steps}` : null;
    $('#wb-k').textContent = Math.round(T / 50) * 50 + ' K';
    $('#wb-sub').textContent = `${describe(T)} · ${msg}`;
    $('#wb-rec').innerHTML = `
      <div><span>Neutral</span><b>${camK(T)} K</b></div>
      <div><span>Natural (a touch warm)</span><b>${camK(natural)} K</b></div>
      <div><span>WB shift</span><b>${shift ? shift + (steps > 0 ? ' · green light' : ' · magenta light') : 'None needed'}</b></div>
      ${T < 2500 ? '<p>Below the cameras’ 2500 K minimum: set 2500 K and keep the candle‑glow, or correct in the edit.</p>' : ''}`;
  }

  function describe(T) {
    return T < 2200 ? 'Candlelight' : T < 3100 ? 'Tungsten / warm LED' : T < 3800 ? 'Halogen or golden hour'
         : T < 4700 ? 'Fluorescent / neutral LED' : T < 6000 ? 'Daylight or flash' : T < 7200 ? 'Overcast' : 'Open shade / blue hour';
  }

  function calibrate() {
    if (!confirm('Calibrate in direct midday sun (about 5500 K): point at white paper in full sun, then press OK. The meter will adjust itself to this phone’s camera.')) return;
    calibrating = true;
  }
  function finishCalibration(e) {
    calibrating = false;
    store.set('wbOffset', e.mired - 1e6 / 5500);
    smooth.length = 0;
    alert('Calibrated. Readings are now corrected for this phone.');
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) close(); });
  return { open, close };
})();
