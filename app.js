/* Shutter — tips, recipes and field tools for the Canon EOS R8 and 5D Mark II.
   Everything runs on the phone; the only storage is localStorage. */

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const strip = html => html.replace(/<[^>]+>/g, '');

const store = {
  get(k, d) { try { const v = localStorage.getItem('shutter.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('shutter.' + k, JSON.stringify(v)); } catch {} }
};

const state = {
  tab: store.get('tab', 'tips'),
  cam: store.get('cam', 'both'),
  cat: 'all',
  q: '',
  fav: new Set(store.get('fav', [])),
  check: store.get('check', {})
};

const CAM_TAG = { r8: ['r8', 'R8'], '5d2': ['m2', '5D II'], both: ['both', 'Both'] };
const catOf = id => CATEGORIES.find(c => c.id === id);
const visibleTips = () => TIPS.filter(t => state.cam === 'both' || t.cam === 'both' || t.cam === state.cam);

/* ------------------------------------------------------------ chrome */
function syncChrome() {
  document.querySelectorAll('#cam-seg button').forEach(b => b.classList.toggle('on', b.dataset.cam === state.cam));
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
}
$('#cam-seg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  state.cam = b.dataset.cam; store.set('cam', state.cam); render();
});
$('.tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  state.tab = b.dataset.tab; store.set('tab', state.tab); render(); window.scrollTo(0, 0);
});

/* ------------------------------------------------------------- tips */
function tipCard(t) {
  const [cls, lbl] = CAM_TAG[t.cam];
  return `<div class="card" data-tip="${t.id}" role="button" tabindex="0">
    <div class="row"><span class="tag ${cls}">${lbl}</span>
      <span class="muted" style="font-size:13px">${catOf(t.cat).icon} ${catOf(t.cat).label}</span>
      <button class="star ${state.fav.has(t.id) ? 'on' : ''}" data-star="${t.id}" aria-label="Save">${state.fav.has(t.id) ? '★' : '☆'}</button></div>
    <h4>${esc(t.title)}</h4><div class="sum">${esc(strip(t.body))}</div></div>`;
}

function dailyTip() {
  const pool = visibleTips();
  const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
  return pool[day % pool.length];
}

function renderTips() {
  const q = state.q.trim().toLowerCase();
  let list = visibleTips();
  if (state.cat !== 'all') list = list.filter(t => t.cat === state.cat);
  if (q) list = list.filter(t => (t.title + ' ' + strip(t.body) + ' ' + (t.steps || []).join(' ')).toLowerCase().includes(q));
  const d = dailyTip();
  const cats = [{ id: 'all', label: 'All', icon: '' }, ...CATEGORIES]
    .filter(c => c.id === 'all' || visibleTips().some(t => t.cat === c.id));
  return `
    ${!q && state.cat === 'all' ? `<div class="daily" data-tip="${d.id}" role="button" tabindex="0">
      <div class="label">Tip of the day · ${CAM_TAG[d.cam][1]}</div><h4>${esc(d.title)}</h4>
      <div class="sum muted">${esc(strip(d.body)).slice(0, 150)}…</div></div>` : ''}
    <input class="search" id="q" type="search" placeholder="Search tips — e.g. banding, flash, battery" value="${esc(state.q)}">
    <div class="chips">${cats.map(c => `<button class="chip ${state.cat === c.id ? 'on' : ''}" data-cat="${c.id}">${c.icon} ${c.label}</button>`).join('')}</div>
    <div class="grid" id="tip-grid">${list.map(tipCard).join('') || '<div class="empty">No tips match.</div>'}</div>`;
}

function openTip(id) {
  const t = TIPS.find(x => x.id === id); if (!t) return;
  const [cls, lbl] = CAM_TAG[t.cam];
  openSheet(`<div class="row" style="justify-content:flex-start"><span class="tag ${cls}">${lbl}</span>
      <span class="muted" style="font-size:13px">${catOf(t.cat).icon} ${catOf(t.cat).label}</span></div>
    <h2>${esc(t.title)}</h2><p>${t.body}</p>
    ${t.steps ? `<h3>How</h3><ol class="steps">${t.steps.map(s => `<li>${s}</li>`).join('')}</ol>` : ''}
    <p style="margin-top:16px"><button class="btn ${state.fav.has(id) ? '' : 'primary'}" data-star="${id}">
      ${state.fav.has(id) ? '★ Saved' : '☆ Save this tip'}</button></p>`);
}

/* ---------------------------------------------------------- recipes */
function renderRecipes() {
  return `<h2>Settings recipes</h2>
    <p class="muted">Starting points for common jobs${state.cam === 'both' ? ', side by side for both bodies' : ''}.</p>
    <div class="grid">${RECIPES.map(r => `<button class="card recipe" data-recipe="${r.id}">
      <span class="ic">${r.icon}</span><span><h4>${esc(r.title)}</h4><span class="sum">${esc(r.when)}</span></span></button>`).join('')}</div>`;
}

function recipeCol(title, cls, s) {
  return `<div class="col"><h5><span class="tag ${cls}">${title}</span></h5>
    <dl class="kv">${Object.entries(s).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`;
}

function openRecipe(id) {
  const r = RECIPES.find(x => x.id === id); if (!r) return;
  const cols = [];
  if (state.cam !== '5d2') cols.push(recipeCol('EOS R8', 'r8', r.r8));
  if (state.cam !== 'r8') cols.push(recipeCol('5D Mark II', 'm2', r.m2));
  openSheet(`<h2>${r.icon} ${esc(r.title)}</h2><p class="muted">${esc(r.when)}</p>
    <div class="cols ${cols.length > 1 ? 'two' : ''}">${cols.join('')}</div>
    ${r.lens ? `<div class="note">🔭 <b>Your lenses:</b> ${esc(r.lens)}</div>` : ''}
    <div class="note">💡 ${esc(r.notes)}</div>`);
}

/* ------------------------------------------------------------ tools */
const SPEEDS = [30, 15, 8, 4, 2, 1, 1/2, 1/4, 1/8, 1/15, 1/30, 1/60, 1/125, 1/250, 1/500, 1/1000, 1/2000, 1/4000];
const fmtT = t => {
  if (!isFinite(t)) return '∞';
  if (t >= 3600) return (t / 3600).toFixed(1).replace(/\.0$/, '') + ' h';
  if (t >= 60) { const m = Math.floor(t / 60), s = Math.round(t % 60); return m + ' min' + (s ? ' ' + s + ' s' : ''); }
  if (t >= 1) return (t < 10 ? t.toFixed(1).replace(/\.0$/, '') : Math.round(t)) + ' s';
  return '1/' + Math.round(1 / t);
};
const fmtM = mm => !isFinite(mm) ? '∞' : mm >= 1000 ? (mm / 1000).toFixed(2) + ' m' : (mm / 10).toFixed(1) + ' cm';
const nearestSpeed = t => [1/8000, 1/4000, 1/2000, 1/1000, 1/500, 1/250, 1/200, 1/160, 1/125, 1/100, 1/80, 1/60, 1/50, 1/40, 1/30, 1/15, 1/8, 1/4]
  .reduce((best, s) => (s <= t * 1.02 && (best == null || s > best)) ? s : best, null) || 1/8000;

function renderTools() {
  const specCams = state.cam === 'both' ? ['r8', '5d2'] : [state.cam];
  return `<h2>Field tools</h2>
  <div class="tool wb-card"><h4>🎨 White balance meter</h4>
    <p class="muted">Uses the phone’s camera to read the colour of the light and tells you which Kelvin and WB shift to set on the R8 and 5D II. Set both bodies to the same value and their colours will match.</p>
    <p><button class="btn primary" id="wb-open">Open meter</button> <button class="btn" data-tip="b-customwb">Custom WB (most accurate)</button></p>
    <table class="specs">${WB_PRESETS.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table></div>
  <div class="tool"><h4>Depth of field</h4><p class="muted">How much is sharp, front to back. Full‑frame (both bodies).</p>
    <div class="fields">
      <label class="f">Focal length (mm)<input id="d-f" type="number" inputmode="decimal" value="50"></label>
      <label class="f">Aperture f/<input id="d-n" type="number" inputmode="decimal" step="0.1" value="2.8"></label>
      <label class="f">Distance (m)<input id="d-s" type="number" inputmode="decimal" step="0.1" value="3"></label>
    </div><div class="out" id="d-out"></div></div>

  <div class="tool"><h4>Slowest safe handheld shutter</h4><p class="muted">Neither body has in‑body stabilisation, so this depends on the lens.</p>
    <div class="fields">
      <label class="f">Focal length (mm)<input id="h-f" type="number" inputmode="decimal" value="85"></label>
      <label class="f">Lens IS<select id="h-is"><option value="0">No IS</option><option value="3">IS (≈3 stops)</option><option value="4">IS (≈4 stops)</option><option value="5">IS (≈5 stops)</option></select></label>
      <label class="f">Subject<select id="h-sub"><option value="0">Still (products)</option><option value="0.008">People posing</option><option value="0.004">People walking</option><option value="0.001">Running / sport</option></select></label>
    </div><div class="out" id="h-out"></div></div>

  <div class="tool"><h4>ND filter exposure</h4>
    <div class="fields">
      <label class="f">Metered shutter<select id="n-t">${SPEEDS.map(s => `<option value="${s}" ${s === 1/125 ? 'selected' : ''}>${fmtT(s)}</option>`).join('')}</select></label>
      <label class="f">Filter<select id="n-s">${[[1,'ND2 · 1 stop'],[2,'ND4 · 2'],[3,'ND8 · 3'],[6,'ND64 · 6'],[10,'ND1000 · 10'],[15,'ND32k · 15']].map(([v,l]) => `<option value="${v}" ${v === 10 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div><div class="out" id="n-out"></div></div>

  <div class="tool"><h4>Stars without trails</h4><p class="muted">Longest exposure before stars smear.</p>
    <div class="fields">
      <label class="f">Focal length (mm)<input id="a-f" type="number" inputmode="decimal" value="20"></label>
      <label class="f">Aperture f/<input id="a-n" type="number" inputmode="decimal" step="0.1" value="2.8"></label>
      <label class="f">Camera<select id="a-c"><option value="6.0">EOS R8</option><option value="6.4">5D Mark II</option></select></label>
    </div><div class="out" id="a-out"></div></div>

  <h3>Specifications</h3>
  <div class="cols ${specCams.length > 1 ? 'two' : ''}">${specCams.map(c => `<div class="col"><h5><span class="tag ${CAM_TAG[c][0]}">${CAMERAS[c].name}</span></h5>
    <table class="specs">${CAMERAS[c].specs.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table></div>`).join('')}</div>`;
}

function calcTools() {
  const num = id => parseFloat($('#' + id)?.value);
  // DOF, circle of confusion 0.03 mm for full frame
  const f = num('d-f'), N = num('d-n'), s = num('d-s') * 1000, c = 0.03;
  if (f > 0 && N > 0 && s > f) {
    const H = f * f / (N * c) + f;
    const near = s * (H - f) / (H + s - 2 * f);
    const far = s >= H ? Infinity : s * (H - f) / (H - s);
    $('#d-out').innerHTML = `Sharp from <b>${fmtM(near)}</b> to <b>${fmtM(far)}</b> — total <b>${fmtM(far - near)}</b><br>
      <span class="muted">Hyperfocal: focus at ${fmtM(H)} and everything from ${fmtM(H / 2)} to ∞ is sharp.</span>`;
  } else $('#d-out').textContent = 'Enter focal length, aperture and a distance.';

  // Handheld: 1/(2f) for 20+ MP full frame, relaxed by lens IS; subject motion sets a floor
  const hf = num('h-f'), is = num('h-is'), sub = num('h-sub');
  if (hf > 0) {
    const shake = 1 / (2 * hf) * Math.pow(2, is);
    const t = sub ? Math.min(shake, sub) : shake;
    $('#h-out').innerHTML = `Use <b>${fmtT(nearestSpeed(t))}</b> or faster.` +
      (sub && sub < shake ? `<br><span class="muted">Subject movement, not shake, is the limit here.</span>` : '') +
      (is && !sub ? `<br><span class="muted">IS steadies the camera, not the subject.</span>` : '');
  }

  // ND
  const nt = num('n-t'), ns = num('n-s');
  $('#n-out').innerHTML = `New exposure: <b>${fmtT(nt * Math.pow(2, ns))}</b>` +
    (nt * Math.pow(2, ns) > 30 ? `<br><span class="muted">Longer than 30 s — use Bulb with a remote or the in‑camera bulb timer.</span>` : '');

  // Stars: 500 rule and simplified NPF, (35N + 30p) / f
  const af = num('a-f'), an = num('a-n'), p = num('a-c');
  if (af > 0 && an > 0) {
    const npf = (35 * an + 30 * p) / af, r500 = 500 / af;
    $('#a-out').innerHTML = `Sharp stars (NPF): <b>${npf.toFixed(1)} s</b><br><span class="muted">500 rule, fine for web‑size: ${r500.toFixed(0)} s</span>`;
  }
}

/* -------------------------------------------------------- checklist */
function renderCheck() {
  const total = CHECKLIST.reduce((n, g) => n + g.items.length, 0);
  const done = Object.values(state.check).filter(Boolean).length;
  return `<div class="row"><h2>Shoot checklist</h2><span class="muted">${done}/${total}</span></div>
    ${CHECKLIST.map((g, gi) => `<h3>${g.g}</h3><ul class="check">${g.items.map((it, ii) => {
      const k = gi + '.' + ii, on = !!state.check[k];
      return `<li class="${on ? 'done' : ''}"><label><input type="checkbox" data-check="${k}" ${on ? 'checked' : ''}><span>${esc(it)}</span></label></li>`;
    }).join('')}</ul>`).join('')}
    <p style="margin-top:14px"><button class="btn" id="reset-check">Reset for the next job</button></p>`;
}

/* ------------------------------------------------------------ saved */
function renderSaved() {
  const favs = TIPS.filter(t => state.fav.has(t.id));
  return `<h2>Saved</h2>
    <div class="grid">${favs.map(tipCard).join('') || '<div class="empty">Tap ☆ on a tip to keep it here.</div>'}</div>
    <h3>My notes</h3>
    <textarea class="notes" id="notes" placeholder="Your own settings, lens quirks, lessons from the last job…">${esc(store.get('notes', ''))}</textarea>
    <p class="muted" style="font-size:13px">Saved on this phone only.</p>`;
}

/* ----------------------------------------------------------- render */
function render() {
  syncChrome();
  const v = $('#view');
  v.innerHTML = { tips: renderTips, recipes: renderRecipes, tools: renderTools, check: renderCheck, saved: renderSaved }[state.tab]();
  if (state.tab === 'tools') calcTools();
  if (state.tab === 'tips') {
    const q = $('#q');
    q.addEventListener('input', () => {
      state.q = q.value; const pos = q.selectionStart;
      render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos);
    });
  }
  if (state.tab === 'saved') $('#notes').addEventListener('input', e => store.set('notes', e.target.value));
}

function toggleFav(id) {
  state.fav.has(id) ? state.fav.delete(id) : state.fav.add(id);
  store.set('fav', [...state.fav]);
}

document.addEventListener('click', e => {
  const star = e.target.closest('[data-star]');
  if (star) {
    e.stopPropagation(); toggleFav(star.dataset.star);
    const inSheet = star.closest('#sheet');
    render(); if (inSheet) openTip(star.dataset.star);
    return;
  }
  const tip = e.target.closest('[data-tip]'); if (tip) return openTip(tip.dataset.tip);
  const rec = e.target.closest('[data-recipe]'); if (rec) return openRecipe(rec.dataset.recipe);
  const cat = e.target.closest('[data-cat]'); if (cat) { state.cat = cat.dataset.cat; return render(); }
  if (e.target.id === 'wb-open') return WB.open();
  if (e.target.id === 'reset-check') { state.check = {}; store.set('check', {}); return render(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSheet();
  if (e.key === 'Enter' && e.target.matches('[data-tip]')) openTip(e.target.dataset.tip);
});
document.addEventListener('change', e => {
  const c = e.target.closest('[data-check]');
  if (c) { state.check[c.dataset.check] = c.checked; store.set('check', state.check); render(); }
});
document.addEventListener('input', e => { if (e.target.closest('.tool')) calcTools(); });

/* ------------------------------------------------------------ sheet */
function openSheet(html) {
  $('#sheet-body').innerHTML = html; $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden'; $('.sheet-card').scrollTop = 0;
  if (!history.state?.sheet) history.pushState({ sheet: 1 }, '');
}
function closeSheet() {
  if ($('#sheet').hidden) return;
  $('#sheet').hidden = true; document.body.style.overflow = '';
  if (history.state?.sheet) history.back();
}
$('#sheet-close').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
// Android back button closes the sheet instead of leaving the app
window.addEventListener('popstate', () => { $('#sheet').hidden = true; document.body.style.overflow = ''; });

render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    // An installed app can stay open for days; look for a new build whenever it comes back to the front
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  });
  // Only reload onto a new build, not when the very first worker takes control
  let reloaded = !navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}
