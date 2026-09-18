# Bytegeist renderer — spec

## What this is

A single self-contained HTML file (`index.html`, sourcing the shared map
payload from `map.js`) that renders an animated character as a field of
falling digits. Vertical, full-screen, designed for a phone in a stand.

The character is NOT displayed as an image. A source image is used only as a
**map** that the renderer samples. Falling digits change appearance as they
pass through the map, and the character appears because digits happen to be
crossing that region. He is a standing wave in falling data, not a picture.

Currently implemented: one static state (`idle`), no crossfade, no blinking,
no arm/hand warping. See "What's not built yet" below.

## Source map convention

One PNG per state, all the same dimensions, all built the same way:

- Pure black background = empty space
- **Green** pixels = the body, head, face, hands
- **Pale blue-white** pixels = the lab coat and stethoscope
- Brightness within a region = density (bright = features, dim = edges)

Critical: hue carries *material*, brightness carries *density*. They are
separate channels and must not be conflated. A very bright green pixel is
dense body, not coat. Test hue first, then brightness.

## Architecture: two canvases

- **`mapCanvas`** (bottom) — the source map, alpha-adjusted, drawn once per
  load/resize/`rebuildMap()`. Never touched inside the animation loop.
- **`rainCanvas`** (top, transparent) — the animated digits and their
  trailing fade. This is the only canvas the render loop draws to.

The map is never sampled live from its own pixels during the render loop.
Instead it's classified once (at load, or on `rebuildMap()`) into typed
lookup arrays (`typeArr`, `bucketArr`, `outlineArr`), and `sample(x, y)`
reads those arrays each frame. This trades a one-time classification pass
for a cheap per-frame lookup. Density overrides for specific regions (head,
hands) are handled separately, live, via `CFG.ZONES` — see below.

## Core algorithm

1. Load the map into an offscreen analysis canvas once at startup. Classify
   every pixel into black / green / coat, a body-vs-halo brightness bucket,
   and a silhouette-outline flag. Store these as flat `Uint8Array`s the same
   size as the map, not a `getImageData` re-read per frame.
2. Build a static, alpha-adjusted display copy of the map from the same
   classification (body-bucket pixels solid, halo-bucket pixels dim, black
   transparent) and draw it once to `mapCanvas`.
3. Maintain a set of falling digit columns. Each digit has `x`, `y`, `speed`,
   `gap`, and a current glyph (`0`/`1`) that flips on its own randomised
   timer independent of position.
4. Each frame, for every digit: sample the map's classification at the
   digit's current `(x, y)` by averaging an `N`×`N` patch of native map
   pixels (`SAMPLE_PATCH_RADIUS`), not a single nearest pixel — painted
   artwork has 1px-wide dark dips from folds/shading/antialiasing, and a
   fixed pixel column can land on one for the digit's whole lifetime. Patch
   averaging fixes that; re-randomising `x` on recycle doesn't (confirmed
   with `debugColumns()`).
   - **Black** (or off the letterboxed map rect entirely) — dim background
     rain (`COLOR_BG` at `BG_ALPHA`).
   - **Non-black** — snaps straight to full brightness, no ramp: green for
     body/skin, near-white or blue depending on brightness bucket for the
     coat.
   - **Zones** — if the sample is `TYPE_GREEN` and the digit's map-normalized
     position falls inside a `CFG.ZONES` rectangle, it's thinned to that
     zone's `density` (lowest, if it's inside more than one). Coat pixels are
     never affected by zones, even inside a zone rectangle — see "Hand/head
     zones" below.
5. Digits recycle to the top at randomised `y` and `speed` when they exit the
   bottom, so columns never fall into lockstep.
6. Fade via `destination-out` on the rain canvas each frame
   (`rgba(0,0,0,FADE)`) instead of clearing or painting black — this erases
   old digits toward transparent without darkening the static map canvas
   underneath, which a plain black overpaint would do since the two canvases
   are separate layers.

The character is therefore always in motion even when the pose is unchanged,
because the digits composing him are different digits every frame.

## Avoid the stripe artifact

Evenly spaced columns of identical font size produce visible vertical bars.
Jitter is applied per column: randomised `x` offset within its pitch slot,
randomised stream length and speed, and streams spread to roughly span the
screen height regardless of digit count (`gap` computed from a randomised
target span, not fixed glyph spacing) so short streams don't clump instead of
trailing.

