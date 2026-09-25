/*
 * Stochastic molecule engine (no DOM).
 *
 * Each analyte molecule alternates between the mobile phase (moving at the
 * linear velocity u) and the stationary liquid film on the packing (not
 * moving). This is the Giddings–Eyring two-state picture of partition
 * chromatography. The sojourn times are calibrated so the ensemble reproduces
 * the van Deemter model exactly:
 *
 *   mean band velocity   V = u / (1 + k)                 (retention)
 *   C·u term             from the random mobile/stationary sojourn times
 *   A and B/u terms      Gaussian noise added to each mobile-phase hop,
 *                        variance (A·u + B) per second spent in the mobile phase
 *
 * For an alternating renewal process the kinetic plate height is
 *   H_kin = u·k·τs·(cvM² + cvS²) / (1 + k)²
 * so τs is chosen from the C term and the chosen sojourn regularity.
 * Positions are in metres along the column, times in seconds of column time.
 */
(function (root) {
  'use strict';

  // Sum of squared coefficients of variation of the two sojourn-time
  // distributions (2 would be exponential). Lower = fewer, longer, more regular
  // visits to the stationary phase for the same band broadening, which keeps
  // individual retention events visible on screen.
  var REGULARITY = 0.1;
  var MOBILE_SHARE = 0.6;  // share of REGULARITY carried by mobile-phase sojourns
  var MIN_HOPS = 12;       // keep at least this many phase visits per column pass
  var FAST_CYCLES = 20;    // above this many cycles per step, use the diffusion limit

  var spare = null;
  function gauss() {
    if (spare !== null) { var s = spare; spare = null; return s; }
    var u, v, r;
    do {
      u = Math.random() * 2 - 1;
      v = Math.random() * 2 - 1;
      r = u * u + v * v;
    } while (r === 0 || r >= 1);
    var f = Math.sqrt(-2 * Math.log(r) / r);
    spare = v * f;
    return u * f;
  }

  // Marsaglia–Tsang gamma sampler, unit scale.
  function gammaSample(a) {
    if (a < 1) return gammaSample(a + 1) * Math.pow(Math.random(), 1 / a);
    var d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      var x, v;
      do { x = gauss(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      var w = Math.random();
      if (w < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(w) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  function Sim(n) {
    this.n = n;
    this.x = new Float64Array(n);       // position along the column (m)
    this.state = new Uint8Array(n);     // 0 mobile, 1 stationary, 2 instantaneous equilibrium
    this.t0 = new Float64Array(n);      // start of the current sojourn (s)
    this.dur = new Float64Array(n);     // length of the current sojourn (s)
    this.xa = new Float64Array(n);      // hop start position
    this.xb = new Float64Array(n);      // hop end position
    this.seq = new Uint32Array(n);      // increments on every phase change
    this.t = 0;
    this.p = null;
    this.fastStep = false;
    this.center = 0;     // theoretical band centre (m)
    this.variance = 0;   // theoretical band variance (m²)
    this.varGhost = 0;   // variance the band would have at the optimum flow
  }

  /**
   * p = { u, k, A, B, C, L, H, Hghost } — A, B, C, H already include the
   * display magnification and any switched-off terms.
   */
  Sim.prototype.configure = function (p) {
    var k = p.k;
    var q = {
      u: p.u, k: k, L: p.L,
      A: p.A, B: p.B, C: p.C, H: p.H, Hghost: p.Hghost,
      V: p.u / (1 + k),
      noise: p.A * p.u + p.B,
      kinetic: p.C > 0
    };
    if (q.kinetic) {
      var need = MIN_HOPS * p.C * (1 + k) * (1 + k) * p.u / (p.L * k * k);
      q.sum = Math.min(2, Math.max(REGULARITY, need));
      q.tauS = p.C * (1 + k) * (1 + k) / (k * q.sum);
      q.tauM = q.tauS / k;
      q.shapeM = 1 / (MOBILE_SHARE * q.sum);
      q.shapeS = 1 / ((1 - MOBILE_SHARE) * q.sum);
    }
    var old = this.p;
    this.p = q;
    if (!old) return;

    var i, n = this.n, t = this.t;
    if (!q.kinetic) {
      for (i = 0; i < n; i++) {
        if (this.state[i] !== 2) { this.state[i] = 2; this.seq[i]++; }
      }
    } else if (!old.kinetic) {
      for (i = 0; i < n; i++) this.randomPhase(i);
    } else {
      // Stretch the sojourns already in progress to the new time constants.
      for (i = 0; i < n; i++) {
        var rem = this.t0[i] + this.dur[i] - t;
        if (rem < 0) rem = 0;
        if (this.state[i] === 0) {
          var remM = rem * (q.tauM / old.tauM);
          this.xa[i] = this.x[i];
          this.t0[i] = t;
          this.dur[i] = Math.max(remM, 1e-9);
          this.xb[i] = this.x[i] + q.u * remM + Math.sqrt(q.noise * remM) * gauss();
          if (this.xb[i] < 0) this.xb[i] = -this.xb[i];
        } else {
          this.t0[i] = t;
          this.dur[i] = Math.max(rem * (q.tauS / old.tauS), 1e-9);
        }
      }
    }
  };

  Sim.prototype.sampleM = function () {
    var q = this.p;
    return Math.max(gammaSample(q.shapeM) * q.tauM / q.shapeM, 1e-9);
  };

  Sim.prototype.sampleS = function () {
    var q = this.p;
    return Math.max(gammaSample(q.shapeS) * q.tauS / q.shapeS, 1e-9);
  };

  /**
   * Put molecule i at a random point of its mobile/stationary cycle, keeping x.
   * The sojourn it is caught in is drawn length-biased (a gamma with shape + 1),
   * which is what an observer arriving at a random time sees; without this the
   * band would start slightly ahead of its predicted position.
   */
  Sim.prototype.randomPhase = function (i) {
    var q = this.p, x = this.x[i];
    if (!q.kinetic) { this.state[i] = 2; this.seq[i]++; return; }
    if (Math.random() < q.k / (1 + q.k)) {
      var ds = Math.max(gammaSample(q.shapeS + 1) * q.tauS / q.shapeS, 1e-9);
      this.state[i] = 1;
      this.dur[i] = ds;
      this.t0[i] = this.t - Math.random() * ds;
      this.xa[i] = x;
      this.xb[i] = x;
    } else {
      var dm = Math.max(gammaSample(q.shapeM + 1) * q.tauM / q.shapeM, 1e-9);
      var f = Math.random();
      var disp = q.u * dm + Math.sqrt(q.noise * dm) * gauss();
      this.state[i] = 0;
      this.dur[i] = dm;
      this.t0[i] = this.t - f * dm;
      this.xa[i] = x - f * disp;
      this.xb[i] = this.xa[i] + disp;
    }
    this.seq[i]++;
  };

  /** Inject a rectangular plug of width w (m) at the column inlet. */
  Sim.prototype.inject = function (w) {
    for (var i = 0; i < this.n; i++) {
      this.x[i] = Math.random() * w;
      this.randomPhase(i);
    }
    this.center = w / 2;
    this.variance = w * w / 12;
    this.varGhost = this.variance;
  };

  /** Advance the simulation by dt seconds of column time. */
  Sim.prototype.step = function (dt) {
    var q = this.p, n = this.n, i;
    var tEnd = this.t + dt;
    this.fastStep = !q.kinetic || dt > FAST_CYCLES * (q.tauM + q.tauS);

    if (this.fastStep) {
      // Diffusion limit: exchange is too fast to resolve at this step size, so
      // move every molecule by the mean velocity plus the full band variance.
      var sd = Math.sqrt(Math.max(q.H, 0) * q.V * dt);
      for (i = 0; i < n; i++) {
        var nx = this.x[i] + q.V * dt + sd * gauss();
        this.x[i] = nx < 0 ? -nx : nx;
      }
      this.t = tEnd;
      if (q.kinetic) {
        for (i = 0; i < n; i++) this.randomPhase(i);
      } else {
        // Instantaneous exchange (C·u off): at any moment a fraction k/(1+k) of
        // the molecules is in the film, but which ones changes continuously.
        var pS = q.k / (1 + q.k);
        for (i = 0; i < n; i++) {
          this.state[i] = Math.random() < pS ? 1 : 2;
          this.seq[i]++;
        }
      }
    } else {
      var x = this.x, st = this.state, t0 = this.t0, dur = this.dur;
      var xa = this.xa, xb = this.xb, seq = this.seq;
      for (i = 0; i < n; i++) {
        var guard = 0;
        while (t0[i] + dur[i] <= tEnd && guard++ < 1000) {
          var tt = t0[i] + dur[i];
          if (st[i] === 0) {
            x[i] = xb[i];
            st[i] = 1;
            t0[i] = tt;
            dur[i] = this.sampleS();
          } else {
            st[i] = 0;
            t0[i] = tt;
            var d = this.sampleM();
            dur[i] = d;
            xa[i] = x[i];
            var e = xa[i] + q.u * d + Math.sqrt(q.noise * d) * gauss();
            xb[i] = e < 0 ? -e : e;
          }
          seq[i]++;
        }
        if (st[i] === 0) x[i] = xa[i] + (xb[i] - xa[i]) * (tEnd - t0[i]) / dur[i];
      }
      this.t = tEnd;
    }

    var dX = q.V * dt;
    this.center += dX;
    this.variance += q.H * dX;
    this.varGhost += q.Hghost * dX;
  };

  /** Ensemble statistics of the molecule positions. */
  Sim.prototype.stats = function () {
    var n = this.n, s = 0, s2 = 0, stat = 0, i;
    for (i = 0; i < n; i++) {
      s += this.x[i];
      if (this.state[i] === 1) stat++;
    }
    var mean = s / n;
    for (i = 0; i < n; i++) { var d = this.x[i] - mean; s2 += d * d; }
    return { mean: mean, variance: s2 / (n - 1), fracStationary: stat / n };
  };

  Sim.REGULARITY = REGULARITY;
  Sim.MIN_HOPS = MIN_HOPS;
  Sim.gauss = gauss;
  Sim.gammaSample = gammaSample;

  root.VDSim = Sim;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
})(typeof window !== 'undefined' ? window : this);
