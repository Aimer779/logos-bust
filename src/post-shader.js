import * as THREE from "three";

const POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const POST_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uBustTex;
uniform sampler2D uEnergyTex;
uniform sampler2D uGlyphTex;
uniform float uGlyphCount;
uniform vec2 uResolution;
uniform float uDpr;
uniform float uTime;
uniform vec3 uBgColor;
uniform vec3 uDeepRed;
uniform vec3 uSubRed;
uniform vec3 uCreamColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float bayer4(vec2 coord) {
  vec2 p = mod(coord, 4.0);
  float idx = 0.0;
  if (p.y < 1.0) {
    idx = (p.x < 1.0) ? 0.0 : (p.x < 2.0) ? 8.0 : (p.x < 3.0) ? 2.0 : 10.0;
  } else if (p.y < 2.0) {
    idx = (p.x < 1.0) ? 12.0 : (p.x < 2.0) ? 4.0 : (p.x < 3.0) ? 14.0 : 6.0;
  } else if (p.y < 3.0) {
    idx = (p.x < 1.0) ? 3.0 : (p.x < 2.0) ? 11.0 : (p.x < 3.0) ? 1.0 : 9.0;
  } else {
    idx = (p.x < 1.0) ? 15.0 : (p.x < 2.0) ? 7.0 : (p.x < 3.0) ? 13.0 : 5.0;
  }
  return (idx + 0.5) / 16.0 - 0.5;
}

float calcLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  // Coarse halftone matrix grid (~7 CSS px at 900px viewport height)
  vec2 fragPx = gl_FragCoord.xy;
  float cssHeight = uResolution.y / max(uDpr, 1.0);
  float cellCss = clamp(floor(cssHeight / 122.0 + 0.5), 6.0, 9.0);
  float cellPx = cellCss * max(uDpr, 1.0);

  vec2 cellCoord = floor(fragPx / cellPx);
  vec2 cellUv = (cellCoord + 0.5) * cellPx / uResolution;
  vec2 inCellUv = fract(fragPx / cellPx);

  vec4 bustCell = texture2D(uBustTex, clamp(cellUv, 0.0, 1.0));
  float restAlpha = smoothstep(0.32, 0.62, bustCell.a);

  float rawLinLum = calcLuma(bustCell.rgb);
  float rawLum = pow(clamp(rawLinLum, 1e-4, 1.0), 0.45);
  float dither = bayer4(cellCoord) * 0.055;
  float shapedLum = clamp(smoothstep(0.16, 0.86, rawLum) + dither, 0.0, 1.0);

  // Sample 3D-locked surface disturbance energy per cell
  float cellEnergy = texture2D(uEnergyTex, clamp(cellUv, 0.0, 1.0)).r;
  float cellHash = hash12(cellCoord + 17.3);
  float cellDissolve = smoothstep(
    0.08,
    0.52,
    cellEnergy + (cellHash - 0.5) * 0.22 * step(0.015, cellEnergy)
  );

  // Physically shrink remaining halftone glyphs toward cell center as 3D particles take over
  float shrink = max(1.0 - cellDissolve * 0.82, 0.18);
  vec2 shrunkUv = (inCellUv - 0.5) / shrink + 0.5;
  float inBounds = step(0.0, shrunkUv.x) * step(shrunkUv.x, 1.0) * step(0.0, shrunkUv.y) * step(shrunkUv.y, 1.0);

  float glyphFloat = mix(1.0, uGlyphCount - 1.0, shapedLum);
  float glyphIdx = floor(glyphFloat + 0.5);
  float atlasU = (glyphIdx + clamp(shrunkUv.x, 0.0, 1.0)) / uGlyphCount;
  float glyphCov = texture2D(uGlyphTex, vec2(atlasU, clamp(shrunkUv.y, 0.0, 1.0))).a * inBounds;

  float cellInkStrength = mix(0.18, 1.0, smoothstep(0.04, 0.76, shapedLum));
  float intactMask = restAlpha * glyphCov * cellInkStrength * (1.0 - cellDissolve);

  // Beneath dissolved cells, expose a granular matte terracotta-crimson dust bed (no smooth 3D clay)
  vec2 microCell = floor(fragPx / max(1.0, floor(1.5 * max(uDpr, 1.0))));
  float microGrain = hash12(microCell + floor(uTime * 10.0) * 0.07);
  float fineLum = pow(clamp(calcLuma(texture2D(uBustTex, vUv).rgb), 1e-4, 1.0), 0.45);
  float fineAlpha = smoothstep(0.32, 0.66, texture2D(uBustTex, vUv).a);
  float grainDust = step(mix(0.88, 0.48, fineLum), microGrain);
  vec3 substrateTone = mix(uDeepRed, mix(uBgColor, uSubRed, fineLum * 0.55), 0.45 + 0.45 * grainDust);
  vec3 baseSurface = mix(uBgColor, substrateTone, fineAlpha * cellDissolve * 0.88);

  vec3 finalColor = mix(baseSurface, uCreamColor, intactMask);

  gl_FragColor = vec4(finalColor, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * Fullscreen post-processing pass rendering the terracotta background,
 * shrinking halftone bust cells, and saturated vermilion substrate under the 3D particle cloud.
 */
export function createCompositePass({ glyphAtlas, width, height, dpr }) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

  const uniforms = {
    uBustTex: { value: null },
    uEnergyTex: { value: null },
    uGlyphTex: { value: glyphAtlas.texture },
    uGlyphCount: { value: glyphAtlas.count },
    uResolution: { value: new THREE.Vector2(width, height) },
    uDpr: { value: dpr },
    uTime: { value: 0 },
    uBgColor: { value: new THREE.Color("#972212") },
    uDeepRed: { value: new THREE.Color("#631006") },
    uSubRed: { value: new THREE.Color("#aa2814") },
    uCreamColor: { value: new THREE.Color("#f3eae0") },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: POST_VERTEX,
    fragmentShader: POST_FRAGMENT,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);

  function resize(w, h, nextDpr) {
    uniforms.uResolution.value.set(w, h);
    uniforms.uDpr.value = nextDpr;
  }

  function render({ renderer, bustTexture, energyTexture, time }) {
    uniforms.uBustTex.value = bustTexture;
    uniforms.uEnergyTex.value = energyTexture;
    uniforms.uTime.value = time;

    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  }

  return {
    render,
    resize,
    dispose() {
      material.dispose();
      quad.geometry.dispose();
    },
  };
}
