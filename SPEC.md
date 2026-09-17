# Bytegeist renderer — spec

## What this is

A single self-contained HTML file that renders an animated character as a field
of falling digits. Vertical, full-screen, designed for a phone in a stand.

The character is NOT displayed as an image. A source image is used only as a
**map** that the renderer samples. Falling digits change appearance as they pass
through the map, and the character appears because digits happen to be crossing
that region. He is a standing wave in falling data, not a picture.

## Source map convention

One PNG per state, all the same dimensions, all built the same way:

- Pure black background = empty space
- **Green** pixels = the body, head, face, hands
- **Pale blue-white** pixels = the lab coat and stethoscope
- Brightness within a region = density (bright = features, dim = edges)

Critical: hue carries *material*, brightness carries *density*. They are
separate channels and must not be conflated. A very bright green pixel is dense
body, not coat. Test hue first, then brightness.

## Core algorithm

1. Load the map into an offscreen canvas once at startup. Read its pixels into
   an ImageData buffer. Never draw this canvas to screen.
2. Maintain a set of falling digit columns. Each digit has x, y, speed, and a
   current glyph (0 or 1).
3. Each frame, for every digit: sample the map at its current x,y. Then:
   - **Black** — draw dim, small, low alpha. Falling through empty space.
   - **Green** — draw bright green, larger. Brighter and larger the brighter
     the sample. Slow the fall slightly.
   - **Blue-white** — draw pale blue-white, small, tightly packed, high alpha.
     Slow the fall a lot; coat digits should feel nearly stationary compared to
     the body.
4. Digits recycle to the top at randomised y and speed when they exit the
   bottom, so columns never fall into lockstep.
5. Fade rather than clear: each frame paint black over the canvas at low alpha
   (start around 0.09) instead of clearing it. Old digits decay over several
   frames, which produces the trailing smear. Lower value = longer tails.

The character is therefore always in motion even when the pose is unchanged,
because the digits composing him are different digits every frame.

## Avoid the stripe artifact

Evenly spaced columns of identical font size produce visible vertical bars. Add
jitter: vary glyph size per column, randomise x offsets slightly, vary speeds
widely, and leave some columns sparse or idle.

## States

Switching state = crossfading between two maps. Sample both and interpolate by
the transition progress, so digits re-form into the new shape as they fall.
Target around 600ms. This is the dissolve; no other transition is needed.

States: `idle`, `listening`, `thinking`, `explaining`, `smirk`.

Per-state global modifiers, not just a different map:
- `idle` — sparse, dim, slow fall, slow irregular blinks
- `listening` — digits slowed almost to a crawl, blinking stops. Stillness
  reads as attention.
- `thinking` — digits in the raised-hand region fall slower than elsewhere
- `explaining` — faster overall flow, hands drift continuously
- `smirk` — brief, 2-3 seconds, then auto-return to idle

## Blinking

A blink is a rectangular region of the map temporarily zeroed, so digits stop
assembling there for ~120ms and the eyes dissolve and re-form. Region
coordinates are per-map constants. Works in every state, needs no new art.

## Arm and hand motion

Regions of the *map* can be rotated or translated around a pivot before
sampling. Because the viewer never sees the map, the distortion this causes is
invisible — they only see digits arriving at different positions. This is why
warping works here and would not work on a photograph.

## Public API

The page exposes functions for the host app to call:

- `setState(name)` — crossfade to that state's map and apply its modifiers
- `flare()` — brief spike in brightness and fall speed, decaying over ~550ms.
  Use when a reply lands.

## Constraints

- One self-contained HTML file. Inline CSS and JS. Map images base64-embedded.
- No build step, no framework, no npm dependencies.
- No localStorage or sessionStorage.
- Must run at 60fps on a mid-range Android phone. Cap devicePixelRatio at 2.
  Profile before adding effects.
- Respect `prefers-reduced-motion`.
- Figure sits in the upper two-thirds; digits thin toward the bottom so app
  text can sit over the dark area.

## Build order

1. Digit rain with map sampling, one state, green and white separation working.
   Stop here and look at it on a phone before going further.
2. Jitter and tuning pass — density, speed, decay, glyph sizes.
3. Blinking.
4. Second map plus crossfade transition.
5. Remaining states.
6. Region warping for hand motion.

Do not skip ahead. Step 1 answers whether the whole concept works, and
everything after it is wasted effort if it doesn't.
