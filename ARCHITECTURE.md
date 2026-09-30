# Super Serika Kart — Architecture & Module Contracts

A Mario-Kart-style 3D kart racer that runs in the browser. Stars **Serika Kuromi** (Blue Archive) and
seven other Kivotos students. Everything (models, tracks, sound, music) is **procedural** — there are no
binary asset files. Tech: **Three.js r186** + **Vite 8**, vanilla JavaScript ES modules (no TypeScript,
no frameworks, no other runtime deps).

```
npm run dev              # dev server on http://localhost:5173 (ALREADY RUNNING during development — do not start another)
npm run build            # production build into dist/
node tools/shot.mjs ...  # headless-Chrome screenshot / console / input harness (see §Testing)
node tools/validate-track.mjs [trackId] [--svg out.svg]   # track geometry validator
```

---------------------------------------------------------------------------------------------------------

## 0. Rules for everyone working on this codebase

1. **Own your files.** §1 lists which agent owns which file. Only edit files you own. Other agents are
   editing their files *at the same time*. If you need something from another module that does not exist
   yet, code defensively (`obj.method?.()`), and mention it in your final report.
2. **Keep the contracts.** Exported names, constructor options, method signatures and object shapes in this
   document are the contract. You may ADD fields/methods; never rename or remove documented ones.
   Stubs already exist for every module and show the contract in code — replace them fully.
3. **No new dependencies**, no binary assets, no network fetches at runtime (except the Google Fonts link
   already in index.html). Use `three` and `three/addons/...` only.
4. **Do not** run `npm run build` / `vite build` into `dist/` (concurrent builds clash). If you want a build
   check use `npx vite build --outDir <your scratch dir> --emptyOutDir`. Do not start another dev server.
5. Put screenshots in `shots/<your-area>/...` (gitignored scratch).
6. Performance target: **60 fps at 1080p on an integrated AMD Radeon GPU** with 8 karts. Budget:
   < 450 draw calls in a race, < 600k triangles on screen, one 2048 shadow map. Merge static geometry,
   use `InstancedMesh` for repeated props, share materials, avoid per-frame allocations in hot loops
   (reuse `Vector3`s), no `MeshPhysicalMaterial`, no post-processing passes.
7. Art direction: bright, saturated, clean **anime/Nintendo** look. Chunky readable shapes, soft
   shadows, rim/emissive glows instead of bloom. Characters use `MeshToonMaterial` (+ inverted-hull
   outlines); the world uses `MeshLambertMaterial` / `MeshToonMaterial` / `MeshStandardMaterial`
   (roughness ≥ 0.5). Colors are authored in sRGB hex.
8. Use `THREE.Timer` (not the deprecated `THREE.Clock`), `THREE.PCFShadowMap` (PCFSoft was removed in r186).
9. Game text is English. Keep Blue Archive flavour (names, schools, Credits, Pyroxene, Sensei, Arona,
   Shittim Chest...) but everything must be original work — no copied logos, music or sprites.

---------------------------------------------------------------------------------------------------------

## 1. Layout & ownership

| Path | Owner | What |
|---|---|---|
| `index.html`, `vite.config.js`, `package.json`, `src/main.js`, `src/core/renderer.js`, `src/core/utils.js`, `src/core/EventBus.js`, `src/world/TrackPath.js`, `src/data/*.js`, `src/data/tracks/index.js`, `src/data/tracks/test-oval.js`, `tools/*`, `ARCHITECTURE.md`, `src/styles/base.css` | lead | core contracts (read-only for agents; request changes in your report) |
| `src/core/Input.js`, `src/entities/Kart.js`, `src/race/Camera.js`, `src/debug/drive.js` | **physics** | input, kart physics, chase camera |
| `src/world/TrackBuilder.js`, `src/world/Props.js`, `src/world/Environment.js`, `src/world/*` (new helpers), `src/debug/track.js`, `src/debug/props.js` | **world** | track meshes, environment/sky, prop library |
| `src/data/tracks/<id>.js` (8 tracks) | **tracks-A / tracks-B** | track definitions + unique scenery |
| `src/entities/RacerModel.js`, `src/entities/CharacterModel.js`, `src/entities/KartModel.js`, `src/ui/Portraits.js`, `src/debug/character.js` | **characters** | chibi drivers, karts, portraits |
| `src/entities/ItemSystem.js`, `src/entities/items/*`, `src/race/Particles.js`, `src/debug/items.js` | **items** | items, pickups, projectiles, particles |
| `src/entities/AIDriver.js`, `src/debug/ai.js` | **ai** | computer drivers |
| `src/race/Race.js`, `src/race/*` (new helpers other than Camera/Particles) | **race** | race orchestration |
| `src/ui/HUD.js`, `src/ui/itemIcons.js`, `src/styles/hud.css`, `src/debug/hud.js` | **hud** | in-race HUD |
| `src/core/Game.js`, `src/ui/Menus.js`, `src/ui/*` (other new files), `src/styles/menus.css`, `src/debug/menus.js` | **frontend** | game flow, menus, results, title |
| `src/core/Audio.js`, `src/core/audio/*`, `src/debug/audio.js` | **audio** | synthesized SFX + music |

Debug scenes: `/?scene=<name>` loads `src/debug/<name>.js` and calls its `export async function run(ctx)`
with `ctx = { params: URLSearchParams, container, hudRoot, menuRoot, overlayRoot }`. Debug scenes create
their own renderer via `createRenderer(container)` from `src/core/renderer.js`. Expose useful state on
`window.__ssk` for `tools/shot.mjs --eval`.

---------------------------------------------------------------------------------------------------------

## 2. Conventions (shared by all code)