## Hand/head zones

Density over the head and hands is controlled by `CFG.ZONES`: explicit
rectangles in map-normalized coordinates (0–1 relative to the map image's
own width/height, not the screen), each with a `density` multiplier. This
replaced an earlier approach (`headHandArr`) that derived a single "head"
zone from the top fraction of the green pixels' vertical span
(`HEAD_HAND_HEIGHT_FRACTION`) — it only ever covered the head, never the
hands, despite the name, since the hands typically sit well below that
fraction of the figure's green span.

Rules:
- A pixel counts as "inside" a zone only if it's within the rectangle *and*
  classified `TYPE_GREEN`. Coat pixels inside a zone rectangle are
  unaffected — this is what lets the rectangles be drawn crude (e.g.
  overlapping the coat sleeve) without over-thinning the coat.
- Where zones overlap, the lowest `density` applies.
- Zones are evaluated live, per digit, per frame, directly against
  `CFG.ZONES` — no `rebuildMap()` or `initDigits()` needed after editing a
  rectangle or density value.
- `CFG.SHOW_ZONES` (default `false`) draws each zone rectangle as a thin
  outline on the rain canvas, for positioning them by eye from the console.

Default zones: one over the head, one over each hand, all at density `0.5`.

## Approaches tried and rejected

- **Pure digit reconstruction** (rendering the figure entirely as
  crisply-spaced digits with no other cue) hits a resolution floor set by
  the source artwork itself: the map's painted detail (facial features,
  fold shading) is finer than a legible glyph grid can reproduce at
  phone-viewing distance, so fine detail was either invisible or forced the
  glyph grid so fine it stopped reading as digit rain.
- **Freeze mechanic** (locking digits in place once they land on a
  figure pixel, instead of letting them keep falling and recycling) was
  tried to make the pose read more clearly. It backfired: frozen digits
  clump wherever the fall happened to deposit them rather than tracing the
  actual shape, and that clumping is worst exactly where precision matters
  most — it destroys facial features first.
- **Outline mask via naive "has a black neighbour" test** was tried to draw
  a crisp silhouette edge. It fails on this art style specifically because
  the source is individually separated digit-glyph shapes with black gaps
  between them — nearly every non-black pixel has a black neighbour, so the
  test flags almost the whole figure as "outline," not its silhouette. The
  current `computeOutline()` fixes this (dilate the non-black mask to close
  the inter-glyph gaps, keep only the largest connected blob, flood-fill the
  true exterior from the image border, take the blob/exterior boundary as
  the edge — see `OUTLINE_DILATE_RADIUS` below) but the resulting
  outline-crossing highlight is still **off by default**
  (`OUTLINE_ENABLED: false`) pending a tuning pass.
- **Independent per-column random culling** (each column independently
  rolling to be skipped, to thin density) was rejected because independent
  coin flips produce long runs of consecutive skipped columns purely by
  chance — wide, visible dead vertical strips with nothing falling in them.
  Confirmed with `debugColumns()`. The current fallback (see
  `MAX_CONSECUTIVE_CULLED_COLUMNS` below) only culls at all when density is
  so sparse that even one digit per column overshoots the target, and even
  then a forced-activation counter caps how many consecutive columns can be
  dropped — no unbounded dead strips.

## CFG reference

Every tunable lives in the `CFG` object in `index.html` and is read as
`CFG.X` at the point of use, not copied into a local at startup — most
values can be changed live from the console with no reload. Three
categories, by how a change actually takes effect:

**Live — takes effect on the next rendered frame:**
- `OUTLINE_ENABLED`, `BG_ALPHA`, `FIGURE_ALPHA`, `FADE`, `SAMPLE_PATCH_RADIUS`
- `COLOR_BG`, `COLOR_GREEN`, `COLOR_COAT_BODY`, `COLOR_COAT_HALO`,
  `COLOR_OUTLINE`
- `ZONES`, `SHOW_ZONES` — read per-digit, per-frame in `drawDigits()`; edit
  rectangle coordinates or densities from the console with no rebuild.
- `SPEED_MIN` / `SPEED_MAX` — read whenever a digit is created or recycles,
  so a change phases in gradually as existing digits cycle rather than
  applying to everything at once.
- `GLYPH_SIZE` — glyph *render* size updates next frame; it also feeds
  column pitch/count in `initDigits()`, so a size change doesn't rebalance
  column layout until the next resize/`initDigits()`.

