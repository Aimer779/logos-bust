import sys
from pathlib import Path
from urllib.parse import urlparse
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18188/"
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "test-results"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def assert_rect_ok(rects, a, b):
    ra, rb = rects[a], rects[b]
    if not ra or not rb:
        return
    overlap_x = min(ra["right"], rb["right"]) - max(ra["left"], rb["left"])
    overlap_y = min(ra["bottom"], rb["bottom"]) - max(ra["top"], rb["top"])
    if overlap_x > 2 and overlap_y > 2:
        raise AssertionError(f"Layout overlap between '{a}' {ra} and '{b}' {rb}")


def collect_rects(page):
    return page.evaluate("""() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
      };
      return {
        brand: pick('#brand-reset'),
        nav: pick('.top-nav'),
        signin: pick('.topbar-actions .sign-in-btn'),
        menuToggle: pick('#menu-toggle'),
        titleLeft: pick('.hero-title--left'),
        titleRight: pick('.hero-title--right'),
        subcopy: pick('.hero-subcopy'),
        calloutLeft: pick('.callout--left'),
        calloutTopRight: pick('.callout--top-right'),
        calloutMidRight: pick('.callout--mid-right'),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
      };
    }""")


def main():
    console_errors = []
    page_errors = []
    bad_responses = []
    external_requests = []

    launch_args = [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
    ]

    with sync_playwright() as p:
        ms_pw = Path.home() / "AppData" / "Local" / "ms-playwright"
        exe_candidates = sorted(
            ms_pw.glob("chromium_headless_shell-*/chrome-headless-shell-win64/chrome-headless-shell.exe"),
            reverse=True,
        )
        launch_kw = {"headless": True, "args": launch_args}
        if exe_candidates:
            launch_kw["executable_path"] = str(exe_candidates[0])
        browser = p.chromium.launch(**launch_kw)
        context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page = context.new_page()

        def on_console(msg):
            if msg.type in ("error", "warning"):
                print(f"[browser {msg.type}] {msg.text}")
            if msg.type == "error":
                console_errors.append(msg.text)

        def on_pageerror(err):
            print(f"[pageerror] {err}")
            page_errors.append(str(err))

        def on_response(resp):
            if resp.status >= 400:
                bad_responses.append(f"{resp.status} {resp.url}")

        def on_request(req):
            parsed = urlparse(req.url)
            if parsed.scheme in ("http", "https") and parsed.hostname not in ("127.0.0.1", "localhost"):
                external_requests.append(req.url)

        page.on("console", on_console)
        page.on("pageerror", on_pageerror)
        page.on("response", on_response)
        page.on("request", on_request)

        page.goto(BASE_URL, wait_until="networkidle")
        page.wait_for_function("() => window.__LOGOS_DEBUG__ && window.__LOGOS_DEBUG__.getState().loaded === true", timeout=20000)

        debug_state = page.evaluate("() => window.__LOGOS_DEBUG__.getState()")
        print("Debug state:", debug_state)
        if debug_state.get("particleMode") != "gpgpu" or debug_state.get("particleCount") != 65536:
            raise AssertionError(f"Expected gpgpu with 65536 particles, got: {debug_state}")

        font_status = page.evaluate("""async () => {
          await document.fonts.ready;
          return {
            inter400: document.fonts.check('400 16px Inter'),
            inter500: document.fonts.check('500 64px Inter'),
            inter600: document.fonts.check('600 18px Inter'),
            mono400: document.fonts.check('400 11px "IBM Plex Mono"'),
            mono500: document.fonts.check('500 11px "IBM Plex Mono"'),
          };
        }""")
        print("Font check:", font_status)
        for k, ok in font_status.items():
            if not ok:
                raise AssertionError(f"Font did not load: {k}")

        # Freeze at 0 deg and capture clean rest state
        page.evaluate("""() => {
          window.__LOGOS_DEBUG__.setAutoRotate(false);
          window.__LOGOS_DEBUG__.setAngle(0);
          window.__LOGOS_DEBUG__.clearTrail();
          window.__LOGOS_DEBUG__.renderFrames(2);
        }""")
        rest_path = OUT_DIR / "rest-0deg.png"
        page.screenshot(path=str(rest_path))

        rest_arr = np.asarray(Image.open(rest_path).convert("RGB"), dtype=np.float32)
        bg_patch = rest_arr[120:220, 1280:1400]
        center_patch = rest_arr[220:680, 520:920]
        bg_mean = bg_patch.mean(axis=(0, 1))
        bright_mask = (center_patch[:, :, 0] > 195) & (center_patch[:, :, 1] > 180) & (center_patch[:, :, 2] > 165)
        bright_ratio = float(bright_mask.mean())
        print(f"Rest bg mean RGB={bg_mean.round(1)}, center bright cream ratio={bright_ratio:.3f}")
        if not (bg_mean[0] > 120 and bg_mean[1] < 55 and bg_mean[2] < 35):
            raise AssertionError(f"Unexpected terracotta background RGB: {bg_mean}")
        if bright_ratio < 0.08:
            raise AssertionError(f"Bust halftone highlights missing or too dim (ratio={bright_ratio:.3f})")

        # Capture clean rotated views (~45 deg and ~165 deg)
        page.evaluate("""() => {
          window.__LOGOS_DEBUG__.setAngle(0.785);
          window.__LOGOS_DEBUG__.clearTrail();
          window.__LOGOS_DEBUG__.renderFrames(2);
        }""")
        page.screenshot(path=str(OUT_DIR / "rotated-45deg.png"))

        page.evaluate("""() => {
          window.__LOGOS_DEBUG__.setAngle(2.88);
          window.__LOGOS_DEBUG__.clearTrail();
          window.__LOGOS_DEBUG__.renderFrames(2);
        }""")
        page.screenshot(path=str(OUT_DIR / "rotated-165deg.png"))

        # Sweep across back of head (matching 00:05)
        page.mouse.move(480, 390)
        for x in range(500, 960, 28):
            page.mouse.move(x, 385 + (x % 3))
            page.evaluate("() => window.__LOGOS_DEBUG__.renderFrames(1, 1/60)")
        page.screenshot(path=str(OUT_DIR / "sweep-back.png"))

        # Sweep across left rim/edge of head at ~95 deg to inspect silhouette outward burst (00:04)
        page.evaluate("""() => {
          window.__LOGOS_DEBUG__.setAngle(1.65);
          window.__LOGOS_DEBUG__.clearTrail();
          window.__LOGOS_DEBUG__.renderFrames(2);
        }""")
        page.mouse.move(505, 290)
        for step in range(10):
            page.mouse.move(520 + (step % 3) * 14, 295 + step * 16)
            page.evaluate("() => window.__LOGOS_DEBUG__.renderFrames(1, 1/60)")
        page.screenshot(path=str(OUT_DIR / "sweep-edge.png"))

        # Reset to 0 deg, sweep face, verify pixel delta + 3D rotation co-movement + 2.4s healing
        page.evaluate("""() => {
          window.__LOGOS_DEBUG__.setAngle(0);
          window.__LOGOS_DEBUG__.clearTrail();
          window.__LOGOS_DEBUG__.renderFrames(2);
        }""")
        page.mouse.move(900, 290)
        for step in range(14):
            tx = 840 - step * 18
            ty = 315 + step * 6
            page.mouse.move(tx, ty)
            page.evaluate("() => window.__LOGOS_DEBUG__.renderFrames(1, 1/60)")
        sweep_path = OUT_DIR / "sweep-face.png"
        page.screenshot(path=str(sweep_path))

        sweep_arr = np.asarray(Image.open(sweep_path).convert("RGB"), dtype=np.float32)
        roi_rest = rest_arr[260:470, 560:860]
        roi_sweep = sweep_arr[260:470, 560:860]
        diff_sweep = float(np.abs(roi_sweep - roi_rest).mean())
        lum_rest = float(roi_rest.mean())
        lum_sweep = float(roi_sweep.mean())
        print(f"Face ROI sweep delta={diff_sweep:.2f}, lum rest={lum_rest:.1f} -> sweep={lum_sweep:.1f}")
        if diff_sweep < 5.5 or lum_sweep >= lum_rest - 1.5:
            raise AssertionError(f"Pointer sweep did not produce expected 3D particle erosion (delta={diff_sweep:.2f}, lum {lum_rest:.1f}->{lum_sweep:.1f})")

        # Verify 3D surface lock: rotate bust +0.55 rad (~31.5 deg) and compare against clean rotated reference
        page.evaluate("""() => {
          window.__LOGOS_DEBUG__.setAngle(0.55);
          window.__LOGOS_DEBUG__.renderFrames(2, 1/60);
        }""")
        rot_sweep_path = OUT_DIR / "sweep-rotated.png"
        page.screenshot(path=str(rot_sweep_path))
        rot_sweep_arr = np.asarray(Image.open(rot_sweep_path).convert("RGB"), dtype=np.float32)

        # Move pointer to right negative space (away from bust) and simulate 2.5s of 60fps healing
        page.mouse.move(1220, 220)
        healed_path = OUT_DIR / "healed.png"
        page.evaluate("""() => {
          window.__LOGOS_DEBUG__.setAngle(0);
          window.__LOGOS_DEBUG__.renderFrames(150, 1/60);
        }""")
        page.screenshot(path=str(healed_path))
        healed_arr = np.asarray(Image.open(healed_path).convert("RGB"), dtype=np.float32)
        diff_healed = float(np.abs(healed_arr[260:470, 560:860] - roi_rest).mean())
        print(f"Face ROI healed residual delta={diff_healed:.2f} (vs sweep {diff_sweep:.2f})")
        if diff_healed > diff_sweep * 0.15:
            raise AssertionError(f"3D particles did not heal sufficiently over 2.5s (healed={diff_healed:.2f}, sweep={diff_sweep:.2f})")

        # Clean unperturbed reference at +0.55 rad to prove sweep-rotated.png moved particles with bust
        page.evaluate("""() => {
          window.__LOGOS_DEBUG__.setAngle(0.55);
          window.__LOGOS_DEBUG__.clearTrail();
          window.__LOGOS_DEBUG__.renderFrames(2, 1/60);
        }""")
        rot_clean_bytes = page.screenshot()
        from io import BytesIO
        rot_clean_arr = np.asarray(Image.open(BytesIO(rot_clean_bytes)).convert("RGB"), dtype=np.float32)
        # Check right-shifted face zone (x=760..920) where rotated front face points
        co_move_delta = float(np.abs(rot_sweep_arr[250:470, 720:910] - rot_clean_arr[250:470, 720:910]).mean())
        print(f"3D rotation co-movement delta (x=720..910 @ 0.55 rad)={co_move_delta:.2f}")
        if co_move_delta < 4.0:
            raise AssertionError(f"Disturbed particles did not rotate with 3D bust (delta={co_move_delta:.2f})")

        # Interactive modal & keyboard test
        page.evaluate("() => window.__LOGOS_DEBUG__.setAngle(0)")
        page.click('[data-panel="product"]')
        page.wait_for_selector('#info-modal:not([hidden])')
        page.keyboard.press("Escape")
        page.wait_for_selector('#info-modal[hidden]', state="attached")

        page.click('.topbar-actions [data-panel="signin"]')
        page.wait_for_selector('#info-modal:not([hidden])')
        page.fill('#signin-email', 'marcus@logos.study')
        page.fill('#signin-code', 'stoic2400')
        page.click('.submit-btn')
        status_txt = page.text_content('#signin-status')
        if "marcus@logos.study" not in status_txt:
            raise AssertionError(f"Sign-in form feedback failed: {status_txt}")
        page.screenshot(path=str(OUT_DIR / "modal-signin.png"))
        page.click('#modal-close')
        page.wait_for_selector('#info-modal[hidden]', state="attached")
        focused_panel = page.evaluate("() => document.activeElement?.dataset?.panel || ''")
        if focused_panel != "signin":
            raise AssertionError(f"Focus was not restored to SIGN IN trigger (got '{focused_panel}')")

        # Multi-viewport layout & overflow verification
        for vw, vh, label in [(1440, 900, "desktop-1440"), (1280, 720, "laptop-1280"), (768, 1024, "tablet-768"), (390, 844, "mobile-390")]:
            page.set_viewport_size({"width": vw, "height": vh})
            page.evaluate("() => window.__LOGOS_DEBUG__.clearTrail()")
            page.wait_for_timeout(180)
            rects = collect_rects(page)
            if rects["scrollWidth"] != rects["innerWidth"]:
                raise AssertionError(f"{label}: horizontal overflow scrollWidth={rects['scrollWidth']} != innerWidth={rects['innerWidth']}")
            if rects["scrollHeight"] > rects["innerHeight"] + 1:
                raise AssertionError(f"{label}: vertical overflow scrollHeight={rects['scrollHeight']} > innerHeight={rects['innerHeight']}")
            assert_rect_ok(rects, "titleLeft", "subcopy")
            assert_rect_ok(rects, "titleLeft", "calloutLeft")
            assert_rect_ok(rects, "subcopy", "calloutLeft")
            assert_rect_ok(rects, "titleRight", "calloutMidRight")
            assert_rect_ok(rects, "calloutTopRight", "calloutMidRight")
            assert_rect_ok(rects, "brand", "nav")
            assert_rect_ok(rects, "nav", "signin")
            if vw == 390:
                page.click('#menu-toggle')
                page.wait_for_selector('#mobile-menu:not([hidden])')
                page.click('#menu-toggle')
                page.wait_for_selector('#mobile-menu[hidden]', state="attached")
                page.mouse.move(10, 10)
                page.evaluate("() => { document.activeElement?.blur(); window.__LOGOS_DEBUG__.clearTrail(); window.__LOGOS_DEBUG__.renderFrames(2); }")
                page.wait_for_timeout(240)
                page.screenshot(path=str(OUT_DIR / "mobile-390.png"))
            print(f"Viewport {label} OK (scrollWidth={rects['scrollWidth']} == innerWidth={rects['innerWidth']})")

        browser.close()

    if console_errors:
        raise AssertionError(f"Console errors: {console_errors}")
    if page_errors:
        raise AssertionError(f"Uncaught page errors: {page_errors}")
    if bad_responses:
        raise AssertionError(f"HTTP >= 400 responses: {bad_responses}")
    if external_requests:
        raise AssertionError(f"Unexpected external network requests: {external_requests}")

    print("ALL BROWSER CHECKS PASSED.")


if __name__ == "__main__":
    main()