* **Y is up.** 1 unit ≈ 1 metre. Tracks lie roughly on the XZ plane.
* **yaw**: forward = `(sin yaw, 0, cos yaw)`; `object3d.rotation.y = yaw` makes a **+Z-facing** model face
  forward. **All models face +Z.** Right vector = `(-cos yaw, 0, sin yaw)`. **A right turn decreases yaw.**
  Helpers: `yawFromDir`, `dirFromYaw`, `rightFromYaw` in `src/world/TrackPath.js`.
* **steer**: `-1` = full left, `+1` = full right.
* **lateral**: signed offset from the track centreline along the right vector; `+` = right side.
* **d**: distance along the centreline from the start/finish line, wrapped to `[0, length)`.
* **curvature**: `+` = the road bends right (1/radius).
* Sizes: kart ≈ 2.2 long × 1.5 wide; kart + driver ≈ 1.9 tall; road 18–26 wide; off-road strips 4–10.
* Speeds (150cc): top speed ≈ 36 u/s (± character stats), boosts ≈ +30–40 %. Laps 900–1600 units.
* Colors in data files are `'#rrggbb'` strings.
* Time is in seconds; physics runs at a fixed 120 Hz (`PHYSICS_DT` in `src/data/engine.js`).
* Deterministic randomness: `mulberry32(seed)` from `src/core/utils.js` (no `Math.random()` in track
  generation, so tracks look the same every time).

---------------------------------------------------------------------------------------------------------

## 3. Data (lead-owned, read them)

* `src/data/characters.js` — `CHARACTERS` (8 racers: serika, shiroko, hoshino, nonomi, ayane, aru, arisu,
  hina) with `stats` (1..5: speed, accel, weight, handling, traction), `look` (appearance for the model
  builder), `kart` (colors/style/emblem), `tagline`, `school`. `getCharacter(id)`.
* `src/data/engine.js` — `ENGINE_CLASSES` {50,100,150,200} (topSpeed, accelScale, aiSkill, aiRubberBand,
  itemAggression), `GP_POINTS` = [15,12,10,8,6,4,2,1], `MAX_CREDITS` = 10, `CREDIT_SPEED_BONUS` = 0.01,
  `MODES`, `PHYSICS_DT`, `RACERS_PER_RACE` = 8, `DEFAULT_LAPS` = 3.
* `src/data/items.js` — `ITEMS` (id, name, desc, kind, uses, duration...), `ITEM_ODDS[place-1]` weights,
  `TIME_TRIAL_ITEM`.
* `src/data/tracks/index.js` — `TRACKS` (8 cup tracks), `TEST_TRACKS` (`test-oval`), `CUPS`
  (`credit`: abydos-desert, shibaseki-street, trinity-garden, millennium-cyber; `pyroxene`:
  hyakkiyako-sakura, red-winter, gehenna-inferno, arona-sky), `getTrackEntry(id)`, `loadTrackDef(id)`.

---------------------------------------------------------------------------------------------------------

## 4. Track definition (`src/data/tracks/<id>.js`, default export)

```js
export default {
  id: 'abydos-desert',            // must equal the registry id / filename
  name: 'Abydos Desert Circuit',
  laps: 3,
  width: 22,                      // default road width (full)
  offroad: 7,                     // default off-road strip width per side
  wall: true,                     // default: solid wall beyond the off-road strip; false = void (fall off -> respawn)
  points: [                       // closed Catmull-Rom (centripetal) loop in RACING ORDER; >= 8 points recommended
    { x: 0, y: 0, z: 0 },
    { x: 80, y: 2, z: 10, w: 26, bank: 8, offL: 4, offR: 10, wallL: true, wallR: false },
    // per-point overrides (all optional, smoothly interpolated): w|width, bank (deg, + = right side lower,
    // use + on right-handers, - on left-handers, |bank| <= 15), off|offroad, offL, offR, wall, wallL, wallR
  ],
  features: [                     // t in [0,1) = fraction of the lap (or d = absolute distance)
    { type: 'itemRow', t: 0.12, count: 4, lateral: 0, spacing: 4 },     // row of item boxes across the road
    { type: 'coins',   t: 0.20, count: 6, spacing: 4, lateral: -5 },     // line of Credits along the road
    { type: 'boost',   t: 0.30, lateral: 5, length: 8, width: 5 },       // dash panel (zone + visual)
    { type: 'ramp',    t: 0.55, lateral: 0, length: 10, width: 12, power: 1 }, // jump ramp (launch + trick)
    { type: 'hazard',  t: 0.70, lateral: -4, kind: 'barrel', radius: 1.2, effect: 'bump' }, // static obstacle
    { type: 'slow',    t: 0.80, lateral: 6, length: 12, width: 6 },      // mud/sand patch ON the road (off-road physics)
  ],
  decorations: [                  // scattered/regular props beside the track (built by TrackBuilder)
    { kind: 'palm', count: 60, side: 'both', minOffset: 2, maxOffset: 45, scale: [0.8, 1.4], seed: 3, tRange: [0, 1] },
    { kind: 'lamp', every: 35, side: 'both', offset: 1.5 },   // regular spacing along the track
    // offsets are measured OUTWARD from the outer boundary (road edge + off-road). Negative = inside the off-road.
  ],
  theme: { ... see below ... },
  scenery(ctx) { ... },           // optional: unique landmarks built with THREE + ctx (see §5.2)
};
```

