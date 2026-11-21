import * as THREE from "three";
import { createGlyphAtlas } from "./glyph-atlas.js";
import { createBustScene } from "./scene.js";
import { createParticleSystem } from "./particles.js";
import { createCompositePass } from "./post-shader.js";

const PANELS = {
  product: {
    kicker: "LOGOS // ENGINE",
    title: "Dialectical Knowledge Graph",
    copy: "Logos transforms millennia of philosophical treatises, primary manuscripts, and formal arguments into an interactive, cross-referenced reasoning engine.",
    cards: [
      { k: "01 / CORPUS", v: "2,400+ years of classical, medieval, and modern inquiry indexed to line-level citations." },
      { k: "02 / LOGIC", v: "Formal premise-to-conclusion dependency graphs highlighting hidden assumptions and contradictions." },
      { k: "03 / SYNTHESIS", v: "Compare Stoic, Aristotelian, Kantian, and analytic positions side by side." },
      { k: "04 / PRECISION", v: "Deterministic provenance tracking for every claim, translation variant, and commentary." },
    ],
  },
  resources: {
    kicker: "LOGOS // ARCHIVE",
    title: "Primary Sources & Lexicons",
    copy: "Direct bilingual editions, semantic root trees for Ancient Greek and Latin terms, and reproducible argument blueprints curated for researchers.",
    cards: [
      { k: "GREEK & LATIN", v: "Parallel critical apparatus with morphological parsing and contextual glosses." },
      { k: "ARGUMENT ATLAS", v: "11,450+ mapped syllogisms, refutations, and scholastic disputations." },
      { k: "STUDY TRACKS", v: "Guided curricula across ethics, epistemology, metaphysics, and political philosophy." },
      { k: "API & EXPORTS", v: "Structured JSON-LD and Markdown citations ready for academic workflows." },
    ],
  },
  blog: {
    kicker: "LOGOS // DISPATCHES",
    title: "Notes on Reason & Form",
    copy: "Essays from our editorial fellows on structured argumentation, computational philology, and building tools that honor slow thought.",
    cards: [
      { k: "ESSAY 14", v: "Why Ancient Dialectic Still Outperforms Modern Hot Takes in Complex Policy Debates." },
      { k: "ESSAY 13", v: "Designing Typographic Interfaces for Deep Reading Without Cognitive Clutter." },
      { k: "ESSAY 12", v: "Mapping 48,200 Philosophical Questions Without Flattening Ambiguity." },
      { k: "ESSAY 11", v: "From Stone Relief to Character Matrix: Rendering Weight, Form, and Impermanence." },
    ],
  },
  pricing: {
    kicker: "LOGOS // MEMBERSHIP",
    title: "Built for Long Inquiry",
    copy: "Transparent access for independent readers, seminar cohorts, and institutional libraries—without ad-driven feeds or attention traps.",
    cards: [
      { k: "READER — FREE", v: "Open access to public canonical texts, daily argument maps, and lexical lookup." },
      { k: "SCHOLAR — $18/MO", v: "Unlimited graph queries, private margin notebooks, and custom synthesis exports." },
      { k: "SEMINAR — $48/MO", v: "Shared cohort reading rooms, syllabus annotations, and versioned critique threads." },
      { k: "FELLOWSHIP", v: "Fee waivers and archival grants for independent researchers and humanities students." },
    ],
  },
  signin: {
    kicker: "LOGOS // ACCESS",
    title: "Sign in to Archive",
    copy: "Enter your scholar credentials to resume annotated manuscripts and mapped argument threads.",
    cards: [],
  },
};

