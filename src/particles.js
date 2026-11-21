import * as THREE from "three";

const TEX_SIZE = 256;
const PARTICLE_COUNT = TEX_SIZE * TEX_SIZE; // 65,536 surface particles

function makeSeededRng(seed = 1337) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sample PARTICLE_COUNT points uniformly by surface area in bustGroup local space.
 * Returns two Float32 DataTextures holding rest position + seed1 and rest normal + seed2.
 */
function sampleBustSurface(bustGroup, count) {
  bustGroup.updateMatrixWorld(true);
  const bustInv = new THREE.Matrix4().copy(bustGroup.matrixWorld).invert();
  const toLocal = new THREE.Matrix4();
  const normMat = new THREE.Matrix3();

  const triPos = [];
  const triNorm = [];
  const cumAreas = [];
  let totalArea = 0;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const na = new THREE.Vector3();
  const nb = new THREE.Vector3();
  const nc = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const cross = new THREE.Vector3();

  bustGroup.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const geom = obj.geometry;
    const posAttr = geom.attributes.position;
    if (!posAttr) return;
    const normAttr = geom.attributes.normal;
    const indexAttr = geom.index;

    toLocal.multiplyMatrices(bustInv, obj.matrixWorld);
    normMat.getNormalMatrix(toLocal);

    const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
      const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;

      a.fromBufferAttribute(posAttr, i0).applyMatrix4(toLocal);
      b.fromBufferAttribute(posAttr, i1).applyMatrix4(toLocal);
      c.fromBufferAttribute(posAttr, i2).applyMatrix4(toLocal);

      ab.subVectors(b, a);
      ac.subVectors(c, a);
      cross.crossVectors(ab, ac);
      const area = 0.5 * cross.length();
      if (area <= 1e-10) continue;

      if (normAttr) {
        na.fromBufferAttribute(normAttr, i0).applyMatrix3(normMat).normalize();
        nb.fromBufferAttribute(normAttr, i1).applyMatrix3(normMat).normalize();
        nc.fromBufferAttribute(normAttr, i2).applyMatrix3(normMat).normalize();
      } else {
        cross.normalize();
        na.copy(cross);
        nb.copy(cross);
        nc.copy(cross);
      }

      totalArea += area;
      cumAreas.push(totalArea);
      triPos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      triNorm.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z);
    }
  });

  const nTris = cumAreas.length;
  const homePosData = new Float32Array(count * 4);
  const homeNormData = new Float32Array(count * 4);
  const rng = makeSeededRng(20261121);

  for (let i = 0; i < count; i++) {
    const target = rng() * totalArea;
    let lo = 0;
    let hi = nTris - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cumAreas[mid] < target) lo = mid + 1;
      else hi = mid;
    }

    const r1 = rng();
    const r2 = rng();
    const s1 = Math.sqrt(r1);
    const u = 1.0 - s1;
    const v = s1 * (1.0 - r2);
    const w = s1 * r2;

    const base = lo * 9;
    const px = triPos[base] * u + triPos[base + 3] * v + triPos[base + 6] * w;
    const py = triPos[base + 1] * u + triPos[base + 4] * v + triPos[base + 7] * w;
    const pz = triPos[base + 2] * u + triPos[base + 5] * v + triPos[base + 8] * w;

    let nx = triNorm[base] * u + triNorm[base + 3] * v + triNorm[base + 6] * w;
    let ny = triNorm[base + 1] * u + triNorm[base + 4] * v + triNorm[base + 7] * w;
    let nz = triNorm[base + 2] * u + triNorm[base + 5] * v + triNorm[base + 8] * w;
    const nLen = Math.hypot(nx, ny, nz) || 1.0;
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;

    const o = i * 4;
    homePosData[o] = px;
    homePosData[o + 1] = py;
    homePosData[o + 2] = pz;
    homePosData[o + 3] = rng();

    homeNormData[o] = nx;
    homeNormData[o + 1] = ny;
    homeNormData[o + 2] = nz;
    homeNormData[o + 3] = rng();
  }

  const makeTex = (arr) => {
    const tex = new THREE.DataTexture(arr, TEX_SIZE, TEX_SIZE, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  };

  return {
    homePosTex: makeTex(homePosData),
    homeNormTex: makeTex(homeNormData),
  };
}