### theme
```js
theme: {
  sky:     { top: '#2f7de1', bottom: '#bfe3ff', horizon: '#fff1d6', stars: false, sunDisc: true, clouds: true },
  fog:     { color: '#e8d7b0', near: 120, far: 700 },
  sun:     { color: '#fff1d6', intensity: 2.4, dir: [0.4, 1.0, 0.25] },      // dir points TOWARDS the sun
  ambient: { sky: '#cfe6ff', ground: '#c7a26b', intensity: 1.0 },
  ground:  { type: 'sand', color: '#e9c889', color2: '#d9b06a' },           // sand|grass|asphalt|snow|rock|lava|cloud|water|space|none
  road:    { style: 'asphalt', color: '#5a5d66', color2: '#51545c', lines: true }, // asphalt|stone|brick|neon|rainbow|ice|dirt|wood|tile
  edge:    { style: 'curb', colorA: '#e8304f', colorB: '#ffffff' },          // curb|line|glow|none
  offroad: { type: 'sand', color: '#e2bd7a' },                              // sand|grass|snow|dirt|gravel|flowers|none
  wall:    { style: 'barrier', color: '#e9eef5', color2: '#1fb6ff' },         // barrier|fence|stone|glow|hedge|snowbank|tires|none
  void:    { type: 'lava', color: '#ff5a1f' },                              // what is below/beyond wall-less edges: lava|water|sky|abyss
  grip: 1.0,                      // traction multiplier (ice tracks ~0.55)
  particles: 'dust',              // ambient weather: dust|petals|snow|embers|sparkles|leaves|null
  music: 'abydos',                // AudioManager music key (see §12)
  night: false,                   // darker lighting; road lights / emissive props look better
}
```

---------------------------------------------------------------------------------------------------------

## 5. World

### 5.1 TrackPath (`src/world/TrackPath.js`, lead-owned, pure math, works in Node)
`new TrackPath(def)` → `length`, `count`, `step`, `samples[]` (`{ index, d, pos, tan, right, rightH, up, yaw,
halfWidth, offL, offR, wallL, wallR, bankDeg, slope, curvature }`), `bounds {min,max}`, `zones[]`.
Methods: `frameAt(d, out?)`, `pointAt(d, lateral, out?)`, `sampleAt(d)`, `project(pos, hintIndex, out?)`
→ `{ index, d, lateral, groundY, height, frame, surface: 'road'|'offroad'|'wall'|'void', side, limit,
edgeDist, zone }`, `zoneAt(d, lateral)`, `curvatureAhead(d, ahead, step)`, `wrapD`, `deltaD(dNew, dOld)`,
`resolveD(feature)`, `gridSlot(slot, total)` → `{ position, yaw, d, lateral }` (slot 0 = pole),
`outline2D(every)`.
`project` is cheap with a hint (pass the previous result's `.index`); without a hint it scans globally.
Bridges resolve correctly because vertical distance is weighted.

### 5.2 Track object — `buildTrack(def, { quality }) → Track` (`src/world/TrackBuilder.js`, world agent)
```
Track = {
  def, id, name, laps, path: TrackPath,
  group: THREE.Group,                 // road, off-road, walls, terrain, start gantry, decorations, scenery
  sun: THREE.DirectionalLight,
  applyEnvironment(scene),            // sky (gradient dome / stars), fog, hemisphere + sun lights, ambient weather
  updateShadowFocus(position),        // move sun + shadow camera to follow the player (tight 2048 map)
  itemBoxSpots: [{ position: Vector3, d, lateral }],   // from itemRow features; position ≈ 1.3 above road
  coinSpots:    [{ position: Vector3, d, lateral }],   // from coins features;   position ≈ 0.9 above road
  hazards:      [{ position: Vector3, radius, kind, effect: 'bump'|'spin'|'launch', object3d?, active: true, moving?: bool }],
  minimap: { outline: [{x, z}], bounds: { minX, maxX, minZ, maxZ } },
  setStartLights(n),                  // start gantry lamps: 0 off, 1..3 red lamps lit, 4 = GO (all green/blue)
  update(dt, time, camera),           // animate scenery, moving hazards, weather particles, item-row glints
  dispose(),
}
```
Required visuals: textured-looking road (procedural canvas textures ok) with edge curbs/lines per theme, off-road
strips, walls/barriers (or none + void visuals), rich terrain/backdrop to the horizon, start/finish gantry with
checkered line, a “SUPER SERIKA KART” banner and start lights, dash panels (animated glowing chevrons), ramps
(wedge meshes whose top matches the launch), `slow` patches, decorations, the theme's sky/fog/lights and ambient
particles. Bridges/overpasses (track sections ≥ 7 units above another) need support pillars and the lower road
must remain visible.

`scenery(ctx)` hook — ctx provided by TrackBuilder to track files:
```
ctx = {
  THREE, group,                // add your objects to group
  path, def, theme, rng,       // rng = seeded mulberry32 for this track
  quality,                     // 'high' | 'medium' | 'low' (skip fine detail on low)
  props: { create(kind, opts) -> Object3D },          // prop library (§5.3)
  mat(color, opts?) -> Material                        // shared cached material (opts: { emissive, emissiveIntensity, toon, opacity, side })
  place(object, { t|d, lateral, y=0, yaw=0, align=true }) -> object   // position relative to the track (align = face along the track)
  isClear(x, z, radius) -> bool                        // true if the circle does not touch the road/off-road corridor
  addHazard({ position, radius, kind, effect, object3d, moving }) -> hazard
  addAnimated(fn(dt, time))                           // per-frame callback
  instanced(kind, transforms[{x,y,z,rotY,scale}], opts) -> InstancedMesh group  // batch many copies of a prop
}
```

### 5.3 Props (`src/world/Props.js`, world agent)
`createProp(kind, { scale, color, color2, seed, variant })` → Object3D (origin at ground, +Y up, faces +Z),
`PROP_KINDS`, `getToonMaterial(color, opts)`. Kinds (all must exist): palm, cactus, rock, boulder, dune, pine,
tree, bush, sakuraTree, flowerBed, hedge, lamp, streetLight, building, tower, ruin, fence, torii, lantern,
stoneLantern, snowman, crystal, cloud, sign, billboard, tire, cone, barrel, crate, banner, flag, grandstand,
balloon, pillar, arch, fountain, bench, vendingMachine, neonSign, hologram, pagoda, iceSpike, lavaRock, skull,
gear, desk, book. Unknown kinds fall back to a generic prop and log a warning once.

---------------------------------------------------------------------------------------------------------

## 6. Racer model (`src/entities/RacerModel.js` + `CharacterModel.js` + `KartModel.js`, characters agent)

`createRacerModel(character, { quality }) → RacerModel`
```
RacerModel = {
  root, kart, driver,                // Groups; root faces +Z, origin = ground contact centre
  anchors: { exhaustL, exhaustR, wheelFL, wheelFR, wheelRL, wheelRR, head, rear, front },  // Object3Ds under root
  update(dt, state),                 // RacerVisualState below
  dispose(),
}
RacerVisualState = {
  speed, steer (-1..1), throttle (0..1),
  drifting (bool), driftDir (-1|0|1), driftLevel (0 none, 1 blue, 2 orange, 3 purple),
  boosting (bool), airborne (bool), trick (bool, true for the trick animation moment),
  spinning (bool), tumbling (bool), hurt (bool), shrink (0.5..1 scale factor), invincible (bool),
  celebrate (bool), sad (bool), lookBack (bool), time (seconds)
}
```
The model is responsible for: wheel spin & front-wheel steering, body lean/squash, driver animation (leaning
into turns, looking back, arm/steering-wheel motion, happy/sad/hurt faces, celebration), hair/twin-tail sway,
halo bobbing/glow (brighter when invincible), **drift-spark glow sprites at the rear wheels** coloured by
driftLevel, **exhaust boost flames** while boosting. The Kart applies `root` world transform, spin/tumble
rotation and shrink scale — the model must not fight those (animate children only).

Characters are chibi (big head ≈ 40 % of height), anime-styled with toon shading + outlines: faces with
large expressive eyes (canvas-texture faces are fine), each character's signature silhouette (Serika:
cat ears + very long twin tails with cyan ribbons + red crosshair halo; Shiroko: wolf ears + blue scarf;
Hoshino: long pink hair + ahoge + heterochromia; Nonomi: long blonde wavy hair; Ayane: short dark hair +
glasses; Aru: red hair + small horns + fur-trimmed coat; Arisu: extremely long black hair; Hina: long white
hair + big curved horns + dark coat). Halos float above the head (BA style, emissive).

