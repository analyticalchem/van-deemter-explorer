/*
 * Column animation: a side view of a packed bed with a liquid stationary-phase
 * film on each support particle. Axial positions come from the simulations
 * (one VDSim per analyte) unchanged; the vertical path of each molecule is
 * illustrative — it follows the flow around the packing and moves onto a
 * particle's film when the simulation puts the molecule in the stationary phase.
 */
(function (root) {
  'use strict';

  var gauss = root.VDSim.gauss;

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /** Per-analyte drawing state: one entry per simulated molecule. */
  function Track(sim, colorVar) {
    var n = sim.n;
    this.sim = sim;
    this.colorVar = colorVar;
    this.visible = true;
    this.yF = new Float32Array(n);     // flow-following vertical position
    this.yR = new Float32Array(n);     // drawn vertical position
    this.offX = new Float32Array(n);   // drawn offset from the simulated axial position
    this.prevX = new Float32Array(n);
    this.prevState = new Uint8Array(n);
    this.seqSeen = new Uint32Array(n);
    this.stopX = new Float32Array(n);  // film contact point, as an offset from the axial position
    this.stopY = new Float32Array(n);
    this.stopCx = new Float32Array(n);
    this.stopCy = new Float32Array(n);
    this.antSeq = new Uint32Array(n);
    this.antX = new Float32Array(n);
    this.antY = new Float32Array(n);
    this.sprite = document.createElement('canvas');
  }

  /**
   * species: [{ sim, color }] where color is the CSS custom-property prefix of
   * that analyte (e.g. '--analyte'; '-hi' and '-lo' variants shade the sphere).
   */
  function ColumnView(canvas, species, L) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tracks = species.map(function (s) { return new Track(s.sim, s.color); });
    this.L = L;
    this.padL = 56;
    this.padR = 56;
    this.dpUm = 5;
    this.uPx = 0;             // mobile-phase speed on screen (px/s)
    this.tracers = [];
    this.staticLayer = document.createElement('canvas');
    this.readColors();
  }

  ColumnView.prototype.readColors = function () {
    this.colors = {
      mobile: cssVar('--mobile-bg'),
      streak: cssVar('--streak'),
      particle: cssVar('--particle'),
      particleHi: cssVar('--particle-hi'),
      film: cssVar('--film'),
      filmEdge: cssVar('--film-edge'),
      wall: cssVar('--wall'),
      frit: cssVar('--frit'),
      text: cssVar('--text-secondary'),
      font: parseFloat(cssVar('--chart-font')) || 12
    };
  };

  ColumnView.prototype.setVisible = function (index, visible) {
    this.tracks[index].visible = visible;
  };

  ColumnView.prototype.setLayout = function (padL, padR) {
    this.padL = padL;
    this.padR = padR;
  };

  ColumnView.prototype.resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    if (!W || !H) return;
    this.dpr = dpr;
    this.W = W;
    this.H = H;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.x0 = this.padL;
    this.x1 = W - this.padR;
    this.y0 = Math.round(this.colors.font + 10);   // room for the end labels
    this.y1 = H - 10;
    this.build();
  };

  ColumnView.prototype.setParticleSize = function (dpUm) {
    if (dpUm === this.dpUm && this.r) return;
    this.dpUm = dpUm;
    if (this.W) this.build();
  };

  /** Lay out the packing lattice for the current size and particle diameter. */
  ColumnView.prototype.build = function () {
    var tubeH = this.y1 - this.y0;
    var r = tubeH * (0.02 + 0.0075 * this.dpUm);
    this.r = r;
    this.film = Math.max(1.5, 0.22 * r);
    // Analyte size follows the drawing size only, never the packing particle size.
    this.rm = Math.max(2.6, Math.min(3.6, 0.016 * tubeH));
    this.Rout = r + this.film;            // mobile molecules stay outside the film
    this.Rc = r + this.film * 0.5;        // retained molecules sit inside the film
    // Deliberately open packing: spacing 4r along the column, √5·r between rows,
    // so every axial position has a particle surface in reach of each channel.
    this.sx = 4 * r;
    this.sy = Math.sqrt(5) * r;
    this.nRows = Math.ceil(tubeH / this.sy) + 1;
    this.rowY0 = this.y0 + (tubeH - (this.nRows - 1) * this.sy) / 2;
    this.buildStatic();
    this.buildSprites();
    this.seedTracers();
    for (var t = 0; t < this.tracks.length; t++) this.reproject(this.tracks[t]);
  };

  ColumnView.prototype.rowOffset = function (j) {
    return (j & 1) ? this.sx * 0.5 : 0;
  };

  /**
   * Nearest point inside the stationary film of the closest particle to (x, y).
   * Returns false if none is found; otherwise sets this._sx/_sy (the point) and
   * this._cx/_cy (that particle's centre).
   */
  ColumnView.prototype.nearestSurface = function (x, y) {
    var sx = this.sx, sy = this.sy, Rc = this.Rc;
    var lo = this.y0 + this.rm, hi = this.y1 - this.rm;
    var jc = Math.floor((y - this.rowY0) / sy);
    var bestD = Infinity, found = false;
    for (var j = jc - 1; j <= jc + 2; j++) {
      if (j < 0 || j >= this.nRows) continue;
      var cy = this.rowY0 + j * sy, off = this.rowOffset(j);
      var i = Math.round((x - this.x0 - sx * 0.5 - off) / sx);
      for (var di = -1; di <= 1; di++) {
        var cx = this.x0 + sx * 0.5 + off + (i + di) * sx;
        var dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy);
        if (d >= bestD) continue;
        if (d < 1e-6) { dx = 0; dy = -1; d = 1; }
        var px = cx + dx / d * Rc, py = cy + dy / d * Rc;
        if (py < lo || py > hi || px < this.x0 || px > this.x1) continue;
        bestD = d;
        found = true;
        this._sx = px; this._sy = py; this._cx = cx; this._cy = cy;
      }
    }
    return found;
  };

  /** dy/dx of potential flow around the nearby particles (superposed). */
  ColumnView.prototype.flowSlope = function (x, y) {
    var sx = this.sx, sy = this.sy, R2 = this.Rout * this.Rout;
    var cut2 = 10 * R2, su = 1, sv = 0;
    var jc = Math.floor((y - this.rowY0) / sy);
    for (var j = jc - 1; j <= jc + 2; j++) {
      if (j < 0 || j >= this.nRows) continue;
      var cy = this.rowY0 + j * sy, off = this.rowOffset(j);
      var i = Math.round((x - this.x0 - sx * 0.5 - off) / sx);
      for (var di = -1; di <= 1; di++) {
        var cx = this.x0 + sx * 0.5 + off + (i + di) * sx;
        var dx = x - cx, dy = y - cy, rho2 = dx * dx + dy * dy;
        if (rho2 > cut2 || rho2 < R2 * 0.5) continue;
        var inv = R2 / (rho2 * rho2);
        su -= inv * (dx * dx - dy * dy);
        sv -= 2 * inv * dx * dy;
      }
    }
    if (su < 0.2) su = 0.2;
    var s = sv / su;
    return s > 2.5 ? 2.5 : (s < -2.5 ? -2.5 : s);
  };

  /** Move y vertically out of any particle disc of radius R at axial position x. */
  ColumnView.prototype.pushOut = function (x, y, R) {
    var sx = this.sx, sy = this.sy;
    for (var pass = 0; pass < 2; pass++) {
      var jc = Math.floor((y - this.rowY0) / sy);
      for (var j = jc - 1; j <= jc + 2; j++) {
        if (j < 0 || j >= this.nRows) continue;
        var cy = this.rowY0 + j * sy, off = this.rowOffset(j);
        var i = Math.round((x - this.x0 - sx * 0.5 - off) / sx);
        for (var di = -1; di <= 1; di++) {
          var cx = this.x0 + sx * 0.5 + off + (i + di) * sx, dx = x - cx;
          if (dx >= R || dx <= -R) continue;
          var h = Math.sqrt(R * R - dx * dx), dy = y - cy;
          if (dy > -h && dy < h) y = dy < 0 ? cy - h : cy + h;
        }
      }
    }
    var lo = this.y0 + this.rm, hi = this.y1 - this.rm;
    return y < lo ? lo : (y > hi ? hi : y);
  };

  ColumnView.prototype.randomFreeY = function (x) {
    var lo = this.y0 + this.rm, hi = this.y1 - this.rm;
    return this.pushOut(x, lo + Math.random() * (hi - lo), this.Rout);
  };

  ColumnView.prototype.pxPerM = function () {
    return (this.x1 - this.x0) / this.L;
  };

  /** Record where molecule i of track tk (drawn near xp, y) sits in the film. */
  ColumnView.prototype.setStop = function (tk, i, xp, y) {
    if (this.nearestSurface(xp + tk.offX[i], y)) {
      tk.stopX[i] = this._sx - xp;
      tk.stopY[i] = this._sy;
      tk.stopCx[i] = this._cx;
      tk.stopCy[i] = this._cy;
    } else {
      tk.stopX[i] = tk.offX[i];
      tk.stopY[i] = y;
      tk.stopCx[i] = xp;
      tk.stopCy[i] = y;
    }
  };

  /** Place every molecule afresh (after an injection). */
  ColumnView.prototype.onInject = function () {
    if (!this.W) return;
    var k = this.pxPerM();
    for (var t = 0; t < this.tracks.length; t++) {
      var tk = this.tracks[t], sim = tk.sim;
      for (var i = 0; i < sim.n; i++) {
        var xp = this.x0 + sim.x[i] * k;
        var y = this.randomFreeY(xp);
        tk.yF[i] = y;
        tk.yR[i] = y;
        tk.offX[i] = 0;
        tk.prevX[i] = xp;
        if (sim.state[i] === 1) {
          this.setStop(tk, i, xp, y);
          tk.yR[i] = tk.stopY[i];
          tk.offX[i] = tk.stopX[i];
        }
        tk.prevState[i] = sim.state[i];
        tk.seqSeen[i] = sim.seq[i];
        tk.antSeq[i] = sim.seq[i] - 1;
      }
    }
  };

  /** Keep molecules consistent with a rebuilt lattice (resize or new particle size). */
  ColumnView.prototype.reproject = function (tk) {
    var sim = tk.sim, k = this.pxPerM();
    for (var i = 0; i < sim.n; i++) {
      var xp = this.x0 + sim.x[i] * k;
      tk.prevX[i] = xp;
      tk.yF[i] = this.pushOut(xp, tk.yF[i] || this.randomFreeY(xp), this.Rout);
      tk.yR[i] = tk.yF[i];
      tk.offX[i] = 0;
      tk.prevState[i] = 255;   // forces the stationary position to be recomputed
      tk.antSeq[i] = sim.seq[i] - 1;
    }
  };

  ColumnView.prototype.seedTracers = function () {
    var count = Math.round((this.x1 - this.x0) * (this.y1 - this.y0) / 700);
    this.tracers = [];
    for (var i = 0; i < count; i++) {
      var x = this.x0 + Math.random() * (this.x1 - this.x0);
      this.tracers.push({ x: x, y: this.randomFreeY(x), s: 0 });
    }
  };

  /**
   * dt: display seconds since the last frame; timeScale: column seconds per
   * display second.
   */
  ColumnView.prototype.update = function (dt, timeScale) {
    if (!this.W) return;
    var kx = this.pxPerM(), r = this.r, Rout = this.Rout;
    this.uPx = this.tracks[0].sim.p.u * kx * timeScale;

    // Mobile-phase streaks.
    var dxT = this.uPx * dt;
    var tSteps = Math.max(1, Math.min(12, Math.ceil(dxT / (0.4 * r))));
    for (var t = 0; t < this.tracers.length; t++) {
      var tr = this.tracers[t];
      for (var s = 0; s < tSteps; s++) {
        var sl = this.flowSlope(tr.x, tr.y);
        tr.x += dxT / tSteps;
        tr.y = this.pushOut(tr.x, tr.y + sl * dxT / tSteps, Rout);
      }
      tr.s = this.flowSlope(tr.x, tr.y);
      if (tr.x > this.x1) {
        tr.x = this.x0 + (tr.x - this.x1) % (this.x1 - this.x0);
        tr.y = this.randomFreeY(tr.x);
      }
    }

    for (var n = 0; n < this.tracks.length; n++) {
      if (this.tracks[n].visible) this.updateTrack(this.tracks[n], dt, timeScale, kx);
    }
  };

  ColumnView.prototype.updateTrack = function (tk, dt, timeScale, kx) {
    var sim = tk.sim, q = sim.p, n = sim.n, r = this.r, Rout = this.Rout;
    var antWindow = 0.14 * timeScale;
    var alpha = dt > 0 ? 1 - Math.exp(-dt / 0.045) : 0;
    var noiseSd = 7 * Math.sqrt(dt);
    var anticipate = q.kinetic && !sim.fastStep;
    for (var i = 0; i < n; i++) {
      var xp = this.x0 + sim.x[i] * kx;
      var st = sim.state[i], seq = sim.seq[i], target, targetOff = 0;
      if (st === 1) {
        if (tk.prevState[i] !== 1 || tk.seqSeen[i] !== seq) this.setStop(tk, i, xp, tk.yR[i]);
        target = tk.stopY[i];
        targetOff = tk.stopX[i];
      } else {
        if (tk.prevState[i] === 1) {
          // Leaving the film: step back out into the channel, away from the particle.
          var ox = xp + tk.stopX[i] - tk.stopCx[i], oy = tk.stopY[i] - tk.stopCy[i];
          var od = Math.sqrt(ox * ox + oy * oy) || 1;
          tk.yF[i] = tk.stopY[i] + oy / od * (this.film * 0.5 + 1);
        }
        var xPrev = tk.prevX[i], dx = xp - xPrev, y = tk.yF[i];
        var steps = Math.max(1, Math.min(12, Math.ceil(Math.abs(dx) / (0.4 * r))));
        for (var k = 0; k < steps; k++) {
          var xs = xPrev + dx * (k + 0.5) / steps;
          y += this.flowSlope(xs, y) * dx / steps;
          y = this.pushOut(xPrev + dx * (k + 1) / steps, y, Rout);
        }
        y = this.pushOut(xp, y + noiseSd * gauss(), Rout);
        tk.yF[i] = y;
        target = y;
        if (anticipate && st === 0) {
          // Near the end of a hop, drift onto the particle where it will stop.
          var rem = sim.t0[i] + sim.dur[i] - sim.t;
          var win = Math.min(0.45 * sim.dur[i], antWindow);
          if (rem < win) {
            if (tk.antSeq[i] !== seq) {
              var xbPx = this.x0 + sim.xb[i] * kx;
              if (this.nearestSurface(xbPx, y)) {
                tk.antX[i] = this._sx - xbPx;
                tk.antY[i] = this._sy;
              } else {
                tk.antX[i] = 0;
                tk.antY[i] = y;
              }
              tk.antSeq[i] = seq;
            }
            var f = 1 - rem / win;
            f = f * f * (3 - 2 * f);
            target = y + (tk.antY[i] - y) * f;
            targetOff = tk.antX[i] * f;
          }
        }
      }
      tk.offX[i] += (targetOff - tk.offX[i]) * alpha;
      var yr = tk.yR[i] + (target - tk.yR[i]) * alpha;
      tk.yR[i] = this.pushOut(xp + tk.offX[i], yr, r);
      tk.prevX[i] = xp;
      tk.prevState[i] = st;
      tk.seqSeen[i] = seq;
    }
  };

  ColumnView.prototype.buildStatic = function () {
    var c = this.staticLayer, dpr = this.dpr;
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    var C = this.colors, x0 = this.x0, x1 = this.x1, y0 = this.y0, y1 = this.y1;
    var mid = (y0 + y1) / 2, fritW = 6;

    // Inlet and outlet tubing.
    g.strokeStyle = C.wall;
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(8, mid); g.lineTo(x0 - fritW, mid);
    g.moveTo(x1 + fritW, mid); g.lineTo(this.W - 8, mid);
    g.stroke();

    // Mobile phase.
    g.fillStyle = C.mobile;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);

    // Packing: support particle with a stationary liquid film. A thin amber
    // --film-edge outline gives each particle a boundary at 3:1 or better
    // against the mobile phase without competing with the molecules.
    g.save();
    g.beginPath();
    g.rect(x0, y0, x1 - x0, y1 - y0);
    g.clip();
    var r = this.r, Rf = r + this.film, sx = this.sx;
    g.strokeStyle = C.filmEdge;
    g.lineWidth = 1;
    for (var j = 0; j < this.nRows; j++) {
      var cy = this.rowY0 + j * this.sy, off = this.rowOffset(j);
      for (var cx = x0 + sx * 0.5 + off - sx; cx < x1 + sx; cx += sx) {
        g.fillStyle = C.film;
        g.beginPath();
        g.arc(cx, cy, Rf, 0, Math.PI * 2);
        g.fill();
        var grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
        grad.addColorStop(0, C.particleHi);
        grad.addColorStop(1, C.particle);
        g.fillStyle = grad;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.arc(cx, cy, Rf - 0.5, 0, Math.PI * 2);
        g.stroke();
      }
    }
    g.restore();

    // Frits and column wall.
    g.fillStyle = C.frit;
    g.fillRect(x0 - fritW, y0, fritW, y1 - y0);
    g.fillRect(x1, y0, fritW, y1 - y0);
    g.strokeStyle = C.wall;
    g.lineWidth = 1.5;
    g.strokeRect(x0 - fritW, y0, x1 - x0 + 2 * fritW, y1 - y0);

    // End labels.
    g.fillStyle = C.text;
    g.font = C.font + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.textBaseline = 'bottom';
    g.textAlign = 'left';
    g.fillText('Inlet', 4, y0 - 6);
    g.textAlign = 'right';
    g.fillText('To detector', this.W - 4, y0 - 6);
  };

  /** Pre-render one shaded sphere per analyte. */
  ColumnView.prototype.buildSprites = function () {
    var rm = this.rm, dpr = this.dpr, size = Math.ceil((rm + 1) * 2 * dpr);
    var m = size / 2, R = rm * dpr;
    for (var t = 0; t < this.tracks.length; t++) {
      var tk = this.tracks[t], c = tk.sprite;
      c.width = size;
      c.height = size;
      var g = c.getContext('2d');
      var grad = g.createRadialGradient(m - R * 0.38, m - R * 0.38, R * 0.08, m, m, R);
      grad.addColorStop(0, cssVar(tk.colorVar + '-hi'));
      grad.addColorStop(0.55, cssVar(tk.colorVar));
      grad.addColorStop(1, cssVar(tk.colorVar + '-lo'));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(m, m, R, 0, Math.PI * 2);
      g.fill();
    }
    this.spriteSize = size / dpr;
  };

  /** Re-read colours and sizes, then rebuild (the label font sets the tube's top). */
  ColumnView.prototype.refreshTheme = function () {
    this.readColors();
    if (this.W) this.resize();
  };

  ColumnView.prototype.draw = function () {
    if (!this.W) return;
    var g = this.ctx, dpr = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.staticLayer, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    g.save();
    g.beginPath();
    g.rect(this.x0, this.y0, this.x1 - this.x0, this.y1 - this.y0);
    g.clip();

    // Streaks show how fast the mobile phase itself moves.
    var len = Math.min(12, 3 + this.uPx * 0.03);
    g.strokeStyle = this.colors.streak;
    g.lineWidth = 1.2;
    g.lineCap = 'round';
    g.beginPath();
    for (var t = 0; t < this.tracers.length; t++) {
      var tr = this.tracers[t];
      var norm = 1 / Math.sqrt(1 + tr.s * tr.s);
      g.moveTo(tr.x - len * norm, tr.y - len * tr.s * norm);
      g.lineTo(tr.x, tr.y);
    }
    g.stroke();

    var kx = this.pxPerM(), sz = this.spriteSize, half = sz / 2;
    var xMax = this.x1 + half;
    for (var n = 0; n < this.tracks.length; n++) {
      var tk = this.tracks[n], sim = tk.sim;
      if (!tk.visible) continue;
      for (var i = 0; i < sim.n; i++) {
        var xp = this.x0 + sim.x[i] * kx + tk.offX[i];
        if (xp > xMax) continue;
        g.drawImage(tk.sprite, xp - half, tk.yR[i] - half, sz, sz);
      }
    }
    g.restore();
  };

  root.ColumnView = ColumnView;
})(window);