const SIM_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const VEL_FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uHomePosTex;
uniform sampler2D uHomeNormTex;
uniform sampler2D uPosTex;
uniform sampler2D uVelTex;

uniform mat4 uBustMVP;
uniform mat4 uBustWorldMat;
uniform mat3 uBustInvRotMat;

uniform vec2 uPrevMouseNdc;
uniform vec2 uCurrMouseNdc;
uniform vec2 uMouseVelNdc;
uniform float uPointerActive;
uniform float uAspect;
uniform float uDt;
uniform float uTime;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);

  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);

  float nxy0 = mix(nx00, nx10, u.y);
  float nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
}

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise3(p);
    p = p * 2.02 + vec3(7.3, 13.7, 5.1);
    a *= 0.5;
  }
  return v;
}

vec3 potential3(vec3 p) {
  return vec3(
    noise3(p + vec3(11.3, 4.7, 23.1)),
    noise3(p + vec3(47.9, 19.2, 8.4)),
    noise3(p + vec3(3.1, 61.5, 37.8))
  );
}

vec3 curlNoise3(vec3 p) {
  const float e = 0.04;
  vec3 dx = potential3(p + vec3(e, 0.0, 0.0)) - potential3(p - vec3(e, 0.0, 0.0));
  vec3 dy = potential3(p + vec3(0.0, e, 0.0)) - potential3(p - vec3(0.0, e, 0.0));
  vec3 dz = potential3(p + vec3(0.0, 0.0, e)) - potential3(p - vec3(0.0, 0.0, e));
  return vec3(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x) / (2.0 * e);
}

vec2 closestOnSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float lenSq = dot(ab, ab);
  if (lenSq < 1e-7) return a;
  float t = clamp(dot(p - a, ab) / lenSq, 0.0, 1.0);
  return a + ab * t;
}

void main() {
  vec4 hp = texture2D(uHomePosTex, vUv);
  vec4 hn = texture2D(uHomeNormTex, vUv);
  vec4 posData = texture2D(uPosTex, vUv);
  vec4 velData = texture2D(uVelTex, vUv);

  vec3 homePos = hp.xyz;
  float seed1 = hp.w;
  vec3 homeNorm = normalize(hn.xyz);
  float seed2 = hn.w;

  vec3 offset = posData.xyz;
  float energy = posData.w;
  vec3 vel = velData.xyz;

  // Front-facing & rim check so rear side of head is not perturbed through the skull
  vec3 worldNorm = normalize(mat3(uBustWorldMat) * homeNorm);
  float facing = dot(worldNorm, vec3(0.0, 0.0, 1.0));

  float hit = 0.0;
  if (uPointerActive > 0.5 && facing > -0.24) {
    vec4 clipPos = uBustMVP * vec4(homePos, 1.0);
    if (clipPos.w > 0.05) {
      vec2 ndc = clipPos.xy / clipPos.w;
      vec2 p = vec2(ndc.x * uAspect, ndc.y);
      vec2 a = vec2(uPrevMouseNdc.x * uAspect, uPrevMouseNdc.y);
      vec2 b = vec2(uCurrMouseNdc.x * uAspect, uCurrMouseNdc.y);

      vec2 closest = closestOnSegment(p, a, b);
      float d = length(p - closest);

      float speed = length(uMouseVelNdc);
      float baseRadius = mix(0.20, 0.30, clamp(speed * 6.5, 0.0, 1.0));
      float n3 = fbm3(homePos * 3.8 + vec3(0.0, uTime * 0.20, uTime * 0.14));
      float localRadius = baseRadius * (0.64 + 0.68 * n3 + 0.18 * (seed1 - 0.5));

      float frontFade = smoothstep(-0.24, 0.24, facing);
      hit = smoothstep(localRadius, localRadius * 0.18, d) * frontFade;

      if (hit > 0.001) {
        vec2 rad2d = length(p - closest) > 1e-4 ? normalize(p - closest) : vec2(0.0);
        vec3 screenSwipe = vec3(uMouseVelNdc * 18.0, 0.0);
        vec3 screenRadial = vec3(rad2d, 0.28);

        vec3 localSwipe = uBustInvRotMat * screenSwipe;
        vec3 localRadial = uBustInvRotMat * screenRadial;

        vec3 impulse =
          homeNorm * (0.38 + 0.48 * seed2) +
          localSwipe * (0.85 + 0.85 * seed1) +
          localRadial * (0.28 + 0.36 * seed2);

        float dtScale = clamp(uDt * 60.0, 0.35, 1.8);
        vel += impulse * hit * dtScale * 0.50;
      }
    }
  }

  // Critically-damped individualized spring-damper + 3D curl noise (~1.8-2.2s full return)
  vec3 curl = curlNoise3(homePos * 2.5 + offset * 2.8 + vec3(0.0, uTime * 0.36, uTime * 0.22));
  float k = mix(8.5, 15.0, seed1);
  float damp = mix(5.4, 7.2, seed2);
  float activeEnergy = max(energy, hit);

  vec3 acc = -k * offset - damp * vel + curl * (0.52 * activeEnergy);
  vel += acc * uDt;

  float vLen = length(vel);
  if (vLen > 1.85) {
    vel = vel * (1.85 / vLen);
  }

  gl_FragColor = vec4(vel, hit);
}
`;

const POS_FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uPosTex;
uniform sampler2D uVelTex;
uniform float uDt;

void main() {
  vec4 posData = texture2D(uPosTex, vUv);
  vec4 velData = texture2D(uVelTex, vUv);

  vec3 offset = posData.xyz;
  float prevEnergy = posData.w;
  vec3 vel = velData.xyz;
  float hit = velData.w;

  offset += vel * uDt;
  float dist = length(offset);
  if (dist > 0.36) {
    offset = offset * (0.36 / dist);
  }

  float motionEnergy = clamp(dist * 2.6 + length(vel) * 0.28, 0.0, 1.0);
  float decayed = prevEnergy * pow(0.20, clamp(uDt, 0.0, 0.1));
  float energy = max(max(decayed, hit), motionEnergy * 0.78);

  if (energy < 0.005 && dist < 0.004 && length(vel) < 0.005) {
    offset = vec3(0.0);
    energy = 0.0;
  }

  gl_FragColor = vec4(offset, clamp(energy, 0.0, 1.0));
}
`;

