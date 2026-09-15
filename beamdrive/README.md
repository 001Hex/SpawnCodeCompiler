# BeamDrive Mobile

A soft-body crash-driving sandbox that runs in a mobile browser. Six cars,
five maps, real deformation, an animated driver, and no assets: every car,
landscape, texture and sound is generated from code when the page loads.

The whole game is one 376 KB HTML file with no network requests at runtime.

---

## Get it onto an iPhone

**iOS will not open a local HTML file in Safari.** Tapping an `.html` in the
Files app hands it to Quick Look, a restricted preview that will not give the
page a WebGL context, and Safari refuses `file://` URLs entirely. That is an
Apple restriction, not a bug in the game — anything WebGL has to be served
over HTTP(S), even if the server is the phone itself.

So there are three routes that actually work. The first is the good one.

### 1. GitHub Pages (recommended — free, and gives a real app icon)

This repo is public, so Pages is free.

1. Go to **Settings → Pages** on this repo.
2. Under *Build and deployment*, set **Source: Deploy from a branch**.
3. **Branch:** `claude/beamng-ios-web-port-8j498v` (or `main` after merging)
   and **Folder:** `/docs`. Save.
4. Wait a minute or two, then open on the phone:

   `https://001hex.github.io/SpawnCodeCompiler/`

5. In Safari: **Share → Add to Home Screen.**

Launch it from the icon and it runs fullscreen with no browser chrome. A
service worker caches everything on the first visit, so after that it works
with no connection at all — on a plane, on the Tube, anywhere.

Pages can only publish from `/` or `/docs`, which is why the build mirrors
itself into `docs/` at the repo root. Re-run `node tools/build.js` and commit
`docs/` to publish an update.

### 2. Serve it from the phone itself (no computer, no repo settings)

Install **a-Shell** from the App Store (free). Then:

```sh
pickFolder            # point it at wherever you saved BeamDrive.html
python3 -m http.server 8000
```

Leave a-Shell open and go to `http://localhost:8000/BeamDrive.html` in Safari.
`localhost` counts as a secure origin, so Add to Home Screen works from here
too.

**Working Copy** (also free for public repos) is the tidier version of this:
clone the repo, and use its built-in server to open `beamdrive/dist/` in
Safari.

### 3. Serve it from a computer on the same Wi-Fi

```bash
cd beamdrive
node tools/serve.js          # prints the LAN address to type on the phone
```

or `python3 -m http.server 8080` from inside `beamdrive/dist`. Over plain
HTTP on a LAN you get the game, but not the Home Screen install or offline
caching — those need HTTPS or `localhost`.

### What `BeamDrive.html` is still good for

The single self-contained file plays fine in any **desktop** browser — just
double-click it. It is also the easiest thing to hand to someone else, since
it has no other files to go with it. It just cannot be opened from local
storage on iOS.

### Settings for an iPhone 17 Pro

Out of the box it selects **High**. For that phone:

| Setting | Value |
|---|---|
| Quality preset | **Ultra** |
| Frame rate cap | **60** |
| Motion blur | On |
| Particles | 100% |

Ultra runs at full device pixel ratio with 2048px cascaded shadows, two-mip
bloom, speed blur, chromatic aberration and film grain, and steps the physics
at 600 Hz. If the frame rate dips — a big pile-up with traffic on Alpine Pass
is the worst case — drop to **High**; the solver rate follows the preset, so
you get headroom in both the renderer and the physics.

Landscape is strongly preferred; the game prompts for it on phone-sized
portrait screens.

---

## Controls

Four steering schemes, switchable in **Controls**:

- **Buttons** — left/right pads. The default; most reliable.
- **Wheel** — a virtual rim you drag round. The most precise once you adapt.
- **Tilt** — steer by rolling the phone. Needs the motion permission Safari
  asks for, then tap **Set Zero** while holding the phone how you want it.
- **Drag** — slide anywhere in the lower-left quadrant.

Throttle and brake are on the right. `HAND` is the handbrake, `CAM` cycles
chase / chase-far / bonnet / cockpit / bumper / orbit, `RESET` respawns, `FLIP`
rights the car where it sits. Drag the middle of the screen to look around
without steering. A keyboard or a connected gamepad works too — the key map is
listed on the Controls screen.

---

## What is actually simulated

**The car is not a rigid body.** Each vehicle is a lattice of 40-60 point
masses joined by around 230 damped springs. Beams yield plastically past a
strain threshold and snap past a second one, and those thresholds vary by
region: the nose and tail are soft crumple zones, the passenger cell is stiff
and holds its shape. Visible panels are skinned to that lattice with four
influences per vertex, so the dent you see is the structure underneath moving
— not a swap to a pre-made wrecked model.

**Suspension is geometry, not a fudge.** Each hub is located by two stiff
lower arms running to the chassis centreline, which leaves it exactly one
degree of freedom — the vertical arc a real wishbone sweeps. A soft
spring/damper strut works along that arc. Bend an arm in a crash and the wheel
really does sit at the wrong angle; break one and it leaves.

**Tyres** use a combined-slip friction ellipse with a peak-and-falloff curve,
so grip drops away past the limit instead of clipping flat, plus load
sensitivity (grip per newton falls as the tyre is loaded up).