`Portraits` (`src/ui/Portraits.js`): `new Portraits(renderer)`, `await generate(characters)` renders every
character's head once to images (offscreen render target, transparent background), `get(id)` small
(128px) and `getLarge(id)` (256px bust) data URLs. Never throws; fall back to drawn initials.

---------------------------------------------------------------------------------------------------------

## 7. Kart & physics (`src/entities/Kart.js`, physics agent)

### DriveControls (produced by Input and AIDriver)
`{ throttle: 0..1, brake: 0..1, steer: -1..1, drift: bool (held), driftPressed: bool (edge), item: bool (held),
itemPressed: bool (edge), lookBack: bool }`

### Kart
```
new Kart({ id, index, character, track, isPlayer, engine })   // engine = ENGINE_CLASSES[cc]
// identity / visual
id, index, character, characterId, name, isPlayer, racer (RacerModel), object3d (Group added to the scene)
// kinematics (world space)
position, prevPosition, velocity (Vector3), yaw, speed (signed forward speed), vy, grounded, airTime,
forward, right, up (Vector3, kept up to date), radius (~1.3), weight (stat)
topSpeed (base for this kart), topSpeedScale (1; AI rubber-band hook, set by AIDriver/Race)
proj  (latest TrackPath.project result, updated every step), lastSafeD
// race bookkeeping (WRITTEN BY RACE): progress, lap, lapTimes[], finished, finishTime, place
// state
controls, drift: { active, dir, charge, level }, boostTime, boostStrength, coins,
item (id|null), itemUses, roulette: { active, time, duration, result },   // item fields written by ItemSystem
spinTime, launchTime, shrinkTime, invincibleTime, respawnTime, offroad (bool), wrongWayTime,
cardTime (Sensei's Card remaining; ItemSystem sets), trickPending
// methods
reset(gridSlot), setControls(controls), update(dt, world), updateVisual(dt, alpha),
onRaceStart()                          // called by Race at GO (rocket start check)
applyBoost(duration=1, strength=1)     // strength 1 ≈ +35% top speed with strong acceleration
spinOut(duration=1.1) -> bool          // false if immune
launch(strength=1) -> bool             // explosion: airborne tumble, big slowdown
shrink(duration) -> bool               // half size, slower, can be squished
setInvincible(duration)                // Halo Overdrive: immune, faster, knocks karts it touches
addCoins(n), loseCoins(n) -> lost      // clamp 0..MAX_CREDITS
respawn()                              // drone pick-up back to lastSafeD
getRearPosition(dist, out), getFrontPosition(dist, out), isVulnerable(), isStunned(), dispose()
// module functions
resolveKartCollisions(karts, world)          // weight-based bumping; invincible karts spin out others
resolveHazardCollisions(karts, hazards, world)
```
### World object (passed to kart.update / ai.update / items.update)
`{ time, phase: 'countdown'|'racing', countdownLeft, track, karts, player, particles, items, mode, engine,
sfx(name, position?, opts?), events (EventBus), camera }`

### Feel targets (MK8-like)
* 150cc base top speed 36 u/s; speed stat ±10 %; 0 → 90 % speed in 2.5 s (accel stat: 1.8–3.4 s).
  Each Credit adds +1 % top speed (max 10).