function setupModal(onResetView) {
  const modal = document.getElementById("info-modal");
  const kickerEl = document.getElementById("modal-kicker");
  const titleEl = document.getElementById("modal-title");
  const copyEl = document.getElementById("modal-copy");
  const gridEl = document.getElementById("modal-grid");
  const formEl = document.getElementById("signin-form");
  const statusEl = document.getElementById("signin-status");
  const emailInput = document.getElementById("signin-email");
  const closeBtn = document.getElementById("modal-close");
  const mobileMenu = document.getElementById("mobile-menu");
  const menuToggle = document.getElementById("menu-toggle");
  const brandReset = document.getElementById("brand-reset");

  let lastTrigger = null;

  const setMobileMenuOpen = (open) => {
    mobileMenu.hidden = !open;
    menuToggle.setAttribute("aria-expanded", String(open));
  };

  menuToggle.addEventListener("click", () => {
    setMobileMenuOpen(mobileMenu.hidden);
  });

  brandReset.addEventListener("click", (e) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    closeModal();
    onResetView();
  });

  function openPanel(key, trigger) {
    const spec = PANELS[key];
    if (!spec) return;
    lastTrigger = trigger || document.activeElement;
    setMobileMenuOpen(false);

    kickerEl.textContent = spec.kicker;
    titleEl.textContent = spec.title;
    copyEl.textContent = spec.copy;

    gridEl.innerHTML = "";
    if (spec.cards.length > 0) {
      gridEl.hidden = false;
      for (const item of spec.cards) {
        const card = document.createElement("div");
        card.className = "modal-card";
        const k = document.createElement("span");
        k.className = "modal-card-k";
        k.textContent = item.k;
        const v = document.createElement("span");
        v.className = "modal-card-v";
        v.textContent = item.v;
        card.append(k, v);
        gridEl.appendChild(card);
      }
    } else {
      gridEl.hidden = true;
    }

    const isSignin = key === "signin";
    formEl.hidden = !isSignin;
    statusEl.textContent = "";
    if (isSignin) {
      formEl.reset();
    }

    modal.hidden = false;
    if (isSignin) {
      emailInput.focus();
    } else {
      closeBtn.focus();
    }
  }

  function closeModal() {
    if (modal.hidden) return;
    modal.hidden = true;
    if (lastTrigger && typeof lastTrigger.focus === "function") {
      lastTrigger.focus();
    }
    lastTrigger = null;
  }

  document.querySelectorAll("[data-panel]").forEach((btn) => {
    btn.addEventListener("click", () => openPanel(btn.dataset.panel, btn));
  });

  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!modal.hidden) closeModal();
      else if (!mobileMenu.hidden) setMobileMenuOpen(false);
    }
  });

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    const pass = document.getElementById("signin-code").value.trim();
    if (!email || !email.includes("@")) {
      statusEl.textContent = "Enter a valid scholar email address.";
      emailInput.focus();
      return;
    }
    if (pass.length < 4) {
      statusEl.textContent = "Passkey must be at least 4 characters.";
      document.getElementById("signin-code").focus();
      return;
    }
    statusEl.textContent = `Demo session ready for ${email}.`;
  });
}

