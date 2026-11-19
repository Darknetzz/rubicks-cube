// The "next move" arrow drawn on a 3×3 (real-cube mode). Geometry comes from arrowSpec (js/arrowspec.js), which
// is tested against the facelet model, so the arrow always points the way the stickers really move.
import * as THREE from 'three';
import { arrowSpec, arrowView } from './arrowspec.js';

const OUT = 1.56; // just above the stickers (outer faces are at 1.5)
const TUBE = 0.055;
const HEAD = { radius: 0.17, length: 0.36 };
const OUTLINE = 1.6; // outline size relative to the arrow
const Y = new THREE.Vector3(0, 1, 0);
const v3 = (a) => new THREE.Vector3(...a);

class Arc extends THREE.Curve {
  constructor(centre, u, w, radius, from, to) {
    super();
    Object.assign(this, { centre, u, w, radius, from, to });
  }

  getPoint(t, target = new THREE.Vector3()) {
    const a = this.from + (this.to - this.from) * t;
    return target.copy(this.centre).addScaledVector(this.u, this.radius * Math.cos(a)).addScaledVector(this.w, this.radius * Math.sin(a));
  }
}

function labelTexture(text) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 80;
  const g = c.getContext('2d');
  g.font = 'bold 60px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 12;
  g.strokeStyle = '#111';
  g.strokeText(text, 64, 42);
  g.fillStyle = '#fff';
  g.fillText(text, 64, 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class MoveArrow {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.renderOrder = 10;
    scene.add(this.group);
    this.fill = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.edge = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.BackSide });
    this.move = null;
    this.spec = null;
    this.face = null; // { part, normal }
    this.strips = []; // [{ part, normal }], same order as spec.strips
    this.arcShown = false;
    this.owned = []; // geometries / textures / sprite materials to dispose
  }

  /** Show the arrow for `move` (e.g. "R'", "U2"), or hide it with null. */
  show(move) {
    if (move === this.move) return;
    this.clear();
    this.move = move;
    if (!move) return;
    let spec;
    try {
      spec = arrowSpec(move);
    } catch {
      return;
    }
    this.spec = spec;
    const axis = v3([0, 1, 2].map((k) => (k === spec.axis ? 1 : 0)));
    if (spec.face) {
      // Arc around the turning axis on the outer face; increasing angle = positive rotation about +axis.
      const normal = v3(spec.face);
      const u = v3([0, 1, 2].map((k) => (k === (spec.axis + 1) % 3 ? 1 : 0)));
      const w = new THREE.Vector3().crossVectors(axis, u);
      const start = Math.PI * 0.6;
      const span = Math.PI * 1.45 * spec.sense;
      const curve = new Arc(normal.clone().multiplyScalar(OUT), u, w, 0.92, start, start + span);
      const part = this.#arrow(curve, spec.half, normal);
      this.face = { part, normal };
    }
    for (const { normal: n, dir: d } of spec.strips) {
      const normal = v3(n);
      const dir = v3(d);
      const base = normal.clone().multiplyScalar(OUT).addScaledVector(axis, spec.layerCentre);
      const curve = new THREE.LineCurve3(base.clone().addScaledVector(dir, -1.05), base.clone().addScaledVector(dir, 0.95));
      this.strips.push({ part: this.#arrow(curve, spec.half, normal), normal });
    }
  }

  hide() {
    this.show(null);
  }

  /**
   * Per frame (so it follows the orbit): the arc on the turning face while that face is within ~70° of the view,
   * else straight arrows along the moving row/column on the visible neighbouring faces (see arrowView).
   */
  update(camera) {
    if (!this.spec) return;
    const { arc, strips } = arrowView(this.spec, camera.position.toArray(), this.arcShown);
    this.arcShown = arc;
    if (this.face) this.face.part.visible = arc;
    this.strips.forEach((s, i) => (s.part.visible = strips.includes(i)));
  }

  clear() {
    this.group.clear();
    for (const x of this.owned) x.dispose();
    this.owned = [];
    this.spec = null;
    this.face = null;
    this.strips = [];
    this.arcShown = false;
    this.move = null;
  }

  // Tube along `curve` with a head at the end (both ends for a half turn, plus a "×2" label).
  #arrow(curve, half, normal) {
    const part = new THREE.Group();
    const add = (geo, mat, scale = 1) => {
      this.owned.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.scale.setScalar(scale);
      part.add(m);
      return m;
    };
    const len = curve.getLength();
    const trim = HEAD.length / len; // the tube stops where the head starts
    const body = new THREE.Curve();
    body.getPoint = (t, target) => curve.getPoint((half ? trim : 0) + t * (1 - trim * (half ? 2 : 1)), target);
    add(new THREE.TubeGeometry(body, 48, TUBE, 8, false), this.fill);
    add(new THREE.TubeGeometry(body, 48, TUBE * OUTLINE, 8, false), this.edge);

    const head = (t, sign) => {
      const tip = curve.getPoint(t);
      const tangent = curve.getTangent(t).multiplyScalar(sign).normalize();
      for (const [mat, s] of [[this.fill, 1], [this.edge, 1.35]]) {
        const geo = new THREE.ConeGeometry(HEAD.radius * s, HEAD.length * s, 20);
        geo.translate(0, -HEAD.length / 2, 0); // tip at the origin
        const m = add(geo, mat);
        m.quaternion.setFromUnitVectors(Y, tangent);
        m.position.copy(tip).addScaledVector(tangent, mat === this.edge ? 0.06 : 0);
      }
    };
    head(1, 1);
    if (half) {
      head(0, -1);
      const tex = labelTexture('×2');
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
      this.owned.push(tex, mat);
      const label = new THREE.Sprite(mat);
      label.scale.set(0.7, 0.44, 1);
      label.renderOrder = 20;
      label.position.copy(curve.getPoint(0.5)).addScaledVector(normal, 0.35);
      if (curve instanceof Arc) label.position.copy(curve.centre).addScaledVector(normal, 0.1);
      part.add(label);
    }
    this.group.add(part);
    return part;
  }
}
