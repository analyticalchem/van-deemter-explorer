/*
 * Wires the controls to the model, the simulation, and the views.
 */
(function () {
  'use strict';

  var VD = window.VD, P = VD.params, fmt = window.vdFormat;

  var N_MOLECULES = 800;
  var MAG = 9;                  // band-width magnification in the animation (variance ×81)
  var TIME_COMPRESSION = 10;    // column seconds per screen second at 1× speed
  var INJECT_FRACTION = 0.018;  // injected plug width as a fraction of the column (at ×9)
  var K_MIN = 0.3, K_MAX = 10;  // retention-factor range of the mass-transfer slider

  function $(id) { return document.getElementById(id); }

  var els = {
    flow: $('flow'), temp: $('temp'), dp: $('dp'), mt: $('mt'),
    flowOut: $('flow-out'), flowSub: $('flow-sub'),
    tempOut: $('temp-out'), dpOut: $('dp-out'), mtOut: $('mt-out'), mtSub: $('mt-sub'),
    inject: $('inject'), pause: $('pause'), speed: $('speed'),
    ghost: $('ghost'), trueScale: $('truescale'), auto: $('auto'), autoY: $('autoy'),
    scaleNote: $('scale-note'), live: $('live'), theme: $('theme'),
    table: $('vd-table'), lgGhost: $('lg-ghost')
  };

  var state = {
    terms: { A: true, B: true, C: true },
    paused: false,
    speed: 1,
    ghost: true,
    trueScale: false,
    auto: true,
    autoY: false
  };

  var sim = new window.VDSim(N_MOLECULES);
  var column = new window.ColumnView($('column'), sim, P.L);
  var band = new window.BandPlot($('band'), sim, P.L);
  var vdPlot = new window.VanDeemterPlot($('vd'), $('vd-tip'), setFlow);

  function kFromSlider(v) { return K_MIN * Math.pow(K_MAX / K_MIN, v / 100); }

  function affinityWord(k) {
    return k < 1 ? 'weak' : (k < 4 ? 'moderate' : 'strong');
  }

  var cur = null;
  var injectTime = 0;

  function readInputs() {
    return {
      F: +els.flow.value,
      Tc: +els.temp.value,
      dpUm: +els.dp.value,
      k: kFromSlider(+els.mt.value)
    };
  }

  function recompute() {
    var inp = readInputs();
    var co = VD.coefficients(inp.dpUm * 1e-6, inp.Tc, inp.k);
    var u = VD.velocityFromFlow(inp.F);
    var hp = VD.plateHeight(u, co, state.terms);
    var opt = VD.optimum(co, state.terms);
    var a = VD.activeCoefficients(co, state.terms);
    var mag = state.trueScale ? 1 : MAG, M2 = mag * mag;
    sim.configure({
      u: u, k: inp.k, L: P.L,
      A: a.A * M2, B: a.B * M2, C: a.C * M2,
      H: hp.H * M2, Hghost: opt.H * M2
    });
    band.mag = mag;
    band.showGhost = state.ghost;
    band.rescale();
    column.setParticleSize(inp.dpUm);
    vdPlot.setData({ co: co, terms: state.terms, u: u, opt: opt, autoY: state.autoY });

    cur = { inp: inp, co: co, u: u, hp: hp, opt: opt, mag: mag };
    updateControls();
    updateReadouts();
    updateTable();
    updateScaleNote();
  }

  function inject() {
    sim.inject(INJECT_FRACTION * P.L * cur.mag / MAG);
    injectTime = sim.t;
    column.onInject();
    band.onInject();
    endTimer = null;
  }

  function setFlow(F) {
    var step = +els.flow.step;
    F = Math.round(F / step) * step;
    F = Math.max(P.Fmin, Math.min(P.Fmax, F));
    els.flow.value = F.toFixed(2);
    recompute();
  }

  // --- readouts ---------------------------------------------------------------

  function setText(id, text) { $(id).textContent = text; }

  function minutes(s) {
    var m = s / 60;
    return m < 10 ? fmt(m, 1) + ' min' : fmt(m, 0) + ' min';
  }

  function updateControls() {
    var inp = cur.inp;
    els.flowOut.textContent = fmt(inp.F, 2) + ' mL/min';
    els.flowSub.textContent = 'Linear velocity u = ' + fmt(cur.u * 1000, 2) + ' mm/s';
    els.tempOut.textContent = inp.Tc + ' °C';
    els.dpOut.textContent = fmt(inp.dpUm, 1) + ' µm';
    els.mtOut.textContent = 'k = ' + fmt(inp.k, inp.k < 1 ? 2 : 1);
    els.mtSub.textContent = 'Analyte affinity for the stationary phase: ' + affinityWord(inp.k) +
      (state.terms.C ? '' : ' · C·u off, so exchange between phases is instantaneous');
    Array.prototype.forEach.call(document.querySelectorAll('[data-dp]'), function (b) {
      b.setAttribute('aria-pressed', String(Math.abs(+b.dataset.dp - inp.dpUm) < 0.05));
    });
  }

  function updateReadouts() {
    var co = cur.co, hp = cur.hp, opt = cur.opt, inp = cur.inp;
    setText('r-H', fmt(hp.H * 1e6, 1) + ' µm');
    setText('r-A', state.terms.A ? fmt(hp.A * 1e6, 1) : 'off');
    setText('r-B', state.terms.B ? fmt(hp.B * 1e6, 1) : 'off');
    setText('r-C', state.terms.C ? fmt(hp.C * 1e6, 1) : 'off');
    setText('r-N', hp.H > 0 ? Math.round(P.L / hp.H).toLocaleString() : '∞');

    if (opt.u !== null) {
      setText('r-uopt', fmt(opt.u * 1000, 2) + ' mm/s');
      setText('r-uopt-sub', fmt(VD.flowFromVelocity(opt.u), 2) + ' mL/min · H_min ' + fmt(opt.H * 1e6, 1) + ' µm' +
        (opt.interior ? '' : ' (edge of range)'));
    } else {
      setText('r-uopt', 'any');
      setText('r-uopt-sub', 'H does not depend on flow');
    }

    var k = inp.k;
    var tm = VD.times(cur.u, k);
    setText('r-tR', minutes(tm.tR));
    setText('r-tR-sub', 't₀ = ' + minutes(tm.t0) + ' · k = ' + fmt(k, k < 1 ? 2 : 1));
    setText('r-sigma', fmt(4 * Math.sqrt(hp.H * P.L) * 1000, 2) + ' mm');
    setText('r-frac-sub', 'Theory k/(1+k) = ' + Math.round(100 * k / (1 + k)) + '%' +
      (state.terms.C ? '' : ' · instant exchange'));
    setText('r-Dm', fmt(co.Dm * 1e9, 2) + ' × 10⁻⁹ m²/s');
    setText('r-Dm-sub', 'Viscosity η = ' + fmt(co.eta * 1000, 2) + ' mPa·s');

    var dP = VD.pressure(cur.u, co), bar = dP / 1e5;
    setText('r-P', fmt(bar, 0) + ' bar');
    setText('r-Ppsi', fmt(bar * 14.5038, 0) + ' psi');
    var fill = $('p-fill'), status = $('p-status');
    fill.style.width = Math.min(100, bar / 1500 * 100) + '%';
    var level = dP > P.UHPLC_LIMIT ? 'critical' : (dP > P.HPLC_LIMIT ? 'warning' : 'ok');
    fill.dataset.level = level;
    status.dataset.level = level;
    status.textContent = level === 'ok' ? '✓ Within a standard HPLC pump’s range (≤ 400 bar)'
      : level === 'warning' ? '▲ Needs a UHPLC system (> 400 bar)'
      : '✕ Beyond typical UHPLC limits (> 1300 bar)';
  }

  function updateLive() {
    var q = sim.p;
    setText('r-frac', Math.round(sim.stats().fracStationary * 100) + '%');
    var pos = Math.max(0, sim.center);
    var sigmaReal = Math.sqrt(sim.variance) / cur.mag;
    var elapsed = sim.t - injectTime;
    var where = pos < P.L
      ? 'Band centre ' + fmt(pos * 1000, 0) + ' mm from the inlet'
      : 'Band centre has reached the detector';
    els.live.textContent = where + ' · 2σ = ' + fmt(2 * sigmaReal * 1000, 2) +
      ' mm (real column) · ' + minutes(elapsed) + ' after injection';
  }

  function updateTable() {
    var t = els.table, co = cur.co, terms = state.terms;
    t.textContent = '';
    var head = t.createTHead().insertRow();
    ['Flow (mL/min)', 'u (mm/s)', 'A (µm)', 'B/u (µm)', 'C·u (µm)', 'H (µm)', 'N', 'ΔP (bar)'].forEach(function (h) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = h;
      head.appendChild(th);
    });
    var body = t.createTBody();
    [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5].forEach(function (F) {
      var u = VD.velocityFromFlow(F), hp = VD.plateHeight(u, co, terms);
      var cells = [
        fmt(F, 2), fmt(u * 1000, 2),
        terms.A ? fmt(hp.A * 1e6, 2) : 'off',
        terms.B ? fmt(hp.B * 1e6, 2) : 'off',
        terms.C ? fmt(hp.C * 1e6, 2) : 'off',
        fmt(hp.H * 1e6, 2),
        hp.H > 0 ? Math.round(P.L / hp.H).toLocaleString() : '∞',
        fmt(VD.pressure(u, co) / 1e5, 0)
      ];
      var row = body.insertRow();
      cells.forEach(function (c) { row.insertCell().textContent = c; });
    });
  }

  function updateScaleNote() {
    var secs = TIME_COMPRESSION * state.speed;
    var time = '1 s on screen = ' + fmt(secs, secs < 10 ? 1 : 0) + ' s in the column';
    els.scaleNote.textContent = state.trueScale
      ? 'Band width at true scale · ' + time
      : 'Band width magnified ×' + MAG + ' so it can be seen · ' + time;
    els.lgGhost.hidden = !state.ghost;
  }

  // --- animation loop ---------------------------------------------------------

  var last = performance.now(), liveTimer = 1, endTimer = null;

  function checkEnd(dt) {
    if (endTimer !== null) {
      endTimer -= dt;
      if (endTimer <= 0) inject();
      return;
    }
    var inside = 0;
    for (var i = 0; i < sim.n; i++) if (sim.x[i] < P.L) inside++;
    if (inside < sim.n * 0.01 && state.auto) endTimer = 1.0;
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!state.paused) {
      var ts = TIME_COMPRESSION * state.speed;
      sim.step(dt * ts);
      column.update(dt, ts);
      checkEnd(dt);
      liveTimer += dt;
      if (liveTimer > 0.2) { liveTimer = 0; updateLive(); }
    }
    column.draw();
    band.draw();
    requestAnimationFrame(frame);
  }

  // --- layout and theme -------------------------------------------------------

  function layout() {
    var w = $('column').clientWidth;
    var pad = w < 560 ? 34 : 60;
    column.setLayout(pad, pad);
    band.setLayout(pad, pad);
    column.resize();
    band.resize();
    vdPlot.resize();
  }

  var themes = ['auto', 'light', 'dark'];
  function applyTheme(name) {
    if (name === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = name;
    els.theme.textContent = 'Theme: ' + name;
    try { localStorage.setItem('vd-theme', name); } catch (e) { /* storage unavailable */ }
    refreshTheme();
  }
  function refreshTheme() {
    column.refreshTheme();
    band.refreshTheme();
    vdPlot.refreshTheme();
  }

  // --- events -----------------------------------------------------------------

  [els.flow, els.temp, els.dp, els.mt].forEach(function (el) {
    el.addEventListener('input', recompute);
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-dp]'), function (b) {
    b.addEventListener('click', function () {
      els.dp.value = b.dataset.dp;
      recompute();
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('.term'), function (b) {
    b.addEventListener('click', function () {
      var t = b.dataset.term;
      state.terms[t] = !state.terms[t];
      b.setAttribute('aria-pressed', String(state.terms[t]));
      recompute();
    });
  });

  els.inject.addEventListener('click', function () { inject(); });

  els.pause.addEventListener('click', function () {
    state.paused = !state.paused;
    els.pause.textContent = state.paused ? 'Play' : 'Pause';
    els.pause.setAttribute('aria-pressed', String(state.paused));
    last = performance.now();
  });

  els.speed.addEventListener('change', function () {
    state.speed = +els.speed.value;
    updateScaleNote();
  });

  els.ghost.addEventListener('change', function () {
    state.ghost = els.ghost.checked;
    band.showGhost = state.ghost;
    updateScaleNote();
  });

  els.trueScale.addEventListener('change', function () {
    state.trueScale = els.trueScale.checked;
    recompute();
    inject();
  });

  els.auto.addEventListener('change', function () {
    state.auto = els.auto.checked;
    if (state.auto) endTimer = null;
  });

  els.autoY.addEventListener('change', function () {
    state.autoY = els.autoY.checked;
    recompute();
  });

  els.theme.addEventListener('click', function () {
    var curName = document.documentElement.dataset.theme || 'auto';
    applyTheme(themes[(themes.indexOf(curName) + 1) % themes.length]);
  });

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshTheme);
  }

  var resizeQueued = false;
  new ResizeObserver(function () {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(function () {
      resizeQueued = false;
      layout();
    });
  }).observe(document.querySelector('main'));

  // --- start ------------------------------------------------------------------

  var saved = 'auto';
  try { saved = localStorage.getItem('vd-theme') || 'auto'; } catch (e) { /* storage unavailable */ }
  if (saved !== 'auto') document.documentElement.dataset.theme = saved;
  els.theme.textContent = 'Theme: ' + saved;

  recompute();
  layout();
  refreshTheme();
  inject();
  updateLive();
  requestAnimationFrame(frame);

  // Exposed for checking the model from the browser console.
  window.vdApp = { sim: sim, column: column, band: band, plot: vdPlot, state: state, current: function () { return cur; }, inject: inject, recompute: recompute };
})();