* Steering: responsive, max yaw rate ≈ 2.2 rad/s at mid speed, reduced at very high speed; handling stat ±20 %.
* **Drift / mini-turbo**: pressing drift while steering at > 40 % speed → small hop (0.25 s), then drift in
  the steer direction. While drifting: steering blends between wide (0.5×) and tight (1.6×) turn, kart
  slides visually 20–30°; charge grows faster when steering into the drift. Levels: blue at 0.75 s, orange
  at 1.5 s, purple (“ultra”) at 2.3 s → release gives boost 0.5 / 1.0 / 1.6 s. Drifting stops on release,
  when speed drops too low, or on hit. Tapping drift without steering = cosmetic hop.
* Dash panels: boost 1.2 s. Ramps: launch (vy ≈ 9 × power); press drift while airborne (within 0.4 s of
  takeoff or on any airborne moment > 0.25 s) → trick animation → 0.8 s boost on landing.
* Off-road: top speed × 0.5 (traction stat raises to 0.6), no effect while boosting. `slow` zones behave
  like off-road. Theme `grip` < 1 → more slide.
* Walls: kill the wall-normal velocity, bounce back slightly, speed × 0.75, sparks + `wallBump` sfx.
* Void (no wall): kart drives off, falls; when 8 units below the road → `respawn()` (1.6 s drone carry,
  placed on the centreline at `lastSafeD` facing forward, 1 s invincibility blink). Also respawn if
  somehow ≥ 30 units off the corridor.
* Kart–kart bumps: push apart, lighter kart gets knocked more; heavy karts barely budge.
* Spin-out 1.1 s (two visual spins, speed → ~0). Launch: 1.5 s tumble. Shrink: 0.55 scale, top speed
  × 0.8; a normal-size kart driving over a shrunk one squishes it (spinOut 2 s).
* Halo: top speed × 1.2, acceleration boost, immune, touching karts spin out.
* **Rocket start**: throttle pressed first when countdownLeft ∈ [0.7, 1.4] s → 1 s boost at GO; pressed
  before countdownLeft 2.3 s and held → 0.8 s stall with smoke at GO.
* Wrong way: `wrongWayTime` accumulates while heading opposes the track tangent (dot < -0.3) at speed > 4.
* Kart emits particles via `world.particles` (drift sparks, dust off-road, boost flames, wall sparks,
  landing dust) and sounds via `world.sfx(name, position)`: driftHop, driftStart, sparkBlue, sparkOrange,
  sparkPurple, miniTurbo, boostPad, jump, trick, land, wallBump, kartBump, spin, launch, fall, respawn.

### Camera (`src/race/Camera.js`)
`new ChaseCamera(camera)`, `setTarget(kart)`, `snap()`, `playIntro(track, duration) → Promise`, `skipIntro()`,
`setMode('chase'|'finish'|'orbit')`, `shake(strength)`, `update(dt, { lookBack })`. Chase ≈ 6.5 behind,
2.6 up, looks slightly ahead; smooth follow with extra lag during drifts; FOV 70 → 82 when boosting;
airborne pitch follow; look-back shows the view behind; intro = cinematic flyover of the start area ending
behind the player; finish = slow orbit.

### Input (`src/core/Input.js`)
Keyboard: accelerate W/↑, brake/reverse S/↓, steer A/D/←/→, drift Space or Shift, item E / J / X / L (no modifier keys — Ctrl combos trigger browser shortcuts),
look back Q / C, pause Esc / P; menus: arrows/WASD, Enter/Space confirm, Esc/Backspace back.
Gamepad (standard mapping): A accelerate, B brake, X/LB item, RB/RT drift, left stick/d-pad steer, Y look
back, Start pause; menus with d-pad/stick + A/B. API: `update()`, `getDriveControls()`,
`menuPressed(action)`, `anyPressed()`, `endFrame()`, `dispose()`, plus `lastDevice` ('keyboard'|'gamepad').

---------------------------------------------------------------------------------------------------------

## 8. Items (`src/entities/ItemSystem.js`, `src/race/Particles.js`, items agent)

`new ItemSystem({ scene, track, karts, particles, sfx, events, mode, rng })` with `update(dt, world)`,
`updateVisual(dt, alpha)`, `useItem(kart)`, `startRoulette(kart)`, `giveItem(kart, id)`,
`getThreatsFor(kart) → [{ kind, position, velocity, distance }]` (projectiles/hazards ahead, for AI dodging),
`dispose()`.
* **Item boxes** at `track.itemBoxSpots`: floating, spinning translucent rainbow cubes with a “?” and a small
  halo ring; driving through → burst + `itemBox` sfx, box respawns after 2.5 s (grow-in). Starts the roulette
  only if the kart has no item and no roulette running. Disabled in Time Trial (`mode === 'tt'`).
* **Roulette**: `kart.roulette = { active, time, duration, result }` — player 2.4 s, AI 1.2 s; result drawn
  from `ITEM_ODDS[kart.place-1]` when it starts (max one Blue Seeker / Shittim Tablet in play at a time).
  Pressing item after 0.7 s stops the roulette early. On completion: `kart.item = result`,
  `kart.itemUses = ITEMS[result].uses`, events `itemGet`, sfx `itemGet` (player).
