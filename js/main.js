/*
 * Wires the controls to the model, the simulations, and the views.
 * Two analytes, each with its own tick box and stationary-phase-affinity
 * slider; at least one is always shown. Both share the column, flow,
 * temperature and diffusion coefficient, so they differ only in k and
 * therefore in C.
 */
(function () {
  'use strict';

  var VD = window.VD, P = VD.params, fmt = window.vdFormat;

  var N_MOLECULES = 800;        // per analyte
  var MAG = 9;                  // band-width magnification in the animation (variance ×81)
  var TIME_COMPRESSION = 10;    // column seconds per screen second at 1× speed
  var INJECT_FRACTION = 0.018;  // injected plug width as a fraction of the column (at ×9)
  var K_MIN = 0.3, K_MAX = 10;  // retention-factor range of the SP-affinity sliders
  var SUB = ['₁', '₂'];

  function $(id) { return document.getElementById(id); }

  var els = {
    flow: $('flow'), temp: $('temp'), dp: $('dp'),
    flowOut: $('flow-out'), flowSub: $('flow-sub'),
    tempOut: $('temp-out'), dpOut: $('dp-out'),
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

  // suffix: the id suffix of this analyte's readout elements ('' or '2').
  var analytes = [
    { id: 0, on: true, suffix: '', color: '--analyte', sim: new window.VDSim(N_MOLECULES),
      check: $('a1-on'), slider: $('mt'), out: $('mt-out'), sub: $('mt-sub') },
    { id: 1, on: false, suffix: '2', color: '--analyte2', sim: new window.VDSim(N_MOLECULES),
      check: $('a2-on'), slider: $('mt2'), out: $('mt2-out'), sub: $('mt2-sub') }
  ];
  var column = new window.ColumnView($('column'), analytes, P.L);
  var band = new window.BandPlot($('band'), analytes, P.L);
  var vdPlot = new window.VanDeemterPlot($('vd'), $('vd-tip'), setFlow);

  function active() { return analytes.filter(function (a) { return a.on; }); }
  function bothOn() { return analytes[0].on && analytes[1].on; }

  function kFromSlider(v) { return K_MIN * Math.pow(K_MAX / K_MIN, v / 100); }

  function kText(k) { return fmt(k, k < 1 ? 2 : 1); }

  function affinityWord(k) {
    return k < 1 ? 'weak' : (k < 4 ? 'moderate' : 'strong');
  }

  var cur = null;

  function readInputs() {
    return { F: +els.flow.value, Tc: +els.temp.value, dpUm: +els.dp.value };
  }

  function recompute() {
    var inp = readInputs();
    var u = VD.velocityFromFlow(inp.F);
    var mag = state.trueScale ? 1 : MAG, M2 = mag * mag;
    analytes.forEach(function (a) {
      a.k = kFromSlider(+a.slider.value);
      a.co = VD.coefficients(inp.dpUm * 1e-6, inp.Tc, a.k);
      a.hp = VD.plateHeight(u, a.co, state.terms);
      a.opt = VD.optimum(a.co, state.terms);
      var c = VD.activeCoefficients(a.co, state.terms);
      a.sim.configure({
        u: u, k: a.k, L: P.L,
        A: c.A * M2, B: c.B * M2, C: c.C * M2,
        H: a.hp.H * M2, Hghost: a.opt.H * M2
      });
      column.setVisible(a.id, a.on);
      band.setVisible(a.id, a.on);
    });
    document.body.classList.toggle('show-a1', analytes[0].on);
    document.body.classList.toggle('show-a2', analytes[1].on);
    document.body.classList.toggle('two-analytes', bothOn());
    band.mag = mag;
    band.showGhost = state.ghost;
    column.setParticleSize(inp.dpUm);
    vdPlot.setData({
      terms: state.terms, u: u, autoY: state.autoY,
      analytes: active().map(function (a) { return { co: a.co, opt: a.opt, id: a.id }; })
    });

    cur = { inp: inp, u: u, mag: mag };
    updateControls();
    updateReadouts();
    updateTable();
    updateScaleNote();
  }

  function inject() {
    analytes.forEach(function (a) {
      a.sim.inject(INJECT_FRACTION * P.L * cur.mag / MAG);
      a.injectTime = a.sim.t;
    });
    column.onInject();
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

  /** Values of one quantity for the analytes shown, joined for a shared caption. */
  function both(fn, sep) {
    return active().map(fn).join(sep || ' and ');
  }

  /** Rs = (tR2 − tR1) / [2(σt1 + σt2)] at the column outlet, real column. */
  function resolution(u) {
    var L = P.L, a1 = analytes[0], a2 = analytes[1];
    var s1 = Math.sqrt(a1.hp.H * L) * (1 + a1.k) / u;
    var s2 = Math.sqrt(a2.hp.H * L) * (1 + a2.k) / u;
    var dt = Math.abs(a2.k - a1.k) * L / u;
    return s1 + s2 > 0 ? dt / (2 * (s1 + s2)) : Infinity;
  }

  function updateControls() {
    var inp = cur.inp;
    var cOff = state.terms.C ? '' : ' · C·u off, so exchange between phases is instantaneous';
    els.flowOut.textContent = fmt(inp.F, 2) + ' mL/min';
    els.flowSub.textContent = 'Linear velocity u = ' + fmt(cur.u * 1000, 2) + ' mm/s';
    els.tempOut.textContent = inp.Tc + ' °C';
    els.dpOut.textContent = fmt(inp.dpUm, 1) + ' µm';
    var onCount = active().length;
    analytes.forEach(function (a) {
      var n = a.id + 1;
      a.check.checked = a.on;
      // The last analyte shown can't be switched off.
      a.check.disabled = a.on && onCount === 1;
      a.check.title = a.check.disabled ? 'At least one analyte stays on' : (a.on ? 'Hide' : 'Show') + ' analyte ' + n;
      a.slider.disabled = !a.on;
      a.out.textContent = 'k = ' + kText(a.k);
      a.sub.textContent = 'Analyte ' + n + ' affinity for the stationary phase: ' + affinityWord(a.k) +
        (a.on ? cOff : ' · tick the box to add analyte ' + n);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-dp]'), function (b) {
      b.setAttribute('aria-pressed', String(Math.abs(+b.dataset.dp - inp.dpUm) < 0.05));
    });
  }

  function updateReadouts() {
    var u = cur.u, co = analytes[0].co, list = active();
    function um(h) { return fmt(h * 1e6, 1); }
    function plates(h) { return h > 0 ? Math.round(P.L / h).toLocaleString() : '∞'; }

    analytes.forEach(function (a) {
      var s = a.suffix, hp = a.hp;
      setText('r-H' + s, um(hp.H) + ' µm');
      setText('r-A' + s, state.terms.A ? um(hp.A) : 'off');
      setText('r-B' + s, state.terms.B ? um(hp.B) : 'off');
      setText('r-C' + s, state.terms.C ? um(hp.C) : 'off');
      setText('r-N' + s, plates(hp.H));
      setText('r-uopt' + s, a.opt.u !== null ? fmt(a.opt.u * 1000, 2) + ' mm/s' : 'any');
      setText('r-tR' + s, minutes(VD.times(u, a.k).tR));
      setText('r-sigma' + s, fmt(4 * Math.sqrt(hp.H * P.L) * 1000, 2) + ' mm');
    });

    if (list[0].opt.u === null) {
      setText('r-uopt-sub', 'H does not depend on flow');
    } else {
      var edge = list.some(function (a) { return !a.opt.interior; }) ? ' (edge of range)' : '';
      setText('r-uopt-sub', both(function (a) { return fmt(VD.flowFromVelocity(a.opt.u), 2); }, ' / ') +
        ' mL/min · H_min ' + both(function (a) { return um(a.opt.H); }, ' / ') + ' µm' + edge);
    }
    setText('r-tR-sub', 't₀ = ' + minutes(VD.times(u, 0).t0) + ' · k = ' + both(function (a) { return kText(a.k); }));
    setText('r-frac-sub', (list.length > 1 ? 'Theory ' : 'Theory k/(1+k) = ') +
      both(function (a) { return Math.round(100 * a.k / (1 + a.k)) + '%'; }) +
      (state.terms.C ? '' : ' · instant exchange'));

    if (bothOn()) {
      var rs = resolution(u);
      setText('r-Rs', isFinite(rs) ? fmt(rs, rs < 10 ? 2 : 1) : '∞');
      var drawn = cur.mag > 1 && isFinite(rs) ? 'Real column; ≈ ' + fmt(rs / cur.mag, 1) + ' as drawn' : 'Real column';
      setText('r-Rs-sub', (analytes[0].k === analytes[1].k ? 'Co-eluting · ' : '') + drawn + ' · baseline at Rs ≥ 1.5');
    }

    setText('r-Dm', fmt(co.Dm * 1e9, 2) + ' × 10⁻⁹ m²/s');
    setText('r-Dm-sub', 'Viscosity η = ' + fmt(co.eta * 1000, 2) + ' mPa·s');

    var dP = VD.pressure(u, co), bar = dP / 1e5;
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
    var list = active(), first = list[0];
    list.forEach(function (a) {
      setText('r-frac' + a.suffix, Math.round(a.sim.stats().fracStationary * 100) + '%');
    });
    var elapsed = first.sim.t - first.injectTime;
    function where(a) {
      var pos = Math.max(0, a.sim.center);
      return pos < P.L ? fmt(pos * 1000, 0) + ' mm' : 'the detector';
    }
    var text;
    if (list.length > 1) {
      text = 'Band centres: analyte 1 at ' + where(analytes[0]) + ', analyte 2 at ' + where(analytes[1]);
    } else {
      var sigmaReal = Math.sqrt(first.sim.variance) / cur.mag;
      text = 'Analyte ' + (first.id + 1) + ' band centre ' +
        (first.sim.center < P.L ? where(first) + ' from the inlet' : 'has reached the detector') +
        ' · 4σ = ' + fmt(4 * sigmaReal * 1000, 2) + ' mm (real column)';
    }
    els.live.textContent = text + ' · ' + minutes(elapsed) + ' after injection';
  }

  function updateTable() {
    var t = els.table, terms = state.terms, list = active(), two = list.length > 1;
    t.textContent = '';
    var heads = ['Flow (mL/min)', 'u (mm/s)', 'A (µm)', 'B/u (µm)'];
    list.forEach(function (a) {
      var s = two ? SUB[a.id] : '';
      heads.push('C·u' + s + ' (µm)', 'H' + s + ' (µm)', 'N' + s);
    });
    heads.push('ΔP (bar)');
    var head = t.createTHead().insertRow();
    heads.forEach(function (h) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = h;
      head.appendChild(th);
    });
    var body = t.createTBody();
    function plates(h) { return h > 0 ? Math.round(P.L / h).toLocaleString() : '∞'; }
    [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5].forEach(function (F) {
      var u = VD.velocityFromFlow(F);
      var hps = list.map(function (a) { return VD.plateHeight(u, a.co, terms); });
      var cells = [
        fmt(F, 2), fmt(u * 1000, 2),
        terms.A ? fmt(hps[0].A * 1e6, 2) : 'off',
        terms.B ? fmt(hps[0].B * 1e6, 2) : 'off'
      ];
      hps.forEach(function (hp) {
        cells.push(terms.C ? fmt(hp.C * 1e6, 2) : 'off', fmt(hp.H * 1e6, 2), plates(hp.H));
      });
      cells.push(fmt(VD.pressure(u, list[0].co) / 1e5, 0));
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
    var done = active().every(function (a) {
      var sim = a.sim, inside = 0;
      for (var i = 0; i < sim.n; i++) if (sim.x[i] < P.L) inside++;
      return inside < sim.n * 0.01;
    });
    if (done && state.auto) endTimer = 1.0;
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!state.paused) {
      var ts = TIME_COMPRESSION * state.speed;
      active().forEach(function (a) { a.sim.step(dt * ts); });
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

  [els.flow, els.temp, els.dp].forEach(function (el) {
    el.addEventListener('input', recompute);
  });

  analytes.forEach(function (a) {
    a.slider.addEventListener('input', recompute);
    a.check.addEventListener('change', function () {
      a.on = a.check.checked;
      if (!active().length) a.on = true;   // keep at least one analyte on
      recompute();
      inject();   // start the analytes shown together from the inlet
      updateLive();
    });
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

  // Browsers may restore the tick boxes on reload.
  analytes.forEach(function (a) { a.on = a.check.checked; });
  if (!active().length) analytes[0].on = true;
  recompute();
  layout();
  refreshTheme();
  inject();
  updateLive();
  requestAnimationFrame(frame);

  // Exposed for checking the model from the browser console.
  window.vdApp = {
    analytes: analytes, sim: analytes[0].sim, column: column, band: band, plot: vdPlot,
    state: state, current: function () { return cur; }, inject: inject, recompute: recompute,
    resolution: function () { return resolution(cur.u); }
  };
})();
