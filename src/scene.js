import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Offscreen 3D classical bust scene rendered with studio marble lighting
 * onto a transparent-background WebGLRenderTarget for halftone post-processing,
 * also exposing depth-only passes for 3D particle occlusion.
 */
export function createBustScene({ renderer, modelUrl, width, height }) {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(28, width / Math.max(height, 1), 0.1, 30);
  camera.position.set(0, 0.15, 4.68);
  camera.lookAt(0, 0.15, 0);

  const renderTarget = new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
  });

  const hemi = new THREE.HemisphereLight(0xfff5ea, 0x2b0b06, 0.42);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xfff6ec, 1.92);
  keyLight.position.set(-1.35, 1.45, 4.2);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xf6dfd4, 0.56);
  fillLight.position.set(2.5, 0.35, 3.3);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xfff0e2, 1.25);
  rimLight.position.set(0.25, 2.2, -3.8);
  scene.add(rimLight);

  const bustGroup = new THREE.Group();
  scene.add(bustGroup);

  const marbleMat = new THREE.MeshStandardMaterial({
    color: 0xf0e7dc,
    roughness: 0.88,
    metalness: 0.0,
  });

  const depthOnlyMat = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 1.8,
    polygonOffsetUnits: 1.8,
  });

  const meshNodes = [];
  let loaded = false;
  let autoRotate = true;
  let rotationSpeed = 0.48; // ~27.5 deg/s matching video (~13s full revolution)

  const loader = new GLTFLoader();
  const ready = new Promise((resolve, reject) => {
    loader.load(
      modelUrl,
      (gltf) => {
        const root = gltf.scene;
        root.traverse((obj) => {
          if (obj.isMesh) {
            if (!obj.geometry.attributes.normal) {
              obj.geometry.computeVertexNormals();
            }
            obj.material = marbleMat;
            meshNodes.push(obj);
          }
        });

        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const maxH = Math.max(size.y, 1e-4);
        const scale = 2.2 / maxH;
        root.scale.setScalar(scale);
        root.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

        bustGroup.add(root);
        loaded = true;
        resolve();
      },
      undefined,
      (err) => reject(err)
    );
  });

  function updateCameraFraming(w, h) {
    const aspect = w / Math.max(h, 1);
    camera.aspect = aspect;
    if (aspect < 0.85) {
      const narrowFactor = 1.0 + (1.0 - aspect) * 1.18;
      camera.position.set(0, 0.34, 4.75 * narrowFactor);
      camera.lookAt(0, 0.34, 0);
    } else {
      camera.position.set(0, 0.15, 4.68);
      camera.lookAt(0, 0.15, 0);
    }
    camera.updateProjectionMatrix();
  }

  function resize(w, h) {
    renderTarget.setSize(Math.max(1, w), Math.max(1, h));
    updateCameraFraming(w, h);
  }

  function update(dt) {
    if (loaded && autoRotate) {
      bustGroup.rotation.y += rotationSpeed * dt;
    }
  }

  function render() {
    const prevTarget = renderer.getRenderTarget();
    const prevClearAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(renderTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevClearAlpha);
  }

  function renderDepthOnly(target = null) {
    if (!loaded) return;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;

    for (const m of meshNodes) m.material = depthOnlyMat;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.clearDepth();
    renderer.render(scene, camera);
    for (const m of meshNodes) m.material = marbleMat;

    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
  }

  updateCameraFraming(width, height);

  return {
    ready,
    camera,
    bustGroup,
    renderTarget,
    update,
    render,
    renderDepthOnly,
    resize,
    setAngle(rad) {
      bustGroup.rotation.y = rad;
    },
    getAngle() {
      return bustGroup.rotation.y;
    },
    setAutoRotate(flag) {
      autoRotate = Boolean(flag);
    },
    getAutoRotate() {
      return autoRotate;
    },
    setRotationSpeed(radPerSec) {
      rotationSpeed = radPerSec;
    },
    isLoaded() {
      return loaded;
    },
    dispose() {
      renderTarget.dispose();
      marbleMat.dispose();
      depthOnlyMat.dispose();
    },
  };
}