**Driveline**: torque curve → clutch → gearbox → final drive → wheel inertia →
contact patch, with a throttle-dependent clutch take-up that lets the engine
spin up and launch the car instead of bogging.

**The driver** is a 39-bone rig solved with two-bone IK onto the steering rim
and the pedal faces. The hands genuinely shuffle: past about 100 degrees of
lock a hand releases, arcs over and re-grips, the way a person does. Fingers
curl around the rim and open when a hand is in the air, the body leans against
lateral and longitudinal g, the head looks into the corner, and a crash
kicks a spring that jolts the whole figure.

### Two numerical problems worth knowing about

Both of these were visible as bugs before they were fixed, and both are the
kind of thing that quietly ruins a driving sim:

- **The clutch cannot be integrated explicitly.** It is a very stiff damper
  sitting across a gear ratio of up to 14:1, and referred to the wheels its
  damping scales with the ratio *squared*. That puts the stable explicit
  timestep around 8 kHz. It is solved implicitly instead, which is
  unconditionally stable and still slips properly at its torque limit. The
  wheel's own tyre coupling is solved the same way.

- **Shape matching needs a real polar decomposition.** Recovering the car's
  orientation from the deformed node cloud by orthonormalising the covariance
  fit looks fine and is wrong: the fit is `R·S`, and a car's `S` has a strong
  height/length correlation, which bakes in a phantom pitch of about 11
  degrees. That tilts every tyre force out of the ground plane and unloads the
  driven wheels. It uses an iterative rotation extraction, warm-started from
  the previous frame.

### Honest limits

A phone browser gets a small fraction of the budget a native simulator has.
The real thing runs thousands of nodes at 2000 Hz; this runs around fifty at
480 Hz, with beam stiffnesses sized to stay stable at that rate. Cars
therefore deform more readily and ring a little more than they should, panel
geometry is coarse, and there is no tyre carcass model, no drivetrain lash and
no fluid simulation. Expect the spirit of it, not parity.

---

## Cars and maps

| Car | Class | Layout | Notes |
|---|---|---|---|
| Comet 1.4 | Compact hatch | FWD | 1015 kg. Slow, light, folds like paper |
| Meridian 2.5 | Midsize saloon | FWD | Soft springs, long bonnet, big crumple zones |
| Rampage GT | Muscle coupe | RWD | 624 Nm and no electronic help |
| Bighorn 4x4 | Pickup | AWD | 2385 kg. Wins every argument |
| Vector RS | Mid-engine sports | RWD | Engine behind your head, 8200 rpm |
| Sprint Rally | Rally hatch | AWD | Turbo, and a handbrake that means something |

| Map | Character |
|---|---|
| Proving Grounds | Flat tarmac, oval, drag strip, jumps, skid pad, crash wall |
| Coastal Run | Cliff road above the sea at golden hour |
| Alpine Pass | Switchbacks and snow above the treeline |
| Derby Bowl | Dirt saucer ringed with tyre walls. No route, no lap time |
| Port Docks | Container stacks and a quayside with nothing to stop you |

---

## Building

No dependencies, no bundler. Node 18+ is enough.

```bash
cd beamdrive
node tools/build.js          # writes dist/ and BeamDrive.html
node tools/build.js --no-minify   # readable output, for debugging
```

Sources live in `src/` as plain scripts sharing one global, concatenated in
filename order:

```
01_math      vectors, matrices, quaternions, seeded RNG
02_noise     Perlin, fBm, ridged multifractal
03_gl        WebGL2 wrapper: programs, geometry, textures, framebuffers
04_shaders   GLSL ES 3.00 — uber surface shader, sky, post chain
05_geom      mesh builder and every primitive in the game
06_softbody  node/beam solver, plastic yield, breakage, shape matching
07_vehicles  station-based car construction, skinning, suspension
08_catalogue the six cars
09_drivetrain engine, implicit clutch, gearbox, tyres
10_terrain   heightfield, road splines, surface blending
11_props     prop geometry, oriented-box colliders, broadphase grids
12_maps      the five maps and the garage studio
13_driver    39-bone rig, two-bone IK, hand shuffle
14_renderer  forward pass, cascaded shadows, bloom, tonemap
15_particles instanced billboards: smoke, sparks, debris
16_camera    six camera modes and the shake rig
17_audio     fully synthesised engine, tyres, wind, impacts
18_input     touch schemes, tilt, keyboard, gamepad
19_game      world loading, fixed-step loop, scene assembly
20_ui        screens, garage, settings, HUD
21_boot      frame loop and the mobile platform bits
```

`tools/png.js` is a small PNG encoder so the build can generate the app icons
with no image dependencies.

### Testing

The game is testable headlessly with real WebGL — Chromium with SwiftShader
compiles the actual shaders and runs actual frames. The physics was validated
by stepping the simulation at a fixed rate with rendering out of the loop and
checking force balance, wheel loads against vehicle weight, ride height,
attitude and acceleration against hand-computed values. That is how both
numerical problems above were found.

---

This is an original game. It is not affiliated with, endorsed by, or derived
from any commercial driving simulator. All vehicle names, shapes and maps are
invented for this project.
