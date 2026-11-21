# Logos — Rotating Halftone Classical Bust & 3D Particle Simulation (`logos-bust`)

## 1. Reference Video Analysis (`00:00`–`00:06`)

- **Palette & Atmosphere**: Matte Pompeian terracotta red background (`#972212`), warm ivory foreground (`#F3EAE0`), muted ivory secondary copy (`rgba(243, 234, 224, 0.84)`), and small amber telemetry markers (`#E5A23C`, `5px × 5px`).
- **Composition**: Single-screen `100vw × 100vh` locked viewport with a centered 3D bearded classical philosopher bust extending off the bottom edge, framed cleanly below the top navigation bar and between left/right editorial typography (`Thought that lasts.` / `Reason to endure`), lower-left manifesto copy, and three telemetry callouts (`2400+`, `11,450+`, `48.2K`).
- **Motion & Interaction**:
  - **Turntable rotation**: Constant single-axis Y rotation (`0.48 rad/s`, ~27.5°/s) independent of mouse sweeps (`00:00` front → `00:02` 3/4 → `00:06` rear).
  - **Rest state**: Screen-space coarse halftone square/dot matrix aligned strictly to the bust alpha silhouette with zero stray background noise.
  - **Hover 3D particle burst & healing**: Sweeping across the bust dislodges surface particles in 3D space with cursor tangential momentum, outward normal lift, radial splash, and 3D Curl Noise turbulence—allowing rim particles to burst outside the sculpture silhouette while remaining anchored to the rotating 3D head—before spring-damper forces pull particles back and regrow the halftone matrix over ~2 seconds.

## 2. Architecture & Files

| File | Responsibility |
|---|---|
| `index.html` | Semantic HUD markup (`Logos`, 4 nav triggers, `SIGN IN`, mobile menu, left/right hero titles, subcopy, 3 callouts, modal/sign-in dialog) + importmap for local `three`. |
| `styles.css` | Self-hosted `@font-face` rules, terracotta/ivory design tokens, `[hidden]` override, `<button>` resets, responsive desktop/tablet/mobile rules (`<= 1024px`, `<= 768px`). |
| `src/glyph-atlas.js` | Generates a `768×64` 12-level geometric halftone matrix atlas (`0` empty → `1..11` progressively denser micro-dots, colons, squares, pluses, `2×2` tiles, and notched/guttered blocks). |
| `src/scene.js` | Loads `./assets/bust.glb`, normalizes scale/centering, renders studio 3-point + hemisphere marble shading into an RGBA `WebGLRenderTarget`, and provides depth-only occlusion passes (`renderDepthOnly`) for the 3D particle layers. |
| `src/particles.js` | Area-weighted surface sampler (`256×256` = `65,536` particles) + WebGL2 Float/HalfFloat GPGPU ping-pong simulation (`velMat` + `posMat` with 3D Curl Noise, speed-aware 3D noise-modulated brush, and critically-damped spring-damper recovery), depth-occluded 3D energy splat (`energyTarget`), and foreground 3D `THREE.Points` rendering with saturated Pompeian vermilion + sparse ivory highlights. |
| `src/post-shader.js` | Fullscreen composite GLSL pass combining offscreen bust luminance + Bayer 4×4 dithering + glyph atlas; shrinks halftone cells smoothly where `energyTarget` > 0 and exposes a granular matte terracotta-crimson dust substrate underneath the foreground 3D particle cloud (`#include <colorspace_fragment>`). |
| `src/main.js` | Lifecycle wiring, `document.fonts.ready` gating, NDC `pointermove`/`pointerdown`/`pointerleave` tracking, `prefers-reduced-motion` pause, modal/form interactions, and `window.__LOGOS_DEBUG__`. |
| `serve.mjs` | Zero-dependency Node HTTP server on `127.0.0.1` (`PORT || 5188`) with strict path containment and MIME types (`.glb`, `.woff2`, `.js`, etc.). |
| `scripts/verify.mjs` & `scripts/verify_browser.py` | Syntax, asset, and headless Chromium WebGL2 verification suite. |

## 3. Asset Provenance & Licenses

- **3D Sculpture (`assets/bust.glb`)**:
  - Source: Statens Museum for Kunst (SMK Open API), artwork `KAS979` (*Portræt af Marcus Aurelius*, emperor 161–180 AD).
  - Source file URL: `https://api.smk.dk/api/v1/download-3d/jh343z07p_KAS979_small.stl`
  - License: **Public Domain Mark 1.0** (`https://creativecommons.org/publicdomain/mark/1.0/`).
  - Local processing: Axis-aligned (`+Y` up, `+Z` front, `det = +1.0`), bottom pedestal/lower chest cropped (`crop_bottom = 0.22`), voxel-clustered and exported as binary glTF 2.0 (`2,049,464` bytes, `56,815` vertices, `114,174` triangles, `uint16` indices).