**Structural — only takes effect on the next `initDigits()` (a resize, or
call `window.resize()` to force one):**
- `STREAM_LEN_MIN`, `STREAM_LEN_MAX` — stream length range and, in the rare
  culling fallback, used directly as the per-column length.
- `TARGET_FIGURE_GLYPHS` — average glyphs wanted sitting on the figure at
  once; drives the total digit count and per-column share.
- `MAX_CONSECUTIVE_CULLED_COLUMNS` — culling-fallback cap only; irrelevant
  when density doesn't trigger culling.
- `MAX_DPR` — devicePixelRatio cap, applied on the next resize.
- `FIGURE_SCALE`, `FIGURE_MARGIN`, `FIGURE_ANCHOR_Y` — figure letterbox
  layout, recomputed in `computeLayout()` which only runs on
  load/resize/`rebuildMap()`.

**Needs `rebuildMap()`** (also exposed on `window`) — baked once into
per-pixel classification lookup tables for performance:
- `BLACK_LUM_THRESHOLD`, `COAT_SAT_THRESHOLD`, `BODY_BRIGHTNESS_THRESHOLD`
- `OUTLINE_DILATE_RADIUS` — map-px radius that closes the inter-glyph black
  gaps before tracing the silhouette (see "outline mask" above). Needs to
  bridge glyph gaps without padding the true outer silhouette outward; does
  not need to bridge large intentional dark regions (e.g. the coat's open
  front), since those become correctly-excluded interior holes either way.
- `IMG_ALPHA_BODY`, `IMG_ALPHA_HALO` — static map-canvas opacity per bucket.

## What's not built yet

Per the original build order, still outstanding:
- Blinking (rectangular region of the map temporarily zeroed)
- A second map plus crossfade transition between states
- The remaining states (`listening`, `thinking`, `explaining`, `smirk`) and
  their per-state modifiers (fall speed, blink behaviour, hand-region
  slowdown)
- Region warping for arm/hand motion
- The public API (`setState(name)`, `flare()`) — not present in `index.html`
  today. `bytegeist_v1.html` (an earlier, single-canvas version kept for
  reference) has stub versions of both that do nothing.

The debug-only `window.debugColumns(N)` and `window.rebuildMap()` helpers
are present and documented inline in `index.html`.

## Public API (target)

Once built, the page should expose:

- `setState(name)` — crossfade to that state's map and apply its modifiers
- `flare()` — brief spike in brightness and fall speed, decaying over ~550ms.
  Use when a reply lands.

## Blinking (target)

A blink is a rectangular region of the map temporarily zeroed, so digits stop
assembling there for ~120ms and the eyes dissolve and re-form. Region
coordinates are per-map constants. Works in every state, needs no new art.

## Arm and hand motion (target)

Regions of the *map* can be rotated or translated around a pivot before
sampling. Because the viewer never sees the map, the distortion this causes
is invisible — they only see digits arriving at different positions. This is
why warping works here and would not work on a photograph.

## Constraints

- One self-contained HTML file. Inline CSS and JS. Map images base64-embedded
  (in `map.js`, loaded via a `<script>` tag).
- No build step, no framework, no npm dependencies.
- No localStorage or sessionStorage.
- Must run at 60fps on a mid-range Android phone. Cap devicePixelRatio at 2
  (`MAX_DPR`). Profile before adding effects.
- Respect `prefers-reduced-motion` (renders a static frame instead of
  looping).
- Figure sits per `FIGURE_ANCHOR_Y`/`FIGURE_MARGIN`/`FIGURE_SCALE`; digits
  thin over the head/hand `ZONES` so facial detail isn't buried, and the
  lower portion stays sparse enough for app text to sit over the dark area.

## Build order status

1. ✅ Digit rain with map sampling, one state, green/coat separation working.
2. ✅ Jitter and tuning pass — density, speed, decay, patch sampling,
   layout controls. Ongoing as issues surface (see rejected approaches).
3. ⬜ Blinking.
4. ⬜ Second map plus crossfade transition.
5. ⬜ Remaining states.
6. ⬜ Region warping for hand motion.

Do not skip ahead past an unchecked step without a reason recorded here —
step 1 answered whether the whole concept works, and each later step's
approach has already cost a rejected attempt or two (see above).
