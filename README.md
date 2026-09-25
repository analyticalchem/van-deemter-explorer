# Van Deemter Explorer

An interactive, browser-based demonstration of the van Deemter equation for partition liquid chromatography:

**H = A + B/u + C·u**

Analyte molecules flow through a packed column, stop in the stationary liquid film when they touch the packing, and then rejoin the mobile phase. Under the column, a Gaussian band profile shows how wide the analyte packet has become. The van Deemter plot shows where the current flow rate sits on the curve.

No build step and no dependencies: plain HTML, CSS and JavaScript.

## Running it

- **Locally:** open `index.html` in a browser. Double-clicking works, because the scripts are classic scripts rather than ES modules.
- **GitHub Pages:** push the repository, then in *Settings → Pages* choose *Deploy from a branch*, select the default branch and the `/ (root)` folder. The page will be served at `https://<user>.github.io/<repo>/`.

## What you can change

| Control | What it does in the model |
|---|---|
| **Flow rate** (0.05–5 mL/min) | Sets the linear velocity u through a 150 × 4.6 mm column (total porosity 0.65). |
| **Temperature** (20–80 °C) | Raises the analyte diffusion coefficient D<sub>m</sub> ∝ T/η and lowers the mobile-phase viscosity η. B grows, C shrinks, and u<sub>opt</sub> moves to higher flow. |
| **Particle size** (1.5–10 µm) | A ∝ d<sub>p</sub> and C ∝ d<sub>p</sub>², so smaller particles give lower, flatter curves. Back-pressure ∝ 1/d<sub>p</sub>². |
| **Mass transfer** (k = 0.3–10) | The analyte's affinity for the stationary phase, expressed as the retention factor k. Stronger affinity means longer stays in the film, a larger C term and a longer retention time. |
| **Term toggles** (A multipath effect, B/u longitudinal diffusion, C·u mass transfer) | Switch a term off in both the plot and the animation. Switching C·u off makes exchange between the phases instantaneous (the textbook meaning of C = 0): the analyte is still retained and moves at u/(1 + k), slower than the flow wisps, but mass transfer no longer broadens the band. |
| **Ghost band** | A dashed profile showing how wide the band would be at the optimum flow rate, drawn at the same position in the column. |
| **True-scale band** | Removes the 9× band-width magnification (see below). |

Hover over the van Deemter plot to read values at any velocity; click or drag on it to set the flow rate. "Show the curve as a table" lists the same values.

## The model

```
H  = A + B/u + C·u
A  = 2·λ·dp                        multipath effect,  λ = 0.5
B  = 2·γ·Dm                        longitudinal diffusion,  γ = 0.7
C  = Cm + Cs                       mass transfer
Cm = ω(k)·dp²/Dm                   ω(k) = (1 + 6k + 11k²) / (96·(1 + k)²)
Cs = (2/3)·k/(1 + k)²·df²/Ds       df = 0.1·dp,  Ds = 0.2·Dm

Dm(T) = 1.0e-9 m²/s · (T/298 K) · η(25 °C)/η(T)
η(T)  = 0.89 mPa·s · exp(1812 K · (1/T − 1/298.15 K))     (water, fits 20–80 °C to within ~3%)
ΔP    = φ·η·L·u / dp²              φ = 700
N     = L / H,  σ² = H·x,  t_R = (L/u)(1 + k)
```

At default conditions (5 µm, 25 °C, k = 2) this gives u<sub>opt</sub> ≈ 0.87 mm/s (0.57 mL/min) and H<sub>min</sub> ≈ 8.2 µm. The constants are typical textbook values, chosen for illustration rather than to describe any particular column.

Simplifications worth knowing about:

- The ω(k) dependence of mobile-phase mass transfer is Golay's open-tube form, used here as a stand-in for a packed bed.
- Temperature changes diffusion and viscosity but not retention. In a real separation, k usually falls as temperature rises.
- Because B ∝ D<sub>m</sub> and C ∝ 1/D<sub>m</sub>, H<sub>min</sub> = A + 2√(BC) does not depend on temperature in this model. Temperature only moves the optimum to a higher velocity and flattens the C branch.
- Diffusion inside the stationary phase is not included in B.

## How the animation relates to the equation

Each molecule alternates between two states (the Giddings–Eyring picture of partition chromatography):

- **Mobile phase:** it moves with the flow at u.
- **Stationary liquid film:** it sits still.

On average it spends a fraction k/(1 + k) of its time in the film, so the band moves at u/(1 + k). The random lengths of the stays produce the C·u broadening. The A and B/u contributions are added as random variation in each flowing step. The molecules' axial positions come straight from this simulation. The histogram under the column counts them, and the Gaussian is drawn from σ² = σ₀² + H·x using the same H, so the two can be compared directly.

A real column has tens of thousands of plates, and a molecule moves between the phases tens of thousands of times on its way through, which is far too often to see. So the animation is scaled:

- **Band widths are magnified 9×.** The animation simulates a column with 81× fewer plates. The readouts (H, N, σ, times, pressure) always give real-column values.
- **Stays in the film are longer and more regular than real ones** (gamma-distributed rather than exponential). This lets you see each one while still producing exactly the C·u broadening the equation predicts. For the same reason, each pass through the column has at least 12 visits to the stationary phase.
- **Time runs 10× faster than in the column at 1× speed** (1 s on screen = 10 s in the column). Relative speeds are preserved, so doubling the flow rate visibly doubles the speed.
- The up-and-down path of each molecule around the packing is illustrative. The packing is drawn deliberately open, with an amber stationary-phase film on each support particle, so contacts are easy to see.

Just after injection, the histogram runs a little wider than the predicted curve. This is because each molecule is caught partway through a hop. The difference fades as the band travels and is a few percent by the outlet. Checked in the browser with 4,000 molecules per run: the band centre matched the prediction to within 0.02 σ, the stationary-phase fraction matched k/(1 + k), and the variance at the outlet was within 8% of the prediction under every condition tested.

## Files

```
index.html        page structure and text
css/styles.css    layout, light/dark themes
js/model.js       van Deemter physics (pure functions)
js/sim.js         stochastic molecule simulation (no DOM)
js/column.js      column animation (canvas)
js/plots.js       band profile and van Deemter plot (canvas)
js/main.js        wires controls, model, simulation and views
```

## License

MIT. See [LICENSE](LICENSE).