- **Fonts (`assets/fonts/*.woff2`)**:
  - Source: Fontsource CDN (`inter@latest` 400/500/600 and `ibm-plex-mono@latest` 400/500 latin WOFF2 subsets), downloaded locally for offline determinism.
  - License: **SIL Open Font License 1.1**.
- **3D Engine (`three@0.170.0`)**:
  - Installed via `pnpm` (`package.json` / `pnpm-lock.yaml`).
  - License: **MIT**.

## 4. Intentional Adaptations & Assumptions

- **Telemetry micro-copy**: Because the tiny uppercase telemetry captions in the reference video were slightly compressed, `2400+ / YEARS OF CURIOSITY`, `11,450+ / ARGUMENTS MAPPED`, and `48.2K / QUESTIONS ANSWERED` match the legible phrases and visual rhythm of the layout.
- **Navigation & `SIGN IN` interactions**: Instead of dead buttons, clicking `PRODUCT`, `RESOURCES`, `BLOG`, `PRICING`, or `SIGN IN` opens a matching editorial modal (with `Esc`/backdrop dismissal, focus restoration, and client-side sign-in form validation); clicking `Logos` resets bust angle and particle state.
- **Responsive mobile layout (`<= 768px`)**: On narrow portrait viewports (`390×844`), desktop top-nav links collapse into a `MENU` toggle drawer, telemetry callouts hide to preserve clean canvas negative space, and `Reason to endure` shifts to upper-right above the bust head to prevent overlapping bright bust cells.

## 5. Verification Results

### Automated Checks (`pnpm verify`, run after final code/style edits)
- **Syntax**: `node --check` passed on all 7 JS modules (`serve.mjs`, `scripts/verify.mjs`, `src/*.js`).
- **Asset Integrity**: Verified all 8 required local assets (`index.html`, `styles.css`, `assets/bust.glb`, 5 × `assets/fonts/*.woff2`).
- **Headless Chromium + SwiftShader WebGL2 (`1440×900`, `1280×720`, `768×1024`, `390×844`)**:
  - `particleMode: "gpgpu"`, `particleCount: 65536`.
  - Zero console errors, zero uncaught page errors, zero HTTP `>= 400` responses, and zero external network requests.
  - `document.fonts.check` passed for `Inter` (400/500/600) and `IBM Plex Mono` (400/500).
  - Background terracotta RGB verified (`[151.5, 35.2, 19.2]`); center bust highlight cream ratio `0.300`.
  - Real `page.mouse.move` sweep across face ROI produced `50.04` mean pixel delta (`lum 125.7 -> 86.6`), healing back to `0.06` residual delta after `150` frames (`2.5s` simulated 60fps).
  - 3D surface-lock rotation check (`+0.55 rad`) confirmed disturbed particles co-rotate with the 3D bust (`co_move_delta = 6.34` in the rotated facial zone vs unperturbed reference).
  - Interactive modal open/close (`Esc`), `SIGN IN` form feedback, focus restoration to trigger, and mobile `#menu-toggle` drawer toggling verified.
  - `scrollWidth === innerWidth` and zero HUD bounding-box overlaps verified across `1440×900`, `1280×720`, `768×1024`, and `390×844`.

### Visual Review (`test-results/*.png`)
- **Inspected**: `rest-0deg.png`, `sweep-face.png`, `sweep-rotated.png`, `sweep-edge.png`, `sweep-back.png`, `healed.png`, `mobile-390.png` (and `rotated-45deg.png`, `rotated-165deg.png`, `modal-signin.png` layout structure).
- **Observations**:
  - Rest state (`rest-0deg.png`) shows refined geometric halftone shading across eyes, brow ridge, nose, beard, and curly locks without harsh ASCII glyph clutter.
  - Swept states (`sweep-face.png`, `sweep-edge.png`, `sweep-back.png`) show organic 3D particle bursting along curl contours and out past the silhouette edge in rich saturated vermilion/terracotta tones with sparse ivory dust—no smooth clay skin, no gray-pink muddiness, and no straight 2D capsule edges.
  - Rotated state (`sweep-rotated.png`) confirms the particle cloud travels with the turning 3D sculpture; healed state (`healed.png`) restores the crisp halftone grid cleanly (`0.06` residual).
  - Mobile (`mobile-390.png`) displays a crisp rest-state `MENU` button and legible stacked headlines above the bust without text-on-bust overlap.
- **Not verified in this environment**: Real mobile touch drag/GPU performance on physical phones and native hardware GPUs outside headless Chromium SwiftShader.

## 6. Run Locally

```powershell
cd D:\code\frontend-test\logos-bust
pnpm install
pnpm start
```

Open `http://127.0.0.1:5188/` in a WebGL2-capable browser.
