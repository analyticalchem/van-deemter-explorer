/*
 * Van Deemter model for partition liquid chromatography.
 *
 *   H = A + B/u + C·u
 *
 *   A = 2·λ·dp                              multipath effect
 *   B = 2·γ·Dm                              longitudinal diffusion
 *   C = Cm + Cs                             resistance to mass transfer
 *       Cm = ω(k)·dp²/Dm                    mobile phase, Golay-type k dependence
 *       Cs = (2/3)·k/(1+k)²·df²/Ds          stationary liquid film
 *
 * Temperature acts through Dm (Wilke–Chang scaling, Dm ∝ T/η) and the
 * mobile-phase viscosity η(T). Pure functions only — no DOM — so the same
 * file can be checked outside the page.
 */
(function (root) {
  'use strict';

  var P = {
    L: 0.150,          // column length (m)
    ID: 4.6e-3,        // column inner diameter (m)
    epsT: 0.65,        // total porosity; converts volumetric flow to linear velocity
    lambda: 0.5,       // packing factor: A = 2·λ·dp
    gamma: 0.7,        // obstruction factor: B = 2·γ·Dm
    Dm25: 1.0e-9,      // analyte diffusion coefficient in the mobile phase at 25 °C (m²/s)
    eta25: 0.890e-3,   // mobile-phase (water) viscosity at 25 °C (Pa·s)
    etaEaR: 1812,      // Arrhenius fit to water viscosity over 20–80 °C (K)
    filmRatio: 0.10,   // stationary-phase film thickness / particle diameter
    DsRatio: 0.20,     // diffusion in the stationary liquid / diffusion in the mobile phase
    phi: 700,          // flow-resistance factor of a packed bed (Darcy / Kozeny–Carman)
    Fmin: 0.05,        // flow-rate slider range (mL/min)
    Fmax: 5.0,
    HPLC_LIMIT: 400e5,   // Pa — typical HPLC pump limit (~400 bar)
    UHPLC_LIMIT: 1300e5  // Pa — upper end of typical UHPLC systems (~1300 bar)
  };

  var T25 = 298.15;

  function kelvin(Tc) { return Tc + 273.15; }

  /** Mobile-phase viscosity (Pa·s) at temperature Tc (°C). */
  function viscosity(Tc) {
    return P.eta25 * Math.exp(P.etaEaR * (1 / kelvin(Tc) - 1 / T25));
  }

  /** Analyte diffusion coefficient in the mobile phase (m²/s): Dm ∝ T/η. */
  function diffusivity(Tc) {
    return P.Dm25 * (kelvin(Tc) / T25) * (P.eta25 / viscosity(Tc));
  }

  /** Linear velocity u (m/s) from volumetric flow F (mL/min). */
  function velocityFromFlow(F) {
    var area = Math.PI * Math.pow(P.ID / 2, 2);
    return (F * 1e-6 / 60) / (P.epsT * area);
  }

  /** Volumetric flow F (mL/min) from linear velocity u (m/s). */
  function flowFromVelocity(u) {
    return u / velocityFromFlow(1);
  }

  /** Golay-type dependence of mobile-phase mass transfer on retention factor k. */
  function omega(k) {
    return (1 + 6 * k + 11 * k * k) / (96 * (1 + k) * (1 + k));
  }

  /**
   * Van Deemter coefficients for particle diameter dp (m), temperature Tc (°C)
   * and retention factor k. Returns SI units: A (m), B (m²/s), C (s).
   */
  function coefficients(dp, Tc, k) {
    var Dm = diffusivity(Tc);
    var Ds = P.DsRatio * Dm;
    var df = P.filmRatio * dp;
    var Cm = omega(k) * dp * dp / Dm;
    var Cs = (2 / 3) * k / ((1 + k) * (1 + k)) * df * df / Ds;
    return {
      A: 2 * P.lambda * dp,
      B: 2 * P.gamma * Dm,
      C: Cm + Cs,
      Cm: Cm,
      Cs: Cs,
      Dm: Dm,
      eta: viscosity(Tc),
      k: k,
      dp: dp,
      Tc: Tc
    };
  }

  /** Coefficients with switched-off terms zeroed. terms = {A, B, C} booleans. */
  function activeCoefficients(co, terms) {
    return {
      A: terms.A ? co.A : 0,
      B: terms.B ? co.B : 0,
      C: terms.C ? co.C : 0
    };
  }

  /** Plate height and its three contributions (m) at linear velocity u (m/s). */
  function plateHeight(u, co, terms) {
    var a = activeCoefficients(co, terms);
    var hA = a.A, hB = a.B / u, hC = a.C * u;
    return { A: hA, B: hB, C: hC, H: hA + hB + hC };
  }

  /**
   * Optimum velocity u_opt = √(B/C) and H_min = A + 2√(BC), limited to the
   * flow range the instrument can deliver. With B or C switched off the curve
   * has no interior minimum, so the best point is the matching end of the range.
   */
  function optimum(co, terms) {
    var a = activeCoefficients(co, terms);
    var uLo = velocityFromFlow(P.Fmin), uHi = velocityFromFlow(P.Fmax);
    var u, interior = false;
    if (a.B > 0 && a.C > 0) {
      u = Math.sqrt(a.B / a.C);
      interior = true;
    } else if (a.C > 0) {
      u = uLo;
    } else if (a.B > 0) {
      u = uHi;
    } else {
      u = null; // H = A everywhere
    }
    var clamped = false;
    if (u !== null) {
      if (u < uLo) { u = uLo; clamped = true; }
      if (u > uHi) { u = uHi; clamped = true; }
    }
    var H = u === null ? a.A : a.A + a.B / u + a.C * u;
    return { u: u, H: H, interior: interior && !clamped, clamped: clamped };
  }

  /** Column back-pressure (Pa): ΔP = φ·η·L·u / dp². */
  function pressure(u, co) {
    return P.phi * co.eta * P.L * u / (co.dp * co.dp);
  }

  /** Dead time and retention time (s). */
  function times(u, k) {
    var t0 = P.L / u;
    return { t0: t0, tR: t0 * (1 + k) };
  }

  var VD = {
    params: P,
    viscosity: viscosity,
    diffusivity: diffusivity,
    velocityFromFlow: velocityFromFlow,
    flowFromVelocity: flowFromVelocity,
    omega: omega,
    coefficients: coefficients,
    activeCoefficients: activeCoefficients,
    plateHeight: plateHeight,
    optimum: optimum,
    pressure: pressure,
    times: times
  };

  root.VD = VD;
  if (typeof module !== 'undefined' && module.exports) module.exports = VD;
})(typeof window !== 'undefined' ? window : this);
