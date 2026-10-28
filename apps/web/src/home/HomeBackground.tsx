import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { generateObject, OBJECT_KINDS, type ObjectKind, type Plane } from "@slice-even/core";
import { StudioEnvironment } from "../scene/GameCanvas.tsx";
import { createMaterials, type ObjectMaterials } from "../scene/materials.ts";
import { splitGeometry, toBufferGeometry } from "../scene/geometry.ts";
import { appearanceFor, randomSeed } from "../game.ts";
import { sfx } from "../audio/sfx.ts";

/**
 * Home screen backdrop: the same procedural produce as the game floats up
 * through the screen. Swipe fast across one and it splits, Fruit Ninja style.
 */

interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

/** Pointer samples shared by the 3D scene (hit tests) and the 2D trail. */
type Trail = TrailPoint[];

const TRAIL_MS = 160;
/** Minimum swipe speed to cut, px/s. Slow hovering never slices. */
const SLICE_SPEED = 700;

export function HomeBackground({ onSlice }: { onSlice(): void }) {
  const trail = useRef<Trail>([]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      trail.current.push({ x: e.clientX, y: e.clientY, t: now });
      while (trail.current.length && now - trail.current[0]!.t > 400) trail.current.shift();
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <>
      <div className="home-bg">
        <Canvas camera={{ position: [0, 0, 60], fov: 40 }} gl={{ alpha: true }} dpr={[1, 1.75]}>
          <StudioEnvironment intensity={0.5} />
          <hemisphereLight args={["#fff4e6", "#13808a", 0.35]} />
          <directionalLight position={[10, 20, 25]} intensity={1.5} />
          <directionalLight position={[-20, -5, 10]} intensity={0.7} color="#ffb199" />
          <FloatingProduce trail={trail} onSlice={onSlice} />
        </Canvas>
      </div>
      <TrailCanvas trail={trail} />
    </>
  );
}

/* ------------------------------------------------------------------ 3D */

interface Item {
  kind: ObjectKind;
  group: THREE.Group;
  geometry: THREE.BufferGeometry;
  materials: ObjectMaterials;
  velocity: THREE.Vector3;
  spinAxis: THREE.Vector3;
  spin: number;
  radius: number;
  sway: number;
}

interface Debris {
  mesh: THREE.Mesh;
  /** Both halves share the materials; the last one to go disposes them. */
  shared: { left: number; materials: ObjectMaterials };
  velocity: THREE.Vector3;
  spinAxis: THREE.Vector3;
  spin: number;
  age: number;
  scale: number;
}

interface Burst {
  mesh: THREE.InstancedMesh;
  velocities: THREE.Vector3[];
  positions: THREE.Vector3[];
  sizes: number[];
  age: number;
}

const GRAVITY = 32;
const BURST_COUNT = 36;

