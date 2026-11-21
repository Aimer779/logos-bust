import * as THREE from "three";

const CELL_SIZE = 64;
const GLYPH_COUNT = 12;

/**
 * Build a refined 12-level geometric halftone matrix atlas.
 * Eliminates harsh alphabetical symbol clutter while preserving unmistakable
 * grid structure and continuous sculptural shading across facial features.
 */
export function createGlyphAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = CELL_SIZE * GLYPH_COUNT;
  canvas.height = CELL_SIZE;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";

  const drawCell = (idx, fn) => {
    ctx.save();
    ctx.translate(idx * CELL_SIZE, 0);
    fn();
    ctx.restore();
  };

  // 0: empty
  // 1: faint single center speck (~2.5%)
  drawCell(1, () => {
    ctx.fillRect(28, 28, 8, 8);
  });

  // 2: small crisp dot (~6%)
  drawCell(2, () => {
    ctx.fillRect(24, 24, 16, 16);
  });

  // 3: vertical pair / colon (:) (~11%)
  drawCell(3, () => {
    ctx.fillRect(25, 14, 14, 14);
    ctx.fillRect(25, 36, 14, 14);
  });

  // 4: medium dot / compact square (~18%)
  drawCell(4, () => {
    ctx.fillRect(19, 19, 26, 26);
  });

  // 5: slim plus (+) (~26%)
  drawCell(5, () => {
    ctx.fillRect(26, 10, 12, 44);
    ctx.fillRect(10, 26, 44, 12);
  });

  // 6: crisp 2x2 micro-dot grid (~34%)
  drawCell(6, () => {
    ctx.fillRect(12, 12, 16, 16);
    ctx.fillRect(36, 12, 16, 16);
    ctx.fillRect(12, 36, 16, 16);
    ctx.fillRect(36, 36, 16, 16);
  });

  // 7: bold cross (+) (~42%)
  drawCell(7, () => {
    ctx.fillRect(22, 8, 20, 48);
    ctx.fillRect(8, 22, 48, 20);
  });

  // 8: hollow square / frame (~50%)
  drawCell(8, () => {
    ctx.fillRect(10, 10, 44, 44);
    ctx.clearRect(22, 22, 20, 20);
  });

  // 9: 2x2 dense matrix block (~59%)
  drawCell(9, () => {
    ctx.fillRect(8, 8, 21, 21);
    ctx.fillRect(35, 8, 21, 21);
    ctx.fillRect(8, 35, 21, 21);
    ctx.fillRect(35, 35, 21, 21);
  });

  // 10: slotted block with fine crosshair gap (~68%)
  drawCell(10, () => {
    ctx.fillRect(7, 7, 50, 50);
    ctx.clearRect(29, 7, 6, 50);
    ctx.clearRect(7, 29, 50, 6);
  });

  // 11: high-density cream matrix block with crisp 6px outer gutter (~76%)
  drawCell(11, () => {
    ctx.fillRect(6, 6, 52, 52);
    ctx.clearRect(29, 29, 6, 6);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return {
    texture,
    count: GLYPH_COUNT,
    dispose() {
      texture.dispose();
    },
  };
}