* **Credits** at `track.coinSpots`: spinning gold coins, +1 on pickup (sfx `coin`), respawn after 12 s.
* Using items (sfx names in parentheses) — see `src/data/items.js`:
  - drink / drink3: `applyBoost(1.1)` (`boost`). card: `cardTime = 7`, every press during it boosts.
  - ramen / ramen3: dropped 2.5 behind; hold the item button to trail it behind (blocks one hit), release
    drops; with look-back held, toss it forward. Karts hitting it spin out (`ramenSplat`).
  - bullet / bullet3: fired forward at ~55 u/s (backward with look-back held), hugs the road, bounces off
    walls (reflect using the track frame), ≤ 5 bounces / 8 s; triple = 3 orbiting the kart that also block
    hits; hit → spinOut + lose 3 Credits (`fire`, `hit`).
  - missile / missile3: homes on the racer one place ahead (follows the track line, then steers in); if
    none ahead flies straight; hit → launch(0.8) (`fire`, `missileLock`).
  - grenade: lobbed forward in an arc, explodes on contact or 1.2 s after landing, radius 7 → launch (`throw`,
    `explosion`, camera shake nearby).
  - halo: `setInvincible(7.5)` + sparkles (`halo`).
  - tablet: every other vulnerable kart: drops its item, spins briefly and shrinks 4–8 s (longer the further
    ahead they are) (`tablet`, `shrink`). Blue screen flash.
  - seeker: flies high along the track to the leader (1st place), dives, explodes radius 9 → launch; if the
    user is the leader it still hits them (`seekerWarning` for the target).
  - credits: `addCoins(3)` (`credits`). decoy: fake box dropped behind; hitting it → launch(0.6) (`decoy`).
* Invincible karts destroy items they touch. Items hitting items destroy each other.
* When a kart is hit: `events.emit('hit', { victim, attacker, itemId })`; hits also make the victim lose
  3 Credits (dropped as scattering coins).
* Warnings: set `kart.incoming = [{ kind: 'missile'|'seeker', distance }]` on targeted karts each step
  (HUD shows alert icons).
* Particles: `new Particles(scene, { quality })`, `emit(type, position, { count, color, color2, velocity,
  spread, size, life })`, `update(dt, camera)`, `clear()`, `dispose()`. Types: spark, dust, smoke,
  boostFlame, explosion, confetti, coin, splash, snow, petal, ember, star, hitStars, itemBoxBurst, ring.
  Pooled (single draw call per blend mode), ≥ 4000 particles budget.

---------------------------------------------------------------------------------------------------------

## 9. AI (`src/entities/AIDriver.js`, ai agent)
`new AIDriver(kart, { track, skill (0..1), engine, personality: { lineOffset, aggression, driftiness } })`,
`update(dt, world) → DriveControls`, `reset()`.
Follows a precomputed racing line (cut corners toward the inside, stay inside the road, avoid void edges and
hazards), brakes/lifts only for hairpins, drifts through long corners and releases for mini-turbos (better
drivers reach orange/purple), hits dash panels and ramps (trick in the air), aims for item boxes when empty,
avoids ramen/decoys/grenades ahead (`items.getThreatsFor`), recovers from walls/spins/wrong way.
Item use: boosts on straights or to recover, projectiles when a target is ahead within ~35 u and aligned,
missiles when someone is ahead, drops ramen when a rival is close behind (or holds it behind as a shield when a
missile is incoming), halo/tablet/seeker/credits right away. Rubber-banding via `kart.topSpeedScale`:
behind the player → up to `1 + engine.aiRubberBand`, far ahead → down to `1 - engine.aiRubberBand/2`.
Lower skill → noisier lines, later braking, fewer drifts, slower reactions. Personalities make racers
distinct (Hina precise, Aru reckless, Hoshino lazy starts, Arisu aggressive with items...).
The AI also drives the player's kart when `autopilot` is on and after the player finishes.

---------------------------------------------------------------------------------------------------------

## 10. Race (`src/race/Race.js`, race agent)

```
new Race(game, { mode: 'gp'|'vs'|'tt', cc, trackId, playerCharacterId, rivalIds?, gridOrder?, laps?, autopilot? })
await race.load(onProgress)    race.start()    race.update(dt)    race.render(renderer)
race.pause()  race.resume()    race.restart()? (Game may simply recreate)    race.dispose()
race.getHudState()  race.getResults()  race.onFinish = (results) => {}  race.events  race.scene  race.camera
```
* Phases: `loading → intro → countdown → racing → finished`. Intro shows the track title card (HUD) during the
  camera flyover (skippable with confirm); countdown 3-2-1-GO drives `hud.countdown(n)`,
  `track.setStartLights`, `countdownBeep`/`countdownGo` sfx and lets karts rev (rocket start).
* Fixed 120 Hz steps: controls (player Input unless autopilot/finished → AI), item use on `itemPressed`,
  `kart.update`, collisions, `items.update`, progress/laps/places, wrong-way.
* Progress: `kart.progress += path.deltaD(proj.d, lastD)` (starts slightly negative on the grid); lap =
  floor(progress / length) + 1; a lap only counts if the kart has passed ≥ 50 % of the lap since the last
  line crossing (anti-cheat). Finish when progress ≥ laps × length.
* Player events → HUD + audio: `lapBanner` + `lap`/`finalLap` sfx, `audio.setMusicTempo(1.12)` on the final
  lap, place changes (`placeUp`/`placeDown`), hits (`hud.notify`, `hud.flash('hit')`, camera shake,
  `audio.voice(characterId, 'hit')`), item gets, wrong way, respawns.
* Music: `audio.playMusic(track.def.theme.music)` at countdown end; player engine via
  `audio.createEngine(characterId)` updated each frame; everything silenced on pause.
* Finish: `hud.finishBanner(place)`, `finish` sfx then `victory` (top 3) / `defeat` music, camera `finish`
  mode, AI drives the player, AI karts keep racing; after ~4.5 s call `onFinish(getResults())`.
* Results: `[{ id, characterId, name, place, isPlayer, time, finished, lapTimes, bestLap }]` sorted by place;
  unfinished karts get an estimated time and keep their current order.