const ENERGY_VERT = /* glsl */ `
attribute vec2 aRefUv;

uniform sampler2D uHomePosTex;
uniform sampler2D uHomeNormTex;
uniform sampler2D uPosTex;
uniform mat4 uBustWorldMat;
uniform float uDpr;

varying float vEnergy;

void main() {
  vec4 hp = texture2D(uHomePosTex, aRefUv);
  vec4 hn = texture2D(uHomeNormTex, aRefUv);
  vec4 posData = texture2D(uPosTex, aRefUv);

  float energy = posData.w;
  if (energy < 0.014) {
    vEnergy = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vEnergy = energy;
  // Slightly push along surface normal so depth-only mesh occlusion never clips front splats
  vec3 pos = hp.xyz + hn.xyz * 0.012;
  vec4 worldPos = uBustWorldMat * vec4(pos, 1.0);
  vec4 mvPos = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPos;

  float persp = 4.68 / max(-mvPos.z, 0.5);
  gl_PointSize = clamp((13.0 + 16.0 * energy) * uDpr * 0.5 * persp, 4.0, 26.0);
}
`;

const ENERGY_FRAG = /* glsl */ `
precision highp float;

varying float vEnergy;

void main() {
  if (vEnergy <= 0.0) discard;
  float d = length(gl_PointCoord - 0.5);
  float disc = smoothstep(0.5, 0.10, d);
  if (disc <= 0.005) discard;
  gl_FragColor = vec4(vEnergy * disc, 0.0, 0.0, 1.0);
}
`;

