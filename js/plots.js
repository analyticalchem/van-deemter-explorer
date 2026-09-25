/*
 * Two plots:
 *   BandPlot         — analyte distribution along the column (histogram of the
 *                      simulated molecules + the Gaussian predicted by σ² = H·x),
 *                      drawn on the same x-axis as the column animation. One
 *                      band per visible analyte.
 *   VanDeemterPlot   — H versus linear velocity u with the A, B/u and C·u terms.
 *                      Analyte 1 is drawn solid, analyte 2 dashed.
 */
(function (root) {
  'use strict';

  var FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  var SQRT2PI = Math.sqrt(2 * Math.PI);
  var DASH = [7, 5];
  var SUB = ['₁', '₂'];

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

  /** species: [{ sim, color }] with color the analyte's CSS custom property. */
  function BandPlot(canvas, species, L) {
    this.canvas = canvas;
    this.species = species.map(function (s) {
      return { sim: s.sim, colorVar: s.color, visible: true, counts: null };
    });
    this.L = L;
    this.padL = 56;
    this.padR = 56;
    this.yMax = 0;
    this.mag = 1;
    this.showGhost = true;
    this.refreshTheme();
  }

  BandPlot.prototype.setVisible = function (index, visible) {
    this.species[index].visible = visible;
  };

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
    var nb = this.nb;
    this.species.forEach(function (sp) { sp.counts = new Uint16Array(nb); });
  };

  BandPlot.prototype.refreshTheme = function () {
    this.colors = readChrome();
    this.species.forEach(function (sp) { sp.color = cssVar(sp.colorVar); });
  };

  BandPlot.prototype.draw = function () {
    if (!this.g) return;
    var g = this.g, C = this.colors, L = this.L, self = this;
    var x0 = this.x0, x1 = this.x1, top = this.top, bot = this.bottom;
    var nb = this.nb, binW = L / nb, i;
    var shown = this.species.filter(function (sp) { return sp.visible; });

    // Histograms and predicted band parameters for each visible analyte.
    var yMax = 1;
    shown.forEach(function (sp) {
      var sim = sp.sim, counts = sp.counts;
      counts.fill(0);
      for (var j = 0; j < sim.n; j++) {
        var b = Math.floor(sim.x[j] / binW);
        if (b >= 0 && b < nb) counts[b]++;
      }
      sp.mu = sim.center;
      sp.sd = Math.sqrt(sim.variance);
      sp.sdG = Math.sqrt(sim.varGhost);
      sp.amp = sim.n * binW / SQRT2PI;
      yMax = Math.max(yMax, sp.amp / sp.sd, self.showGhost ? sp.amp / sp.sdG : 0);
    });

    // The y-scale follows the tallest predicted peak, so the width comparison
    // stays readable as the bands spread out. It is set from the smooth
    // prediction (not the noisy histogram), so it needs no easing and does not
    // shift when the animation pauses. Headroom leaves space for histogram noise.
    this.yMax = 1.25 * yMax;
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

    // Histograms of simulated molecules.
    var bw = (x1 - x0) / nb, gap = bw > 6 ? 2 : 1;
    shown.forEach(function (sp) {
      g.fillStyle = withAlpha(sp.color, 0.28);
      for (i = 0; i < nb; i++) {
        if (!sp.counts[i]) continue;
        var h = Math.min(sp.counts[i] * ky, bot - top + 12);
        g.fillRect(x0 + i * bw + gap / 2, bot - h, bw - gap, h);
      }
    });

    // Predicted Gaussians: σ² = σ0² + H·x.
    function curve(sp, s) {
      g.beginPath();
      for (var px = x0; px <= x1; px += 1.5) {
        var xm = (px - x0) / kx, z = (xm - sp.mu) / s;
        var y = bot - Math.min(sp.amp / s * Math.exp(-0.5 * z * z) * ky, bot + 20);
        if (px === x0) g.moveTo(px, y); else g.lineTo(px, y);
      }
    }

    if (this.showGhost) {
      g.strokeStyle = C.text2;
      g.lineWidth = 1.5;
      g.setLineDash([5, 4]);
      shown.forEach(function (sp) {
        if (!(sp.sdG > 0) || Math.abs(sp.sdG - sp.sd) / sp.sd <= 0.01) return;
        curve(sp, sp.sdG);
        g.stroke();
      });
      g.setLineDash([]);
    }

    shown.forEach(function (sp) {
      curve(sp, sp.sd);
      g.lineTo(x1, bot);
      g.lineTo(x0, bot);
      g.closePath();
      g.fillStyle = withAlpha(sp.color, 0.1);
      g.fill();
      curve(sp, sp.sd);
      g.strokeStyle = sp.color;
      g.lineWidth = 2;
      g.lineJoin = 'round';
      g.stroke();
    });
    g.restore();

    // Peak-width bracket on each band: 4σ, spanning μ ± 2σ at the height where
    // the Gaussian is e⁻² (13.5%) of its peak, labelled with the real-column value.
    var placed = [];
    g.font = '12px ' + FONT;
    shown.forEach(function (sp) {
      var mu = sp.mu, sd = sp.sd, amp = sp.amp;
      var peakY = bot - Math.min(amp / sd * ky, bot - top);
      var yb = bot - Math.min(amp / sd * Math.exp(-2) * ky, bot - top - 4);
      var xl = x0 + (mu - 2 * sd) * kx, xr = x0 + (mu + 2 * sd) * kx;
      if (!(xr > x0 && xl < x1)) return;
      g.strokeStyle = C.text;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(xl, yb - 4); g.lineTo(xl, yb + 4);
      g.moveTo(xl, yb); g.lineTo(xr, yb);
      g.moveTo(xr, yb - 4); g.lineTo(xr, yb + 4);
      g.stroke();
      var label = '4σ = ' + fmt(4 * sd / self.mag * 1000, 2) + ' mm';
      var tw = g.measureText(label).width;
      var lx = Math.max(x0 + tw / 2, Math.min(x1 - tw / 2, (xl + xr) / 2));
      var ly = Math.max(top + 12, peakY - 4);
      // Lift a label that would sit on top of the other band's label.
      placed.forEach(function (p) {
        if (Math.abs(p.x - lx) < (p.w + tw) / 2 + 6 && Math.abs(p.y - ly) < 15) ly = Math.max(top + 12, p.y - 15);
      });
      placed.push({ x: lx, y: ly, w: tw });
      g.fillStyle = C.text;
      g.textBaseline = 'bottom';
      g.textAlign = 'center';
      haloText(g, label, lx, ly, C.surface);
    });
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

  /**
   * d = { terms, u, autoY, analytes: [{ co, opt }] } — one entry per analyte
   * shown; the first is drawn solid, the second dashed.
   */
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
    this.m = { l: 50, r: narrow ? 36 : 46, t: 34, b: 42 };
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
    var VD = root.VD, d = this.data, C = this.colors, terms = d.terms;
    var two = d.analytes.length > 1;
    var hps = d.analytes.map(function (a) { return VD.plateHeight(u, a.co, terms); });
    var tip = this.tooltip;
    tip.textContent = '';
    function row(value, name, color, dashed) {
      var r = document.createElement('div');
      r.className = 'tip-row';
      if (color) {
        var key = document.createElement('span');
        key.className = dashed ? 'tip-key dashed' : 'tip-key';
        key.style.setProperty('--key', color);
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
    function um(h) { return fmt(h * 1e6, 2) + ' µm'; }
    var head = document.createElement('div');
    head.className = 'tip-head';
    head.textContent = 'u = ' + fmt(u * 1000, 2) + ' mm/s · ' + fmt(VD.flowFromVelocity(u), 2) + ' mL/min';
    tip.appendChild(head);
    hps.forEach(function (hp, i) {
      row(um(hp.H), two ? 'H' + SUB[i] + ' (analyte ' + (i + 1) + ')' : 'H (total)', C.text, i === 1);
    });
    if (terms.A) row(um(hps[0].A), 'A', C.A);
    if (terms.B) row(um(hps[0].B), 'B/u', C.B);
    if (terms.C) {
      hps.forEach(function (hp, i) { row(um(hp.C), two ? 'C·u' + SUB[i] : 'C·u', C.C, i === 1); });
    }
    row(fmt(VD.pressure(u, d.analytes[0].co) / 1e5, 0) + ' bar', 'back-pressure', null);
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
    var terms = d.terms, analytes = d.analytes, two = analytes.length > 1;
    var co0 = analytes[0].co;
    var hNow = analytes.map(function (a) { return VD.plateHeight(d.u, a.co, terms).H; });
    this.hMax = d.autoY
      ? (function () {
          var want = 1e-6;
          analytes.forEach(function (a, i) { want = Math.max(want, 2.5 * a.opt.H, 1.25 * hNow[i]); });
          var st = niceStep(want, 5);
          return Math.ceil(want / st) * st;
        })()
      : FIXED_HMAX;
    var self = this;
    function X(u) { return self.uToX(u); }
    function Y(h) { return self.hToY(h); }
    function sub(i) { return two ? SUB[i] : ''; }

    g.font = '11px ' + FONT;

    // Pressure limits as status washes behind the data.
    var u400 = P.HPLC_LIMIT * co0.dp * co0.dp / (P.phi * co0.eta * P.L);
    var u1300 = P.UHPLC_LIMIT * co0.dp * co0.dp / (P.phi * co0.eta * P.L);
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
    function plot(fn, color, width, dashed) {
      g.beginPath();
      for (var s = 0; s <= N; s++) {
        var u = uStart + (self.uMax - uStart) * s / N;
        var y = Y(Math.min(fn(u), self.hMax * 3));
        if (s === 0) g.moveTo(X(u), y); else g.lineTo(X(u), y);
      }
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineJoin = 'round';
      g.lineCap = dashed ? 'butt' : 'round';
      g.setLineDash(dashed ? DASH : []);
      g.stroke();
      g.setLineDash([]);
    }
    // A and B/u are the same for both analytes (same particles, same Dm).
    if (terms.A) plot(function () { return co0.A; }, C.A, 2);
    if (terms.B) plot(function (u) { return co0.B / u; }, C.B, 2);
    analytes.forEach(function (a, i) {
      if (terms.C) plot(function (u) { return a.co.C * u; }, C.C, 2, i === 1);
    });
    analytes.forEach(function (a, i) {
      plot(function (u) { return VD.plateHeight(u, a.co, terms).H; }, C.text, 2.5, i === 1);
    });

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
        labels.push({ text: name, x: right + 6, y: Y(hEnd), align: 'left', prio: prio });
      } else if (inv) {
        var ux = inv(self.hMax);
        if (ux > 0 && ux < self.uMax) labels.push({ text: name, x: X(ux) - 6, y: top + 10, align: 'right', prio: prio });
      }
    }
    if (terms.A) endLabel('A', function () { return co0.A; }, null, 1);
    if (terms.B) endLabel('B/u', function (u) { return co0.B / u; }, null, 2);
    analytes.forEach(function (a, i) {
      var co = a.co;
      if (terms.C) endLabel('C·u' + sub(i), function (u) { return co.C * u; }, function (h) { return h / co.C; }, 3 - i * 0.5);
      endLabel('H' + sub(i), function (u) { return VD.plateHeight(u, co, terms).H; }, function (h) {
        var c = VD.activeCoefficients(co, terms);
        if (!c.C) return -1;
        var bq = c.A - h, disc = bq * bq - 4 * c.C * c.B;
        return disc < 0 ? -1 : (-bq + Math.sqrt(disc)) / (2 * c.C);
      }, 5 - i * 0.5);
    });
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

    // Optimum markers.
    var optLabels = [];
    analytes.forEach(function (a, i) {
      var opt = a.opt;
      if (opt.u === null) return;
      var ox = X(opt.u), oy = Y(opt.H);
      if (oy < top || oy > bot) return;
      g.beginPath();
      g.arc(ox, oy, 5, 0, Math.PI * 2);
      g.fillStyle = C.surface;
      g.fill();
      g.strokeStyle = C.text;
      g.lineWidth = 2;
      g.stroke();
      var text = opt.interior ? 'u_opt' + sub(i) : 'best in range' + sub(i);
      // Put the second label above its marker if it would collide with the first.
      var above = optLabels.some(function (p) { return Math.abs(p.x - ox) < 48 && Math.abs(p.y - oy) < 24; });
      optLabels.push({ x: ox, y: oy });
      g.fillStyle = C.text2;
      g.textAlign = 'center';
      g.textBaseline = above ? 'bottom' : 'top';
      haloText(g, text, ox, above ? oy - 9 : oy + 9, C.surface);
    });

    // Current operating point on each curve (an arrow at the top edge if off the scale).
    var cx = X(d.u);
    var pts = hNow.map(function (h, i) {
      var cy = Y(h), off = cy < top;
      return { i: i, h: h, cy: off ? top + 8 + i * 14 : cy, off: off };
    });
    var lowest = Math.max.apply(null, pts.map(function (p) { return p.cy; }));
    g.strokeStyle = C.text2;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.round(cx) + 0.5, Math.min(bot, lowest + 7));
    g.lineTo(Math.round(cx) + 0.5, bot);
    g.stroke();
    var higher = two ? (pts[0].cy <= pts[1].cy ? 0 : 1) : 0;
    pts.forEach(function (p) {
      g.fillStyle = C.surface;
      g.beginPath();
      g.arc(cx, p.cy, 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = C.text;
      g.beginPath();
      if (p.off) {
        g.moveTo(cx, p.cy - 6);
        g.lineTo(cx + 5.5, p.cy + 4);
        g.lineTo(cx - 5.5, p.cy + 4);
        g.closePath();
      } else if (p.i === 1) {
        // Analyte 2: a diamond, matching its dashed curve's secondary role.
        g.moveTo(cx, p.cy - 6);
        g.lineTo(cx + 6, p.cy);
        g.lineTo(cx, p.cy + 6);
        g.lineTo(cx - 6, p.cy);
        g.closePath();
      } else {
        g.arc(cx, p.cy, 5, 0, Math.PI * 2);
      }
      g.fill();
    });
    g.font = '600 12px ' + FONT;
    pts.forEach(function (p) {
      var tx = 'H' + sub(p.i) + ' = ' + fmt(p.h * 1e6, 1) + ' µm' + (p.off ? ' (off scale)' : '');
      var tw = g.measureText(tx).width;
      var lx = cx + 12, align = 'left';
      if (lx + tw > right - 4) { lx = cx - 12; align = 'right'; }
      g.textAlign = align;
      g.fillStyle = C.text;
      var ly, base;
      if (p.off) { ly = p.cy; base = 'middle'; }
      else if (!two || p.i === higher) { ly = p.cy - 6; base = 'bottom'; }
      else { ly = p.cy + 6; base = 'top'; }
      g.textBaseline = base;
      haloText(g, tx, lx, ly, C.surface);
    });
  };

  root.BandPlot = BandPlot;
  root.VanDeemterPlot = VanDeemterPlot;
  root.vdFormat = fmt;
})(window);