* Time Trial: only the player, no item boxes, player gets `TIME_TRIAL_ITEM` (triple drink) at GO, HUD
  shows lap splits; best times in `localStorage['ssk.tt.<trackId>']`.
* Sound helper: `race.sfx(name, position, opts)` — full volume for the player's own sounds, distance
  attenuated for others (silent beyond ~60 u).
* Grid: slot 0 = pole. VS: player at the back. GP race 1: player at the back; later races: reverse standings
  (leader at the back) — Game passes `gridOrder`.
* `window.__ssk.race = race` for tools.

### HudState (returned by `race.getHudState()`)
```
{ mode, phase, time, countdown (seconds left | null), lap, laps, place, racerCount,
  coins, maxCoins, item: { id, uses, roulette (bool), rouletteProgress 0..1, cardTime },
  speed, topSpeed, boosting, drifting, driftLevel, wrongWay, finished, respawning, shrunk, invincible,
  incoming: [{ kind, distance }], lapTimes, lastLapTime, bestLapTime,
  racers: [{ id, characterId, name, place, isPlayer, x, y, z, yaw, finished, lap }]  // sorted by place
  player: { x, z, yaw } }
```

---------------------------------------------------------------------------------------------------------

## 11. HUD (`src/ui/HUD.js`, `src/styles/hud.css`, `src/ui/itemIcons.js`, hud agent)

```
new HUD(root, { racers: [{ id, characterId, name, isPlayer }], laps, track: { name, outline, bounds }, portraits, mode, settings })
show(), hide(), update(state, dt), countdown(n /* 3,2,1,0=GO */), lapBanner(lap, laps), finishBanner(place),
titleCard(name, subtitle) /* intro */, notify(text, { color, icon, duration }), flash(kind), dispose()
```
Layout inspired by **Mario Kart 8 Deluxe** (original art, not copied):
* **Top-left: item slot** — glossy circular bubble with thick white rim + translucent blue inner; slot-machine
  roulette animation (icons cycling fast, slowing down, landing with a pop); triple items show the count;
  Sensei's Card shows a draining ring timer.
* **Bottom-left: Credits counter** (coin icon + number, gold when maxed, bounce on pickup) and **lap counter**
  (big italic “2/3” with “LAP” label).
* **Bottom-right: position** — huge chunky italic place number + suffix (“1st”) with a colour gradient per
  place (1st gold, 2nd silver-blue, 3rd bronze, 4th+ progressively cooler colours), thick dark outline,
  bouncy scale animation when the place changes.
* **Right side: minimap** — track outline (thick, rounded) drawn on canvas, racer dots with portrait icons,
  player highlighted and on top; **left edge: ranking column** — portraits of all racers in order with the
  player's row highlighted (MK Wii/8DX style). `settings.hudMap`: 'both' | 'map' | 'ranks' | 'none'.
* **Top-right: race timer** `0'42"317`; lap split popup when a lap completes (always in Time Trial).
* **Centre: countdown** — giant bouncing “3”, “2”, “1”, “GO!” with a traffic-light widget (3 red lamps
  → all blue on GO) at top-centre; **LAP 2/3** and **FINAL LAP!** banners sliding in; **FINISH!** banner;
  **WRONG WAY** warning with a U-turn arrow; intro title card with the track name.
* Incoming-item alert (flashing icon above the item slot), speed lines vignette while boosting, blue tint
  when shrunk, golden rainbow border while invincible, red flash when hit, coin sparkle on pickup.
* Fonts: `var(--ssk-font-display)` (Lilita One) for numbers/banners, `var(--ssk-font-ui)` for text.
  Heavy outlines via `-webkit-text-stroke` / layered text-shadow. Scales with viewport (use `vmin`/`clamp`).
* `itemIconSVG(id)` / `itemIconURL(id)` / `coinIconSVG()` / `crystalIconSVG()` — hand-authored SVG icons
  for every item (energy-drink can, six-pack, gold card, ramen bowl, green round, red drone missile, grenade,
  glowing halo, tablet with Arona-blue screen, blue winged missile, credit bag, decoy box).

---------------------------------------------------------------------------------------------------------

## 12. Audio (`src/core/Audio.js`, audio agent) — all synthesized with Web Audio

```
new AudioManager(); unlock(); setVolumes({ master, music, sfx }); playMusic(key, { fadeIn }); setMusicTempo(mult);
stopMusic(fadeOut); sfx(name, { volume, pitch, pan }); createEngine(characterId) -> { update(speedNorm, throttle,
boosting, drifting), setVolume(v), stop() }; voice(characterId, 'select'|'hit'|'win'|'lose'|'item'); dispose()
```
Unknown names must be ignored silently. Safe before `unlock()` (no-ops).
**Music keys**: title, menu, charselect, results, victory, defeat, trophy, and track themes: abydos,
shibaseki, trinity, millennium, hyakkiyako, redwinter, gehenna, arona (+ any unknown key → a default race
theme). Original upbeat compositions (step sequencer: drums, bass, chords, lead, counter-melody), each
with its own key/tempo/scale/instrumentation; loopable; tempo multiplier for final lap.
**SFX names**: menuMove, menuSelect, menuBack, menuError, countdownBeep, countdownGo, itemBox, rouletteTick,
itemGet, itemUse, boost, boostPad, driftHop, driftStart, sparkBlue, sparkOrange, sparkPurple, miniTurbo,
jump, trick, land, wallBump, kartBump, hit, spin, launch, explosion, coin, credits, lap, finalLap, finish,
fire, throw, missileLock, seekerWarning, shrink, grow, halo, tablet, ramenSplat, decoy, fall, respawn,
wrongWay, placeUp, placeDown, rocketStart, stall, confetti, pause, unpause.

