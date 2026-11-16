import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { faceletIndex } from './facelets.js';

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const Z = new THREE.Vector3(0, 0, 1);
const FACES = [
  { key: 'R', axis: 0, dir: 1 }, { key: 'L', axis: 0, dir: -1 },
  { key: 'U', axis: 1, dir: 1 }, { key: 'D', axis: 1, dir: -1 },
  { key: 'F', axis: 2, dir: 1 }, { key: 'B', axis: 2, dir: -1 },
];

const ease = (t) => 1 - Math.pow(1 - t, 3);

function roundedSquare(size, r) {
  const s = size / 2;
  const sh = new THREE.Shape();
  sh.moveTo(-s + r, -s);
  sh.lineTo(s - r, -s);
  sh.quadraticCurveTo(s, -s, s, -s + r);
  sh.lineTo(s, s - r);
  sh.quadraticCurveTo(s, s, s - r, s);
  sh.lineTo(-s + r, s);
  sh.quadraticCurveTo(-s, s, -s, s - r);
  sh.lineTo(-s, -s + r);
  sh.quadraticCurveTo(-s, -s, -s + r, -s);
  return new THREE.ShapeGeometry(sh, 4);
}

export class Cube {
  constructor(scene, { size, colors, body }) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.bodyGeo = new RoundedBoxGeometry(0.96, 0.96, 0.96, 3, 0.09);
    this.stickerGeo = roundedSquare(0.84, 0.12);
    this.bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 });
    this.faceMats = Object.fromEntries(
      FACES.map((f) => [f.key, new THREE.MeshStandardMaterial({ roughness: 0.35 })]),
    );
    this.setColors(colors, body);
    this.speed = 180;
    this.onTurnDone = null;
    this.build(size);
  }

  get busy() {
    return !!this.anim || this.queue.length > 0;
  }

  setColors(colors, body) {
    for (const f of FACES) this.faceMats[f.key].color.set(colors[f.key]);
    this.bodyMat.color.set(body);
  }

  build(n) {
    this.queue = [];
    this.anim = null;
    this.core?.geometry.dispose();
    this.core = null;
    this.root.clear();
    this.n = n;
    this.off = (n - 1) / 2;
    this.cubies = [];
    this.stickers = [];

    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        for (let k = 0; k < n; k++) {
          const idx = [i, j, k];
          if (!idx.some((v) => v === 0 || v === n - 1)) continue; // hollow inside
          const c = new THREE.Mesh(this.bodyGeo, this.bodyMat);
          c.position.set(i - this.off, j - this.off, k - this.off);
          for (const f of FACES) {
            if (idx[f.axis] !== (f.dir > 0 ? n - 1 : 0)) continue;
            const normal = new THREE.Vector3().setComponent(f.axis, f.dir);
            const s = new THREE.Mesh(this.stickerGeo, this.faceMats[f.key]);
            s.quaternion.setFromUnitVectors(Z, normal);
            s.position.copy(normal).multiplyScalar(0.485);
            s.userData = { face: f.key, normal };
            c.add(s);
            this.stickers.push(s);
          }
          this.root.add(c);
          this.cubies.push(c);
        }

    // Dark sphere fills the hollow core so you can't see through gaps while turning.
    if (n > 2) {
      this.core = new THREE.Mesh(new THREE.SphereGeometry(this.off - 0.5, 32, 16), this.bodyMat);
      this.root.add(this.core);
    }
  }

  enqueue(turns, speedFactor = 1) {
    for (const t of [].concat(turns)) this.queue.push({ ...t, speedFactor });
  }

  update(now) {
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (now - a.start) / a.duration);
      a.pivot.setRotationFromAxisAngle(AXES[a.turn.axis], a.angle * ease(t));
      if (t >= 1) this.finishAnim();
    }
    while (!this.anim && this.queue.length) {
      const turn = this.queue.shift();
      const duration = this.speed * turn.speedFactor * (Math.abs(turn.turns) === 2 ? 1.5 : 1);
      if (duration < 1) {
        this.applyInstant(turn);
        this.onTurnDone?.(turn);
      } else {
        const pivot = new THREE.Group();
        this.root.add(pivot);
        for (const c of this.layerCubies(turn)) pivot.attach(c);
        this.anim = { turn, pivot, start: now, duration, angle: (turn.turns * Math.PI) / 2 };
      }
    }
  }

  finishAnim() {
    const { pivot, turn, angle } = this.anim;
    pivot.setRotationFromAxisAngle(AXES[turn.axis], angle);
    pivot.updateMatrixWorld(true);
    for (const c of [...pivot.children]) {
      this.root.attach(c);
      this.snap(c);
    }
    this.root.remove(pivot);
    this.anim = null;
    this.onTurnDone?.(turn);
  }

  applyInstant(turn) {
    const q = new THREE.Quaternion().setFromAxisAngle(AXES[turn.axis], (turn.turns * Math.PI) / 2);
    for (const c of this.layerCubies(turn)) {
      c.position.applyQuaternion(q);
      c.quaternion.premultiply(q);
      this.snap(c);
    }
  }

  layerCubies({ axis, layers }) {
    return this.cubies.filter((c) => layers.includes(Math.round(c.position.getComponent(axis) + this.off)));
  }

  // Remove float drift: positions back onto the grid, rotation matrix back to integers.
  snap(c) {
    const o = this.off;
    c.position.set(Math.round(c.position.x + o) - o, Math.round(c.position.y + o) - o, Math.round(c.position.z + o) - o);
    const m = new THREE.Matrix4().makeRotationFromQuaternion(c.quaternion);
    for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) m.elements[i] = Math.round(m.elements[i]);
    c.quaternion.setFromRotationMatrix(m);
  }

  /** Every outward direction shows a single colour. Only valid when not animating. */
  isSolved() {
    const seen = new Map();
    const v = new THREE.Vector3();
    for (const s of this.stickers) {
      v.copy(s.userData.normal).applyQuaternion(s.parent.quaternion);
      const key = `${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.z)}`;
      const face = seen.get(key);
      if (face === undefined) seen.set(key, s.userData.face);
      else if (face !== s.userData.face) return false;
    }
    return true;
  }

  #faceletOf(sticker) {
    const n = sticker.userData.normal.clone().applyQuaternion(sticker.parent.quaternion);
    return faceletIndex(sticker.parent.position.toArray(), n.toArray());
  }

  /** 3×3 only, when idle: 54-char Kociemba-order string of colour letters (see facelets.js). */
  getFacelets() {
    if (this.n !== 3 || this.busy) return null;
    const out = new Array(54);
    for (const s of this.stickers) out[this.#faceletOf(s)] = s.userData.face;
    return out.join('');
  }

  /** Rebuild as a 3×3 in standard orientation and colour every sticker from a facelet string. */
  setFacelets(str) {
    this.build(3);
    for (const s of this.stickers) this.paint(s, str[this.#faceletOf(s)]);
  }

  paint(sticker, face) {
    sticker.material = this.faceMats[face];
    sticker.userData.face = face;
  }

  /** Sticker under the ray (a hit on the gap around it counts too), or null. */
  stickerAt(raycaster) {
    const hit = this.pick(raycaster);
    if (!hit) return null;
    const v = new THREE.Vector3();
    return hit.cubie.children.find((s) => v.copy(s.userData.normal).applyQuaternion(hit.cubie.quaternion).dot(hit.normal) > 0.9) ?? null;
  }

  /** Raycast to an outer face: returns { cubie, point, normal } with an axis-aligned normal, or null. */
  pick(raycaster) {
    const hit = raycaster.intersectObjects(this.cubies, true)[0];
    if (!hit) return null;
    const isSticker = !!hit.object.userData.face;
    const cubie = isSticker ? hit.object.parent : hit.object;
    const n = (isSticker ? hit.object.userData.normal : hit.face.normal).clone().applyQuaternion(cubie.quaternion);
    let a = 0;
    for (let i = 1; i < 3; i++) if (Math.abs(n.getComponent(i)) > Math.abs(n.getComponent(a))) a = i;
    const sign = Math.sign(n.getComponent(a));
    if (Math.abs(cubie.position.getComponent(a) - sign * this.off) > 0.01) return null;
    return { cubie, point: hit.point.clone(), normal: new THREE.Vector3().setComponent(a, sign) };
  }
}