const PARTICLE_VERT = /* glsl */ `
attribute vec2 aRefUv;

uniform sampler2D uHomePosTex;
uniform sampler2D uHomeNormTex;
uniform sampler2D uPosTex;
uniform mat4 uBustWorldMat;
uniform float uDpr;

varying float vEnergy;
varying float vLight;
varying float vSeed;

void main() {
  vec4 hp = texture2D(uHomePosTex, aRefUv);
  vec4 hn = texture2D(uHomeNormTex, aRefUv);
  vec4 posData = texture2D(uPosTex, aRefUv);

  float energy = posData.w;
  if (energy < 0.014) {
    vEnergy = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vEnergy = energy;
  vSeed = hp.w;

  vec3 localPos = hp.xyz + posData.xyz + hn.xyz * 0.009;
  vec4 worldPos = uBustWorldMat * vec4(localPos, 1.0);
  vec4 mvPos = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPos;

  // Match studio 3-point + hemisphere light rig from scene.js
  vec3 wn = normalize(mat3(uBustWorldMat) * normalize(hn.xyz));
  vec3 lKey = normalize(vec3(-1.35, 1.45, 4.2));
  vec3 lFill = normalize(vec3(2.5, 0.35, 3.3));
  vec3 lRim = normalize(vec3(0.25, 2.2, -3.8));

  float key = max(dot(wn, lKey), 0.0) * 0.72;
  float fill = max(dot(wn, lFill), 0.0) * 0.24;
  float rim = max(dot(wn, lRim), 0.0) * 0.42;
  float hemi = 0.16 + 0.14 * (wn.y * 0.5 + 0.5);
  vLight = clamp(key + fill + rim + hemi, 0.0, 1.0);

  // Outer collar shards start closer to grid cell size, then shatter into fine micro-dust
  float collarSize = mix(4.0, 2.35, smoothstep(0.05, 0.42, energy));
  float grainVar = mix(0.76, 1.32, hn.w);
  float persp = 4.68 / max(-mvPos.z, 0.5);
  gl_PointSize = clamp(collarSize * grainVar * uDpr * persp, 1.5, 9.0 * uDpr);
}
`;