---------------------------------------------------------------------------------------------------------

## 13. Game & menus (`src/core/Game.js`, `src/ui/Menus.js`, frontend agent)

```
new Game({ container, hudRoot, menuRoot, overlayRoot }); await game.init({ quickRace })
game.renderer, game.input, game.audio, game.portraits, game.settings, game.hudRoot, game.menuRoot, game.overlayRoot
await game.startRace(opts)   game.saveSettings()   window.__ssk.game = game;  window.__ssk.fps (rolling fps)
```
* Owns the render loop (`renderer.setAnimationLoop`), `THREE.Timer`, input edge clearing, resize, and the
  current “screen” (title 3D scene, menu 3D preview scene, or Race).
* Screens: **Title** (big “SUPER SERIKA KART” logo with cat ears + halo, 3D Serika-in-kart hero scene, “Press
  Enter / Click”) → **Main menu** (Grand Prix, VS Race, Time Trial, Options, How to Play) → **Engine class**
  (50/100/150/200cc) → **Character select** (portrait grid, big 3D turntable preview of kart+driver, name,
  school, tagline, 5 stat bars) → **Cup select** (GP: Credit Cup / Pyroxene Cup with 4 track previews
  drawn from each track's outline) or **Track select** (VS/TT) → loading screen (tips) → Race →
  **Results** (MK-style board: place badges, portraits, names, times, GP points count-up) → GP standings →
  next race … → **Trophy ceremony** after race 4 (podium, trophy, confetti; gold/silver/bronze).
  VS results → Next track / Retry / Change character / Quit. TT results → time, lap splits, record.
* **Pause** (Esc/P or gamepad Start during a race): Resume / Restart / Quit (confirm); pauses audio.
* **Options**: master/music/sfx volume, graphics quality (high/medium/low), HUD map mode, controls reference;
  persisted in `localStorage['ssk.settings']`.
* All menus keyboard + mouse + gamepad navigable, with `menuMove`/`menuSelect`/`menuBack` sfx and music per
  screen. Polished, animated, BA-inspired UI (bright blue/white, halos, slanted panels, rounded display font).
* `quickRace` (from `/?quickrace=<track>&char=&cc=&mode=&laps=&autopilot=1`) skips menus straight into a race,
  and on finish shows the results screen.
* GP flow state: `{ cupId, cc, characterId, raceIndex, standings: { [characterId]: points } }`.

---------------------------------------------------------------------------------------------------------

## 14. Testing (`tools/shot.mjs`)

The dev server is already running on http://localhost:5173. Examples:
```
node tools/shot.mjs --url "/?scene=track&track=abydos-desert&view=orbit" --wait 5000 --out shots/world/abydos.png
node tools/shot.mjs --url "/?quickrace=test-oval&char=serika&autopilot=1&laps=1" --wait 15000 --shots 3 --interval 4000 --out shots/race/r.png
node tools/shot.mjs --url "/?scene=drive&track=test-oval" --hold "ArrowUp@500-9000,ArrowLeft@3000-4500,Space@3200-4400" --wait 9500 --out shots/physics/drift.png
node tools/shot.mjs --url "/?scene=hud" --eval "window.__ssk.hudState" --out shots/hud/hud.png
```
Options: `--keys "Enter@1500,..."` taps, `--hold "Key@start-end"` holds, `--click "x:y@ms"`, `--shots N
--interval ms`, `--width/--height`, `--eval "<js expr>"`, `--quiet`, `--swiftshader`.
It prints console warnings/errors and uncaught page errors (exit code 2). **Read the PNGs** with your
image-reading tool to check visuals. Uses the real GPU; screenshots take a few seconds.
Uncaught errors coming from files you do not own are probably another agent mid-edit — retry after a bit.

---------------------------------------------------------------------------------------------------------

## 15. Online, mobile & PWA

**Online** (`src/net/`, `src/ui/menu/screensOnline.js`): PeerJS star topology (host relays). Each client has
an ordered data channel (lobby, race control, items) and an unordered `state` channel for the 20 Hz kart
snapshots. Every online race belongs to a **tournament** of `settings.rounds` races (1 = single race):
GP_POINTS per race, keyed by a stable entry key (`p:<tab token>` for humans — the token lives in
sessionStorage, so a reload / dropped phone rejoins with its points — and `c:<charId>` for the fixed CPU
crew). Room phases: `lobby` → `race` → `results` (standings; the next race starts for everyone at
`nextAt`, or sooner when all humans are ready) → … → `lobby` when the tournament is over. Players joining
mid-race wait for the next race. Puppets render at an adaptive delay (measured lag + jitter per kart), and
item uses carry the sender's pose so replays spawn where the item was really used. Clients that lose the
host reconnect automatically once the page is visible again (`src/net/online.js`).

**Mobile**: `src/ui/TouchControls.js` (on-screen driving controls), `src/styles/mobile.css` (compact menu
layouts for short landscape screens, loaded after menus.css). Phones default to medium quality; during
races Game scales the render resolution down (to 0.5×) when the frame rate sags and back up when it
recovers (`setResolutionScale` in renderer.js). The first tap on the title enters fullscreen + landscape;
a screen wake lock is held while racing or in an online room.

**PWA**: `public/manifest.webmanifest` + `public/icons/*` (rendered from `icon.svg`). `src/pwa/sw.js` is a
template that the Vite plugin in `vite.config.js` turns into `dist/sw.js` with the build hash and every
JS/CSS chunk precached, so the whole game runs offline after the first visit (online play needs a network).
The service worker is registered in production builds only; `beforeinstallprompt` drives the title screen's
Install App button (iOS gets an "Add to Home Screen" hint).