function FloatingProduce({ trail, onSlice }: { trail: React.RefObject<Trail>; onSlice(): void }) {
  const root = useRef<THREE.Group>(null!);
  const { camera, size } = useThree();
  const world = useMemo(() => ({ items: [] as Item[], debris: [] as Debris[], bursts: [] as Burst[] }), []);
  const dropGeometry = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);

  // Visible half-extents of the z = 0 plane.
  const view = () => {
    const cam = camera as THREE.PerspectiveCamera;
    const h = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.position.z;
    return { w: h * cam.aspect, h };
  };

  const spawn = (initial: boolean) => {
    const kind = OBJECT_KINDS[Math.floor(Math.random() * OBJECT_KINDS.length)]!;
    const seed = randomSeed();
    const object = generateObject(kind, seed, "preview");
    const geometry = toBufferGeometry(object.mesh);
    geometry.computeBoundingSphere();
    const materials = createMaterials(object, appearanceFor(seed).skinColor);
    const mesh = new THREE.Mesh(geometry, materials.skin);
    const group = new THREE.Group();
    group.add(mesh);
    const { w, h } = view();
    const scale = 0.75 + Math.random() * 0.35;
    group.scale.setScalar(scale);
    const z = -18 + Math.random() * 22;
    group.position.set((Math.random() * 2 - 1) * w * 0.95, initial ? (Math.random() * 2 - 1) * h : -h - 14, z);
    group.quaternion.random();
    root.current.add(group);
    world.items.push({
      kind,
      group,
      geometry,
      materials,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 1.5, 2.5 + Math.random() * 3, 0),
      spinAxis: new THREE.Vector3().randomDirection(),
      spin: 0.2 + Math.random() * 0.6,
      radius: geometry.boundingSphere!.radius * scale,
      sway: Math.random() * Math.PI * 2,
    });
  };

  useEffect(() => {
    const count = size.width < 700 ? 6 : 10;
    for (let i = 0; i < count; i++) spawn(true);
    return () => {
      for (const item of world.items) disposeItem(item);
      for (const d of world.debris) removeDebris(d);
      for (const b of world.bursts) disposeBurst(b);
      world.items.length = 0;
      world.debris.length = 0;
      world.bursts.length = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disposeItem = (item: Item) => {
    item.group.removeFromParent();
    item.geometry.dispose();
    item.materials.skin.dispose();
    item.materials.flesh.dispose();
  };
  const removeDebris = (d: Debris) => {
    d.mesh.removeFromParent();
    d.mesh.geometry.dispose();
    if (--d.shared.left === 0) {
      d.shared.materials.skin.dispose();
      d.shared.materials.flesh.dispose();
    }
  };
  const disposeBurst = (b: Burst) => {
    b.mesh.removeFromParent();
    (b.mesh.material as THREE.Material).dispose();
  };

  const slice = (item: Item, swipe: THREE.Vector2, speed: number) => {
    // Blade plane: contains the view direction and the swipe direction.
    const normalWorld = new THREE.Vector3(swipe.y, swipe.x, 0).normalize();
    const inverse = item.group.quaternion.clone().invert();
    const localNormal = normalWorld.clone().applyQuaternion(inverse);
    const plane: Plane = { point: [0, 0, 0], normal: [localNormal.x, localNormal.y, localNormal.z] };
    const halves = splitGeometry(item.geometry, plane, item.materials.skin, item.materials.flesh);

    const push = Math.min(14, 5 + speed / 400);
    const swipeWorld = new THREE.Vector3(swipe.x, -swipe.y, 0).normalize();
    const shared = { left: 2, materials: item.materials };
    [halves.front, halves.back].forEach((mesh, i) => {
      const sign = i === 0 ? 1 : -1;
      mesh.position.copy(item.group.position);
      mesh.quaternion.copy(item.group.quaternion);
      mesh.scale.copy(item.group.scale);
      root.current.add(mesh);
      world.debris.push({
        mesh,
        shared,
        velocity: normalWorld
          .clone()
          .multiplyScalar(sign * push)
          .addScaledVector(swipeWorld, 6)
          .add(new THREE.Vector3(0, 8, 0)),
        spinAxis: new THREE.Vector3().randomDirection(),
        spin: sign * (2 + Math.random() * 3),
        age: 0,
        scale: item.group.scale.x,
      });
    });
    // The halves keep the materials; only the source geometry goes.
    item.group.removeFromParent();
    item.geometry.dispose();
    world.items.splice(world.items.indexOf(item), 1);
    addBurst(item.group.position, normalWorld, swipeWorld, item.materials.splash);
    sfx.cut(item.kind);
    setTimeout(() => {
      if (root.current) spawn(false);
    }, 700);
    onSlice();
  };

  const addBurst = (origin: THREE.Vector3, normal: THREE.Vector3, swipe: THREE.Vector3, color: string) => {
    const material = new THREE.MeshPhysicalMaterial({ color, roughness: 0.15, clearcoat: 1 });
    const mesh = new THREE.InstancedMesh(dropGeometry, material, BURST_COUNT);
    mesh.frustumCulled = false;
    root.current.add(mesh);
    world.bursts.push({
      mesh,
      positions: Array.from({ length: BURST_COUNT }, () => origin.clone()),
      velocities: Array.from({ length: BURST_COUNT }, () =>
        normal
          .clone()
          .multiplyScalar((Math.random() * 2 - 1) * 22)
          .addScaledVector(swipe, 4 + Math.random() * 14)
          .add(new THREE.Vector3().randomDirection().multiplyScalar(6))
          .add(new THREE.Vector3(0, 6, 0)),
      ),
      sizes: Array.from({ length: BURST_COUNT }, () => 0.2 + Math.random() * 0.45),
      age: 0,
    });
  };

  const lastPointer = useRef<TrailPoint | null>(null);
  const lastWhoosh = useRef(0);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const { w, h } = view();
    const cam = camera as THREE.PerspectiveCamera;

    // Gentle parallax towards the pointer.
    cam.position.x += (state.pointer.x * 3 - cam.position.x) * 0.04;
    cam.position.y += (state.pointer.y * 2 - cam.position.y) * 0.04;
    cam.lookAt(0, 0, 0);

    // Swipe segment since the previous frame, in screen pixels.
    const points = trail.current;
    const latest = points[points.length - 1] ?? null;
    let swipe: { a: TrailPoint; b: TrailPoint; speed: number } | null = null;
    if (latest && lastPointer.current && latest !== lastPointer.current && performance.now() - latest.t < 60) {
      const a = lastPointer.current;
      const dist = Math.hypot(latest.x - a.x, latest.y - a.y);
      const speed = dist / Math.max(1e-3, (latest.t - a.t) / 1000);
      if (speed > SLICE_SPEED && dist > 4) {
        swipe = { a, b: latest, speed };
        // One whoosh per swipe, not per frame.
        if (latest.t - lastWhoosh.current > 220) sfx.whoosh(Math.min(1, speed / 3000));
        lastWhoosh.current = latest.t;
      }
    }
    lastPointer.current = latest;

    for (const item of [...world.items]) {
      const g = item.group;
      item.sway += dt;
      g.position.addScaledVector(item.velocity, dt);
      g.position.x += Math.sin(item.sway * 0.8) * dt * 1.2;
      g.rotateOnWorldAxis(item.spinAxis, item.spin * dt);
      if (g.position.y > h + 14) {
        disposeItem(item);
        world.items.splice(world.items.indexOf(item), 1);
        spawn(false);
        continue;
      }
      if (g.position.x > w + 10) g.position.x = -w - 10;
      if (g.position.x < -w - 10) g.position.x = w + 10;

      if (swipe) {
        projected.copy(g.position).project(cam);
        const sx = (projected.x * 0.5 + 0.5) * size.width;
        const sy = (-projected.y * 0.5 + 0.5) * size.height;
        const distance = cam.position.distanceTo(g.position);
        const screenR = (item.radius / (distance * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)))) * (size.height / 2);
        if (segmentDistance(sx, sy, swipe.a, swipe.b) < screenR * 0.85) {
          slice(item, new THREE.Vector2(swipe.b.x - swipe.a.x, swipe.b.y - swipe.a.y).normalize(), swipe.speed);
        }
      }
    }

    for (const d of [...world.debris]) {
      d.age += dt;
      d.velocity.y -= GRAVITY * dt;
      d.mesh.position.addScaledVector(d.velocity, dt);
      d.mesh.rotateOnWorldAxis(d.spinAxis, d.spin * dt);
      const fade = THREE.MathUtils.clamp(1 - (d.age - 1.2) / 0.6, 0, 1);
      d.mesh.scale.setScalar(d.scale * fade);
      if (fade === 0 || d.mesh.position.y < -h - 30) {
        removeDebris(d);
        world.debris.splice(world.debris.indexOf(d), 1);
      }
    }

    for (const b of [...world.bursts]) {
      b.age += dt;
      const fade = THREE.MathUtils.clamp(1 - b.age / 1.1, 0, 1);
      b.positions.forEach((p, i) => {
        const v = b.velocities[i]!;
        v.y -= GRAVITY * 1.4 * dt;
        p.addScaledVector(v, dt);
        dummy.position.copy(p);
        dummy.scale.setScalar(b.sizes[i]! * fade);
        dummy.updateMatrix();
        b.mesh.setMatrixAt(i, dummy.matrix);
      });
      b.mesh.instanceMatrix.needsUpdate = true;
      if (fade === 0) {
        disposeBurst(b);
        world.bursts.splice(world.bursts.indexOf(b), 1);
      }
    }
  });

  useEffect(() => () => dropGeometry.dispose(), [dropGeometry]);
  return <group ref={root} />;
}

function segmentDistance(px: number, py: number, a: TrailPoint, b: TrailPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = THREE.MathUtils.clamp(((px - a.x) * dx + (py - a.y) * dy) / len2, 0, 1);
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/* ------------------------------------------------------------------ 2D trail */

/** Glowing blade trail drawn over everything, fading within TRAIL_MS. */
function TrailCanvas({ trail }: { trail: React.RefObject<Trail> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    let frame = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      el.width = innerWidth * dpr;
      el.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      frame = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      const now = performance.now();
      const pts = trail.current.filter((p) => now - p.t < TRAIL_MS);
      if (pts.length < 2) return;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const life = 1 - (now - b.t) / TRAIL_MS;
        const speed = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, b.t - a.t);
        if (speed < 0.3) continue;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * life})`;
        ctx.shadowColor = "rgba(255, 220, 120, 0.9)";
        ctx.shadowBlur = 18 * life;
        ctx.lineWidth = 2 + 9 * life;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [trail]);
  return <canvas ref={canvas} className="home-trail" />;
}
