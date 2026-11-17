// Translucent slabs over the layer(s) a drag would turn: both candidates while hovering, the chosen one once dragging.
import * as THREE from 'three';

const PAD = 0.04;

export class LayerHighlight {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.renderOrder = 2;
    scene.add(this.group);
    this.fill = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
    this.line = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
    this.key = '';
  }

  /** layers: [{ axis, layer }] with layer as 0..n-1; n: cube size. Empty / null hides. */
  show(layers, n) {
    const list = layers ?? [];
    const key = `${n}|${list.map((l) => `${l.axis}:${l.layer}`).join(',')}`;
    if (key === this.key) return;
    this.key = key;
    this.clear();
    const off = (n - 1) / 2;
    for (const { axis, layer } of list) {
      const size = [n + PAD, n + PAD, n + PAD];
      size[axis] = 1 + PAD;
      const geo = new THREE.BoxGeometry(...size);
      const box = new THREE.Mesh(geo, this.fill);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.line);
      edges.renderOrder = 3;
      for (const o of [box, edges]) {
        o.position.setComponent(axis, layer - off);
        this.group.add(o);
      }
    }
  }

  clear() {
    for (const o of this.group.children) o.geometry.dispose();
    this.group.clear();
  }

  hide() {
    this.key = '';
    this.clear();
  }
}
