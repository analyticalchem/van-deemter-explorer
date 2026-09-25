/*
 * Two plots:
 *   BandPlot         — analyte distribution along the column (histogram of the
 *                      simulated molecules + the Gaussian predicted by σ² = H·x),
 *                      drawn on the same x-axis as the column animation.
 *   VanDeemterPlot   — H versus linear velocity u with the A, B/u and C·u terms.
 */
(function (root) {
  'use strict';

  var FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  var SQRT2PI = Math.sqrt(2 * Math.PI);

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function readChrome() {
    return {
      surface: cssVar('--surface'),
      text: cssVar('--text-primary'),
      text2: cssVar('--text-secondary'),
      muted: cssVar('--text-muted'),
      grid: cssVar('--grid'),
      axis: cssVar('--axis'),
      A: cssVar('--series-a'),
      B: cssVar('--series-b'),
      C: cssVar('--series-c'),
      analyte: cssVar('--analyte'),
      warning: cssVar('--status-warning'),
      critical: cssVar('--status-critical')
    };
  }

  function setupCanvas(canvas) {
    var dpr = window.devicePixelRatio || 1;
    var W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    var g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g: g, W: W, H: H };
  }

  function withAlpha(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function niceStep(range, target) {
    var raw = range / target, p = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }

  function fmt(v, d) {
    return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /** Text with a surface-colored halo so it stays legible over curves. */
  function haloText(g, text, x, y, surface) {
    g.save();
    g.strokeStyle = surface;
    g.lineWidth = 4;
    g.lineJoin = 'round';
    g.strokeText(text, x, y);
    g.restore();
    g.fillText(text, x, y);
  }

  // ---------------------------------------------------------------------------

  function BandPlot(canvas, sim, L) {
    this.canvas = canvas;
    this.sim = sim;
    this.L = L;
    this.padL = 56;
    this.padR = 56;
    this.yMax = 0;
    this.snap = true;
    this.mag = 1;
    this.showGhost = true;
    this.colors = readChrome();
  }

  BandPlot.prototype.setLayout = function (padL, padR) {
    this.padL = padL;
    this.padR = padR;
  };

  BandPlot.prototype.resize = function () {
    var s = setupCanvas(this.canvas);
    this.g = s.g;
    this.W = s.W;
    this.H = s.H;
    this.x0 = this.padL;
    this.x1 = s.W - this.padR;
    this.top = 16;
    this.bottom = s.H - 24;
    this.nb = Math.max(30, Math.min(120, Math.round((this.x1 - this.x0) / 9)));
    this.counts = new Uint16Array(this.nb);
    this.rescale();
  };

  BandPlot.prototype.onInject = function () {
    this.rescale();
  };

  /** Jump straight to the new y-scale on the next frame instead of easing into it. */
  BandPlot.prototype.rescale = function () {
    this.snap = true;
  };

  BandPlot.prototype.refreshTheme = function () {
    this.colors = readChrome();
  };

  BandPlot.prototype.draw = function () {
    if (!this.g) return;
    var g = this.g, C = this.colors, sim = this.sim, L = this.L;
    var x0 = this.x0, x1 = this.x1, top = this.top, bot = this.bottom;
    var nb = this.nb, binW = L / nb, counts = this.counts, i;
    counts.fill(0);
    var maxCount = 0;
    for (i = 0; i < sim.n; i++) {
      var b = Math.floor(sim.x[i] / binW);
      if (b >= 0 && b < nb && ++counts[b] > maxCount) maxCount = counts[b];
    }

    // The y-scale follows the taller of the two predicted bands, so the width
    // comparison stays readable as the band spreads out.
    var mu = sim.center, sd = Math.sqrt(sim.variance), sdG = Math.sqrt(sim.varGhost);
    var amp = sim.n * binW / SQRT2PI;
    var want = Math.max(1.2 * amp / sd, this.showGhost ? 1.2 * amp / sdG : 0, 1.05 * maxCount, 1);
    if (this.snap || !(this.yMax > 0)) { this.yMax = want; this.snap = false; }
    else this.yMax += (want - this.yMax) * 0.08;
    var kx = (x1 - x0) / L, ky = (bot - top) / this.yMax;
    g.clearRect(0, 0, this.W, this.H);

    // Axis and ticks (mm along the column).
    g.strokeStyle = C.axis;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0, bot + 0.5);
    g.lineTo(x1, bot + 0.5);
    g.stroke();
    g.fillStyle = C.muted;
    g.font = '11px ' + FONT;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    var mm = L * 1000, step = niceStep(mm, (x1 - x0) / 90);
    for (var v = 0; v <= mm + 1e-9; v += step) {
      var tx = x0 + v / 1000 * kx;
      g.beginPath();
      g.moveTo(tx + 0.5, bot);
      g.lineTo(tx + 0.5, bot + 4);
      g.stroke();
      var last = v + step > mm + 1e-9;
      g.fillText(v === 0 ? '0' : fmt(v, 0) + (last ? ' mm' : ''), tx, bot + 6);
    }

    g.save();
    g.beginPath();
    g.rect(x0, 0, x1 - x0, bot);
    g.clip();

    // Histogram of simulated molecules.
    var bw = (x1 - x0) / nb, gap = bw > 6 ? 2 : 1;
    g.fillStyle = withAlpha(C.analyte, 0.3);
    for (i = 0; i < nb; i++) {
      if (!counts[i]) continue;
      var h = Math.min(counts[i] * ky, bot - top + 12);
      g.fillRect(x0 + i * bw + gap / 2, bot - h, bw - gap, h);
    }

    // Predicted Gaussians: σ² = σ0² + H·x.
    function curve(s) {
      g.beginPath();
      for (var px = x0; px <= x1; px += 1.5) {
        var xm = (px - x0) / kx, z = (xm - mu) / s;
        var y = bot - Math.min(amp / s * Math.exp(-0.5 * z * z) * ky, bot + 20);
        if (px === x0) g.moveTo(px, y); else g.lineTo(px, y);
      }
    }

    if (this.showGhost && sdG > 0 && Math.abs(sdG - sd) / sd > 0.01) {
      curve(sdG);
      g.strokeStyle = C.text2;
      g.lineWidth = 1.5;
      g.setLineDash([5, 4]);
      g.stroke();
      g.setLineDash([]);
    }

    curve(sd);
    g.lineTo(x1, bot);
    g.lineTo(x0, bot);
    g.closePath();
    g.fillStyle = withAlpha(C.analyte, 0.1);
    g.fill();
    curve(sd);
    g.strokeStyle = C.analyte;
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.stroke();
    g.restore();

    // ±σ bracket with the real-column value.
    var peakY = bot - Math.min(amp / sd * ky, bot - top);
    var yb = bot - Math.min(amp / sd * Math.exp(-0.5) * ky, bot - top - 4);
    var xl = x0 + (mu - sd) * kx, xr = x0 + (mu + sd) * kx;
    if (xr > x0 && xl < x1) {
      g.strokeStyle = C.text;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(xl, yb - 4); g.lineTo(xl, yb + 4);
      g.moveTo(xl, yb); g.lineTo(xr, yb);
      g.moveTo(xr, yb - 4); g.lineTo(xr, yb + 4);
      g.stroke();
      var label = '2σ = ' + fmt(2 * sd / this.mag * 1000, 2) + ' mm';
      g.font = '12px ' + FONT;
      g.fillStyle = C.text;
      g.textBaseline = 'bottom';
      g.textAlign = 'center';
      var tw = g.measureText(label).width;
      var lx = Math.max(x0 + tw / 2, Math.min(x1 - tw / 2, (xl + xr) / 2));
      var ly = Math.max(top + 12, Math.min(peakY - 4, yb - 6));
      haloText(g, label, lx, ly, C.surface);
    }
  };

  // ---------------------------------------------------------------------------

  var FIXED_HMAX = 30e-6; // m

  function VanDeemterPlot(canvas, tooltip, onPick) {
    this.canvas = canvas;
    this.tooltip = tooltip;
    this.onPick = onPick;
    this.data = null;
    this.hoverU = null;
    this.colors = readChrome();
    var self = this;
    canvas.addEventListener('pointermove', function (e) { self.pointer(e, false); });
    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      self.dragging = true;
      self.pointer(e, true);
    });
    canvas.addEventListener('pointerup', function (e) {
      self.dragging = false;
      canvas.releasePointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerleave', function () {
      if (self.dragging) return;
      self.hoverU = null;
      self.tooltip.hidden = true;
      self.draw();
    });
  }

  VanDeemterPlot.prototype.setData = function (d) {
    this.data = d;
    this.draw();
  };

  VanDeemterPlot.prototype.refreshTheme = function () {
    this.colors = readChrome();
    this.draw();
  };

  VanDeemterPlot.prototype.resize = function () {
    var s = setupCanvas(this.canvas);
    this.g = s.g;
    this.W = s.W;
    this.H = s.H;
    var narrow = s.W < 420;
    this.m = { l: 50, r: narrow ? 34 : 44, t: 34, b: 42 };
    this.draw();
  };

  VanDeemterPlot.prototype.uToX = function (u) {
    return this.m.l + u / this.uMax * (this.W - this.m.l - this.m.r);
  };

  VanDeemterPlot.prototype.xToU = function (x) {
    return (x - this.m.l) / (this.W - this.m.l - this.m.r) * this.uMax;
  };

  VanDeemterPlot.prototype.hToY = function (h) {
    return this.H - this.m.b - h / this.hMax * (this.H - this.m.t - this.m.b);
  };

  VanDeemterPlot.prototype.pointer = function (e, pick) {
    if (!this.data) return;
    var rect = this.canvas.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var inside = x >= this.m.l && x <= this.W - this.m.r && y >= this.m.t - 10 && y <= this.H - this.m.b + 10;
    if (!inside && !this.dragging) {
      this.hoverU = null;
      this.tooltip.hidden = true;
      this.draw();
      return;
    }
    var VD = root.VD, P = VD.params;
    var u = Math.max(VD.velocityFromFlow(P.Fmin), Math.min(VD.velocityFromFlow(P.Fmax), this.xToU(x)));
    this.hoverU = u;
    if (pick || this.dragging) this.onPick(VD.flowFromVelocity(u));
    this.draw();
    this.showTooltip(u, x, y);
  };

  VanDeemterPlot.prototype.showTooltip = function (u, x, y) {
    var VD = root.VD, d = this.data, C = this.colors;
    var hp = VD.plateHeight(u, d.co, d.terms);
    var tip = this.tooltip;
    tip.textContent = '';
    function row(value, name, color) {
      var r = document.createElement('div');
      r.className = 'tip-row';
      if (color) {
        var key = document.createElement('span');
        key.className = 'tip-key';
        key.style.background = color;
        r.appendChild(key);
      }
      var v = document.createElement('strong');
      v.textContent = value;
      var n = document.createElement('span');
      n.textContent = name;
      r.appendChild(v);
      r.appendChild(n);
      tip.appendChild(r);
    }
    var head = document.createElement('div');
    head.className = 'tip-head';
    head.textContent = 'u = ' + fmt(u * 1000, 2) + ' mm/s · ' + fmt(VD.flowFromVelocity(u), 2) + ' mL/min';
    tip.appendChild(head);
    row(fmt(hp.H * 1e6, 2) + ' µm', 'H (total)', C.text);
    if (d.terms.A) row(fmt(hp.A * 1e6, 2) + ' µm', 'A', C.A);
    if (d.terms.B) row(fmt(hp.B * 1e6, 2) + ' µm', 'B/u', C.B);
    if (d.terms.C) row(fmt(hp.C * 1e6, 2) + ' µm', 'C·u', C.C);
    row(fmt(VD.pressure(u, d.co) / 1e5, 0) + ' bar', 'back-pressure', null);
    var hint = document.createElement('div');
    hint.className = 'tip-hint';
    hint.textContent = 'Click or drag to set this flow rate';
    tip.appendChild(hint);
    tip.hidden = false;
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var left = x + 14;
    if (left + tw > this.W - 4) left = x - tw - 14;
    var topPos = Math.max(4, Math.min(this.H - th - 4, y - th / 2));
    tip.style.left = Math.max(4, left) + 'px';
    tip.style.top = topPos + 'px';
  };

  VanDeemterPlot.prototype.draw = function () {
    var d = this.data, g = this.g;
    if (!d || !g) return;
    var VD = root.VD, P = VD.params, C = this.colors, m = this.m;
    var W = this.W, H = this.H;
    var left = m.l, right = W - m.r, top = m.t, bot = H - m.b;
    g.clearRect(0, 0, W, H);

    var uHi = VD.velocityFromFlow(P.Fmax);
    this.uMax = Math.ceil(uHi * 1000) / 1000;
    var co = d.co, terms = d.terms;
    var hNow = VD.plateHeight(d.u, co, terms).H;
    this.hMax = d.autoY
      ? (function () {
          var want = Math.max(2.5 * d.opt.H, 1.25 * hNow, 1e-6);
          var st = niceStep(want, 5);
          return Math.ceil(want / st) * st;
        })()
      : FIXED_HMAX;
    var self = this;
    function X(u) { return self.uToX(u); }
    function Y(h) { return self.hToY(h); }

    g.font = '11px ' + FONT;

    // Pressure limits as status washes behind the data.
    var u400 = P.HPLC_LIMIT * co.dp * co.dp / (P.phi * co.eta * P.L);
    var u1300 = P.UHPLC_LIMIT * co.dp * co.dp / (P.phi * co.eta * P.L);
    function wash(u1, u2, color, label) {
      if (u1 >= self.uMax) return;
      var xa = X(u1), xb = X(Math.min(u2, self.uMax));
      g.fillStyle = withAlpha(color, 0.13);
      g.fillRect(xa, top, xb - xa, bot - top);
      g.fillStyle = withAlpha(color, 0.9);
      g.fillRect(xa, top, xb - xa, 3);
      if (xb - xa > 64) {
        g.fillStyle = C.text2;
        g.textAlign = 'left';
        g.textBaseline = 'top';
        g.fillText(label, xa + 5, top + 7);
      }
    }
    wash(u400, u1300, C.warning, '▲ > 400 bar');
    wash(u1300, Infinity, C.critical, '✕ > 1300 bar');

    // Grid and axes.
    var hStep = niceStep(this.hMax * 1e6, 5);
    g.strokeStyle = C.grid;
    g.lineWidth = 1;
    g.fillStyle = C.muted;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (var hv = 0; hv <= this.hMax * 1e6 + 1e-9; hv += hStep) {
      var gy = Math.round(Y(hv * 1e-6)) + 0.5;
      if (hv > 0) {
        g.beginPath();
        g.moveTo(left, gy);
        g.lineTo(right, gy);
        g.stroke();
      }
      g.fillText(fmt(hv, hStep < 1 ? 1 : 0), left - 6, gy);
    }
    g.strokeStyle = C.axis;
    g.beginPath();
    g.moveTo(left, Math.round(bot) + 0.5);
    g.lineTo(right, Math.round(bot) + 0.5);
    g.moveTo(left, Math.round(top) + 0.5);
    g.lineTo(right, Math.round(top) + 0.5);
    g.stroke();

    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillStyle = C.muted;
    for (var uv = 0; uv <= this.uMax * 1000 + 1e-9; uv += 1) {
      var ux = Math.round(X(uv / 1000)) + 0.5;
      g.strokeStyle = C.axis;
      g.beginPath();
      g.moveTo(ux, bot);
      g.lineTo(ux, bot + 4);
      g.stroke();
      g.fillText(fmt(uv, 0), ux, bot + 6);
    }
    g.textBaseline = 'bottom';
    for (var fv = 0; fv <= P.Fmax + 1e-9; fv += 1) {
      var fx = Math.round(X(VD.velocityFromFlow(fv))) + 0.5;
      g.beginPath();
      g.moveTo(fx, top);
      g.lineTo(fx, top - 4);
      g.stroke();
      g.fillText(fmt(fv, 0), fx, top - 5);
    }
    g.fillStyle = C.text2;
    g.font = '12px ' + FONT;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.fillText('Linear velocity u (mm/s)', (left + right) / 2, H - 2);
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText('Flow rate (mL/min)', left, 0);
    g.save();
    g.translate(12, (top + bot) / 2);
    g.rotate(-Math.PI / 2);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('Plate height H (µm)', 0, 0);
    g.restore();

    // Curves.
    g.save();
    g.beginPath();
    g.rect(left, top, right - left, bot - top);
    g.clip();
    var N = 240, uStart = this.uMax / 400;
    function plot(fn, color, width) {
      g.beginPath();
      for (var s = 0; s <= N; s++) {
        var u = uStart + (self.uMax - uStart) * s / N;
        var y = Y(Math.min(fn(u), self.hMax * 3));
        if (s === 0) g.moveTo(X(u), y); else g.lineTo(X(u), y);
      }
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.stroke();
    }
    if (terms.A) plot(function () { return co.A; }, C.A, 2);
    if (terms.B) plot(function (u) { return co.B / u; }, C.B, 2);
    if (terms.C) plot(function (u) { return co.C * u; }, C.C, 2);
    plot(function (u) { return VD.plateHeight(u, co, terms).H; }, C.text, 2.5);

    // Hover crosshair.
    if (this.hoverU !== null) {
      g.strokeStyle = C.text2;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(Math.round(X(this.hoverU)) + 0.5, top);
      g.lineTo(Math.round(X(this.hoverU)) + 0.5, bot);
      g.stroke();
    }
    g.restore();

    // Direct labels at the right end (or where a curve leaves the top).
    var labels = [];
    function endLabel(name, fn, inv, prio) {
      var hEnd = fn(self.uMax);
      if (hEnd <= self.hMax) {
        labels.push({ text: name, x: right + 6, y: Y(hEnd), align: 'left', prio: prio, margin: true });
      } else if (inv) {
        var ux = inv(self.hMax);
        if (ux > 0 && ux < self.uMax) labels.push({ text: name, x: X(ux) - 6, y: top + 10, align: 'right', prio: prio, margin: false });
      }
    }
    if (terms.A) endLabel('A', function () { return co.A; }, null, 1);
    if (terms.B) endLabel('B/u', function (u) { return co.B / u; }, null, 2);
    if (terms.C) endLabel('C·u', function (u) { return co.C * u; }, function (h) { return h / co.C; }, 3);
    endLabel('H', function (u) { return VD.plateHeight(u, co, terms).H; }, function (h) {
      var a = VD.activeCoefficients(co, terms);
      if (!a.C) return -1;
      var bq = a.A - h, disc = bq * bq - 4 * a.C * a.B;
      return disc < 0 ? -1 : (-bq + Math.sqrt(disc)) / (2 * a.C);
    }, 4);
    labels.sort(function (p, q) { return q.prio - p.prio; });
    var placed = [];
    g.font = '12px ' + FONT;
    g.fillStyle = C.text2;
    g.textBaseline = 'middle';
    labels.forEach(function (lb) {
      var clash = placed.some(function (p) { return Math.abs(p.y - lb.y) < 13 && Math.abs(p.x - lb.x) < 40; });
      if (clash) return;
      placed.push(lb);
      g.textAlign = lb.align;
      haloText(g, lb.text, lb.x, lb.y, C.surface);
    });

    // Optimum marker.
    var opt = d.opt;
    if (opt.u !== null) {
      var ox = X(opt.u), oy = Y(opt.H);
      if (oy >= top && oy <= bot) {
        g.beginPath();
        g.arc(ox, oy, 5, 0, Math.PI * 2);
        g.fillStyle = C.surface;
        g.fill();
        g.strokeStyle = C.text;
        g.lineWidth = 2;
        g.stroke();
        g.fillStyle = C.text2;
        g.textAlign = 'center';
        g.textBaseline = 'top';
        haloText(g, opt.interior ? 'u_opt' : 'best in range', ox, oy + 9, C.surface);
      }
    }

    // Current operating point (an arrow at the top edge if H is off the scale).
    var cx = X(d.u), cy = Y(hNow), off = cy < top;
    if (off) cy = top + 8;
    g.strokeStyle = C.text2;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.round(cx) + 0.5, Math.min(bot, cy + 7));
    g.lineTo(Math.round(cx) + 0.5, bot);
    g.stroke();
    g.fillStyle = C.surface;
    g.beginPath();
    g.arc(cx, cy, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = C.text;
    g.beginPath();
    if (off) {
      g.moveTo(cx, cy - 6);
      g.lineTo(cx + 5.5, cy + 4);
      g.lineTo(cx - 5.5, cy + 4);
      g.closePath();
    } else {
      g.arc(cx, cy, 5, 0, Math.PI * 2);
    }
    g.fill();
    var tx = 'H = ' + fmt(hNow * 1e6, 1) + ' µm' + (off ? ' (off scale)' : '');
    g.font = '600 12px ' + FONT;
    var tw = g.measureText(tx).width;
    var lx = cx + 12, align = 'left';
    if (lx + tw > right - 4) { lx = cx - 12; align = 'right'; }
    g.textAlign = align;
    g.textBaseline = off ? 'middle' : 'bottom';
    haloText(g, tx, lx, off ? cy : cy - 6, C.surface);
  };

  root.BandPlot = BandPlot;
  root.VanDeemterPlot = VanDeemterPlot;
  root.vdFormat = fmt;
})(window);