const PARTICLE_FRAG = /* glsl */ `
precision highp float;

uniform vec3 uDeepRed;
uniform vec3 uMidRed;
uniform vec3 uWarmCoral;
uniform vec3 uCreamColor;

varying float vEnergy;
varying float vLight;
varying float vSeed;

void main() {
  if (vEnergy <= 0.0) discard;

  vec2 d = abs(gl_PointCoord - 0.5);
  float shape = smoothstep(0.50, 0.26, max(d.x, d.y));
  if (shape <= 0.01) discard;

  // Saturated Pompeian vermilion core with crisp sparse ivory dust on high-light faces
  vec3 shadowTone = mix(uDeepRed, uMidRed, smoothstep(0.10, 0.58, vLight));
  vec3 litTone = mix(shadowTone, uWarmCoral, smoothstep(0.54, 0.96, vLight));

  // Subtle cream rim only right as cells peel; core dust stays saturated vermilion + sparse ivory specks
  float collarCream = (1.0 - smoothstep(0.03, 0.22, vEnergy)) * smoothstep(0.30, 0.78, vLight) * 0.65;
  float sparseIvoryDust = step(0.73, vSeed) * smoothstep(0.54, 0.90, vLight) * smoothstep(0.24, 0.65, vEnergy);
  float ivoryWeight = clamp(collarCream + sparseIvoryDust * 0.92, 0.0, 1.0);

  vec3 col = mix(litTone, uCreamColor, ivoryWeight);
  // Smoothly hand back to regrowing halftone cells once energy drops below 0.22
  float alpha = shape * smoothstep(0.03, 0.24, vEnergy);

  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

/**
 * 3D surface-sampled GPGPU particle simulation bound to bustScene.bustGroup.
 */
export function createParticleSystem({ renderer, bustScene, width, height, dpr }) {
  const gl = renderer.getContext();
  const hasFloat = renderer.capabilities.isWebGL2 && Boolean(gl.getExtension("EXT_color_buffer_float"));
  const hasHalfFloat = renderer.capabilities.isWebGL2 && Boolean(gl.getExtension("EXT_color_buffer_half_float"));
  const fboType = hasFloat ? THREE.FloatType : hasHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const mode = hasFloat || hasHalfFloat ? "gpgpu" : "fallback";

  const { homePosTex, homeNormTex } = sampleBustSurface(bustScene.bustGroup, PARTICLE_COUNT);

  const makeStateTarget = () =>
    new THREE.WebGLRenderTarget(TEX_SIZE, TEX_SIZE, {
      format: THREE.RGBAFormat,
      type: fboType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });

  const posTargets = [makeStateTarget(), makeStateTarget()];
  const velTargets = [makeStateTarget(), makeStateTarget()];
  let posIdx = 0;
  let velIdx = 0;

  let energyWidth = Math.max(128, Math.floor(width * 0.5));
  let energyHeight = Math.max(128, Math.floor(height * 0.5));
  const energyTarget = new THREE.WebGLRenderTarget(energyWidth, energyHeight, {
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: true,
    stencilBuffer: false,
  });

  // Shared simulation quad
  const simScene = new THREE.Scene();
  const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

  const velUniforms = {
    uHomePosTex: { value: homePosTex },
    uHomeNormTex: { value: homeNormTex },
    uPosTex: { value: null },
    uVelTex: { value: null },
    uBustMVP: { value: new THREE.Matrix4() },
    uBustWorldMat: { value: new THREE.Matrix4() },
    uBustInvRotMat: { value: new THREE.Matrix3() },
    uPrevMouseNdc: { value: new THREE.Vector2(0, 0) },
    uCurrMouseNdc: { value: new THREE.Vector2(0, 0) },
    uMouseVelNdc: { value: new THREE.Vector2(0, 0) },
    uPointerActive: { value: 0.0 },
    uAspect: { value: width / Math.max(height, 1) },
    uDt: { value: 1 / 60 },
    uTime: { value: 0.0 },
  };

  const velMat = new THREE.ShaderMaterial({
    vertexShader: SIM_VERT,
    fragmentShader: VEL_FRAG,
    uniforms: velUniforms,
    depthTest: false,
    depthWrite: false,
  });

  const posUniforms = {
    uPosTex: { value: null },
    uVelTex: { value: null },
    uDt: { value: 1 / 60 },
  };

  const posMat = new THREE.ShaderMaterial({
    vertexShader: SIM_VERT,
    fragmentShader: POS_FRAG,
    uniforms: posUniforms,
    depthTest: false,
    depthWrite: false,
  });

  const simQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), velMat);
  simQuad.frustumCulled = false;
  simScene.add(simQuad);

  // Shared particle geometry with aRefUv attribute indexing into 256x256 state textures
  const particleGeom = new THREE.BufferGeometry();
  const dummyPos = new Float32Array(PARTICLE_COUNT * 3);
  const refUv = new Float32Array(PARTICLE_COUNT * 2);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const ix = i % TEX_SIZE;
    const iy = Math.floor(i / TEX_SIZE);
    refUv[i * 2] = (ix + 0.5) / TEX_SIZE;
    refUv[i * 2 + 1] = (iy + 0.5) / TEX_SIZE;
  }
  particleGeom.setAttribute("position", new THREE.BufferAttribute(dummyPos, 3));
  particleGeom.setAttribute("aRefUv", new THREE.BufferAttribute(refUv, 2));

  // Energy mask scene
  const energyScene = new THREE.Scene();
  const energyUniforms = {
    uHomePosTex: { value: homePosTex },
    uHomeNormTex: { value: homeNormTex },
    uPosTex: { value: null },
    uBustWorldMat: { value: new THREE.Matrix4() },
    uDpr: { value: dpr },
  };
  const energyMat = new THREE.ShaderMaterial({
    vertexShader: ENERGY_VERT,
    fragmentShader: ENERGY_FRAG,
    uniforms: energyUniforms,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  const energyPoints = new THREE.Points(particleGeom, energyMat);
  energyPoints.frustumCulled = false;
  energyScene.add(energyPoints);

  // Foreground 3D particle cloud scene
  const particleScene = new THREE.Scene();
  const particleUniforms = {
    uHomePosTex: { value: homePosTex },
    uHomeNormTex: { value: homeNormTex },
    uPosTex: { value: null },
    uBustWorldMat: { value: new THREE.Matrix4() },
    uDpr: { value: dpr },
    uDeepRed: { value: new THREE.Color("#6b1207") },
    uMidRed: { value: new THREE.Color("#b42b16") },
    uWarmCoral: { value: new THREE.Color("#dd5f3d") },
    uCreamColor: { value: new THREE.Color("#f3eae0") },
  };
  const particleMat = new THREE.ShaderMaterial({
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    uniforms: particleUniforms,
    depthTest: true,
    depthWrite: false,
    transparent: true,
  });
  const particlePoints = new THREE.Points(particleGeom, particleMat);
  particlePoints.frustumCulled = false;
  particleScene.add(particlePoints);

  const mvpMat = new THREE.Matrix4();
  const vpMat = new THREE.Matrix4();
  const invWorldMat = new THREE.Matrix4();

  function reset() {
    const prevTarget = renderer.getRenderTarget();
    const prevClearAlpha = renderer.getClearAlpha();
    for (const rt of [...posTargets, ...velTargets, energyTarget]) {
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevClearAlpha);
  }

  reset();

  function resize(w, h, nextDpr) {
    energyWidth = Math.max(128, Math.floor(w * 0.5));
    energyHeight = Math.max(128, Math.floor(h * 0.5));
    energyTarget.setSize(energyWidth, energyHeight);
    velUniforms.uAspect.value = w / Math.max(h, 1);
    energyUniforms.uDpr.value = nextDpr;
    particleUniforms.uDpr.value = nextDpr;
  }

  function update({ dt, time, prevPointerNdc, currPointerNdc, pointerActive }) {
    const bustGroup = bustScene.bustGroup;
    const camera = bustScene.camera;
    bustGroup.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    vpMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    mvpMat.multiplyMatrices(vpMat, bustGroup.matrixWorld);
    invWorldMat.copy(bustGroup.matrixWorld).invert();

    velUniforms.uBustMVP.value.copy(mvpMat);
    velUniforms.uBustWorldMat.value.copy(bustGroup.matrixWorld);
    velUniforms.uBustInvRotMat.value.setFromMatrix4(invWorldMat);
    velUniforms.uPrevMouseNdc.value.copy(prevPointerNdc);
    velUniforms.uCurrMouseNdc.value.copy(currPointerNdc);
    velUniforms.uMouseVelNdc.value.subVectors(currPointerNdc, prevPointerNdc);
    velUniforms.uPointerActive.value = pointerActive ? 1.0 : 0.0;
    velUniforms.uDt.value = dt;
    velUniforms.uTime.value = time;

    const prevTarget = renderer.getRenderTarget();

    // 1) Velocity pass
    const nextVelIdx = 1 - velIdx;
    velUniforms.uPosTex.value = posTargets[posIdx].texture;
    velUniforms.uVelTex.value = velTargets[velIdx].texture;
    simQuad.material = velMat;
    renderer.setRenderTarget(velTargets[nextVelIdx]);
    renderer.render(simScene, simCamera);
    velIdx = nextVelIdx;

    // 2) Position & energy pass
    const nextPosIdx = 1 - posIdx;
    posUniforms.uPosTex.value = posTargets[posIdx].texture;
    posUniforms.uVelTex.value = velTargets[velIdx].texture;
    posUniforms.uDt.value = dt;
    simQuad.material = posMat;
    renderer.setRenderTarget(posTargets[nextPosIdx]);
    renderer.render(simScene, simCamera);
    posIdx = nextPosIdx;

    renderer.setRenderTarget(prevTarget);
  }

  function renderEnergyMask() {
    const prevTarget = renderer.getRenderTarget();
    const prevClearAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;

    renderer.setRenderTarget(energyTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);

    // Depth-only bust occlusion pass keeps disturbed cloud strictly locked to visible face/side
    bustScene.renderDepthOnly(energyTarget);

    energyUniforms.uPosTex.value = posTargets[posIdx].texture;
    energyUniforms.uBustWorldMat.value.copy(bustScene.bustGroup.matrixWorld);

    renderer.autoClear = false;
    renderer.setRenderTarget(energyTarget);
    renderer.render(energyScene, bustScene.camera);

    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevClearAlpha);
  }

  function renderParticles() {
    const prevAutoClear = renderer.autoClear;
    renderer.setRenderTarget(null);
    renderer.autoClear = false;

    // Populate screen depth buffer without touching color buffer drawn by compositePass
    bustScene.renderDepthOnly(null);

    particleUniforms.uPosTex.value = posTargets[posIdx].texture;
    particleUniforms.uBustWorldMat.value.copy(bustScene.bustGroup.matrixWorld);
    renderer.render(particleScene, bustScene.camera);

    renderer.autoClear = prevAutoClear;
  }

  return {
    mode,
    count: PARTICLE_COUNT,
    update,
    renderEnergyMask,
    renderParticles,
    resize,
    reset,
    getEnergyTexture() {
      return energyTarget.texture;
    },
    dispose() {
      homePosTex.dispose();
      homeNormTex.dispose();
      posTargets[0].dispose();
      posTargets[1].dispose();
      velTargets[0].dispose();
      velTargets[1].dispose();
      energyTarget.dispose();
      velMat.dispose();
      posMat.dispose();
      energyMat.dispose();
      particleMat.dispose();
      simQuad.geometry.dispose();
      particleGeom.dispose();
    },
  };
}