async function init() {
  const canvas = document.getElementById("stage");
  await document.fonts.ready;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });

  const getSize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(window.innerWidth, 1);
    const cssH = Math.max(window.innerHeight, 1);
    return {
      cssW,
      cssH,
      dpr,
      pxW: Math.floor(cssW * dpr),
      pxH: Math.floor(cssH * dpr),
    };
  };

  let size = getSize();
  renderer.setPixelRatio(size.dpr);
  renderer.setSize(size.cssW, size.cssH, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const glyphAtlas = createGlyphAtlas();
  const bustScene = createBustScene({
    renderer,
    modelUrl: "./assets/bust.glb",
    width: size.pxW,
    height: size.pxH,
  });
  const compositePass = createCompositePass({
    glyphAtlas,
    width: size.pxW,
    height: size.pxH,
    dpr: size.dpr,
  });

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const applyMotionPreference = () => {
    bustScene.setAutoRotate(!motionQuery.matches);
  };
  applyMotionPreference();
  motionQuery.addEventListener("change", applyMotionPreference);

  await bustScene.ready;

  const particles = createParticleSystem({
    renderer,
    bustScene,
    width: size.pxW,
    height: size.pxH,
    dpr: size.dpr,
  });

  setupModal(() => {
    bustScene.setAngle(0);
    particles.reset();
  });

  // Pointer coordinates in WebGL NDC [-1..1]
  const prevPointerNdc = new THREE.Vector2(0, 0);
  const currPointerNdc = new THREE.Vector2(0, 0);
  let hasPointerHistory = false;
  let pointerActive = false;
  let elapsed = 0;
  let lastPointerElapsed = -1;
  let prevTime = performance.now();

  const updatePointerFromClient = (clientX, clientY) => {
    const nx = (clientX / Math.max(window.innerWidth, 1)) * 2.0 - 1.0;
    const ny = 1.0 - (clientY / Math.max(window.innerHeight, 1)) * 2.0;
    if (!hasPointerHistory) {
      prevPointerNdc.set(nx, ny);
      currPointerNdc.set(nx, ny);
      hasPointerHistory = true;
    } else {
      currPointerNdc.set(nx, ny);
    }
    pointerActive = true;
    lastPointerElapsed = elapsed;
  };

  window.addEventListener("pointermove", (e) => {
    updatePointerFromClient(e.clientX, e.clientY);
  });

  window.addEventListener("pointerdown", (e) => {
    if (e.target.closest("#info-modal")) return;
    hasPointerHistory = false;
    updatePointerFromClient(e.clientX, e.clientY);
  });

  window.addEventListener("pointerleave", () => {
    pointerActive = false;
    hasPointerHistory = false;
  });

  window.addEventListener("resize", () => {
    size = getSize();
    renderer.setPixelRatio(size.dpr);
    renderer.setSize(size.cssW, size.cssH, false);
    bustScene.resize(size.pxW, size.pxH);
    particles.resize(size.pxW, size.pxH, size.dpr);
    compositePass.resize(size.pxW, size.pxH, size.dpr);
  });

  function stepFrame(dt) {
    elapsed += dt;
    const activeWindow = pointerActive && (elapsed - lastPointerElapsed) < 0.09;

    bustScene.update(dt);
    bustScene.render();

    particles.update({
      dt,
      time: elapsed,
      prevPointerNdc,
      currPointerNdc,
      pointerActive: activeWindow,
    });
    prevPointerNdc.copy(currPointerNdc);

    particles.renderEnergyMask();

    compositePass.render({
      renderer,
      bustTexture: bustScene.renderTarget.texture,
      energyTexture: particles.getEnergyTexture(),
      time: elapsed,
    });

    particles.renderParticles();
  }

  let rafId = 0;
  function animate(now) {
    rafId = requestAnimationFrame(animate);
    const dt = Math.min((now - prevTime) / 1000, 0.05);
    prevTime = now;
    stepFrame(dt);
  }

  window.__LOGOS_DEBUG__ = {
    getState: () => ({
      loaded: bustScene.isLoaded(),
      angle: bustScene.getAngle(),
      autoRotate: bustScene.getAutoRotate(),
      particleMode: particles.mode,
      particleCount: particles.count,
      elapsed,
    }),
    setAngle: (rad) => bustScene.setAngle(rad),
    setAutoRotate: (flag) => bustScene.setAutoRotate(flag),
    clearTrail: () => particles.reset(),
    renderFrames: (count = 1, dt = 1 / 60) => {
      for (let i = 0; i < count; i++) {
        stepFrame(dt);
      }
    },
  };

  stepFrame(1 / 60);
  prevTime = performance.now();
  rafId = requestAnimationFrame(animate);

  window.addEventListener("beforeunload", () => {
    cancelAnimationFrame(rafId);
    bustScene.dispose();
    particles.dispose();
    compositePass.dispose();
    glyphAtlas.dispose();
    renderer.dispose();
  });
}

init().catch((err) => {
  console.error("Failed to initialize Logos bust scene:", err);
});
