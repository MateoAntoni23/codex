/**
 * placementCore — la colocación de una pieza como DATO (hito 2, fase A).
 *
 * Una pieza colocada guarda:
 *   - la definición efectiva usada (patrón, revisión, parámetros y huella), cuyo
 *     contenido completo vive en la tabla `definiciones_ws` del trazado, para que
 *     la pieza no cambie si cambia la biblioteca (A-6);
 *   - la mano (`nativa` | `espejo`): una VARIANTE de la definición (la definición
 *     espejada), no una matriz reflejada (A-3);
 *   - la pose: posición + rotación (cuaternión unitario). Siempre una rotación.
 *
 * Las bocas en el mundo se DERIVAN de pose + definición (+ mano). Una sola ruta
 * de colocación con marco completo (normal y orientación transversal) para
 * entradas horizontales y verticales (A-4).
 *
 * Módulo puro: sin React ni stores. Lo consumen el preview, la confirmación,
 * el render, la migración, el movimiento y el adaptador del motor.
 */
import * as THREE from 'three';
import type { GeometryRecipe } from '../../parametric/geometry/outlines';
import { buildPrism } from '../../parametric/geometry/buildPrism';
import { canonicalJson } from '../../configurator/libraryBlock';

export type V3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Mano = 'nativa' | 'espejo';

/** Boca de la definición en su marco local (post calibración, mano nativa). */
export interface DefPort {
  readonly name: string;
  readonly center: V3;
  readonly normal: V3;
  /** Orientación transversal: "arriba" de la sección (fondo de bandeja → hacia arriba). */
  readonly v_dir: V3;
  readonly ancho_mm: number;
  readonly ala_mm: number;
}

/** Contenido completo de una definición efectiva, autosuficiente para dibujar. */
export interface StoredDefinition {
  readonly version: 'codex:definicion/1';
  /** Patrón (id de maestro) o receta medida legacy. */
  readonly patron: string;
  /** Revisión del patrón al momento de colocar. */
  readonly revision: string;
  readonly params: Readonly<Record<string, number>>;
  /** Malla en coordenadas crudas de la receta + calibración (raw → local). */
  readonly mesh: {
    readonly polygon: ReadonlyArray<readonly [number, number]>;
    readonly height: number;
    readonly extrudeAlongY: boolean;
    readonly translate: V3;
    /** Matriz 4x4 (column-major, THREE) de la calibración del modelo. */
    readonly preTransform: readonly number[];
  };
  readonly ports: readonly DefPort[];
}

export interface Pose {
  readonly posicion_mm: V3;
  /** Cuaternión unitario [x, y, z, w]. */
  readonly rotacion: Quat;
}

export interface ColocacionResuelta {
  readonly version: 1;
  readonly estado: 'resuelta';
  readonly definicion: {
    readonly huella: string;
    readonly patron: string;
    readonly revision: string;
    readonly params: Readonly<Record<string, number>>;
  };
  readonly mano: Mano;
  readonly pose: Pose;
  /** Boca por la que se colocó (informativo; las bocas se derivan de la pose). */
  readonly boca_entrada?: string;
}

export interface ColocacionSinResolver {
  readonly version: 1;
  readonly estado: 'sin_resolver';
  readonly motivo: string;
}

export type Colocacion = ColocacionResuelta | ColocacionSinResolver;

/** Boca colocada en el mundo (mm, Z arriba). */
export interface WorldPort {
  readonly name: string;
  readonly pos: V3;
  readonly normal: V3;
  readonly vDir: V3;
  readonly uDir: V3;
  readonly ancho_mm: number;
  readonly ala_mm: number;
}

// ─── Álgebra mínima ──────────────────────────────────────────────────────────

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: readonly number[]) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: readonly number[]): V3 => {
  const n = norm(a);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [a[0], a[1], a[2]];
};
export const angleDeg = (a: readonly number[], b: readonly number[]): number => {
  const c = Math.max(-1, Math.min(1, dot(unit(a), unit(b))));
  return (Math.acos(c) * 180) / Math.PI;
};

type M3 = [V3, V3, V3]; // filas

function m3MulV(m: M3, v: readonly number[]): V3 {
  return [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
}

export function quatFromM3(m: M3): Quat {
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = m;
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w);
  return [x / n, y / n, z / n, w / n];
}

export function m3FromQuat(q: readonly number[]): M3 {
  const [x, y, z, w] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

export function quatMul(a: readonly number[], b: readonly number[]): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatFromAxisAngle(axis: readonly number[], deg: number): Quat {
  const a = unit(axis);
  const h = (deg * Math.PI) / 360;
  const s = Math.sin(h);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)];
}

// ─── Mano: la definición espejada ────────────────────────────────────────────
//
// S = reflexión z → −z en el marco local de la definición. Cualquier reflexión
// sirve: la colocación alinea el marco de la boca de entrada, así que el cuerpo
// colocado es el mismo para cualquier S (es la reflexión del cuerpo nativo
// respecto del plano normal–orientación transversal de la boca de entrada).

const S: M3 = [[1, 0, 0], [0, 1, 0], [0, 0, -1]];
const S4 = new THREE.Matrix4().makeScale(1, 1, -1);

/** Bocas de la definición con la mano aplicada (marco local). */
export function portsForHand(def: StoredDefinition, mano: Mano): DefPort[] {
  if (mano === 'nativa') return def.ports.map((p) => ({ ...p }));
  return def.ports.map((p) => ({
    ...p,
    center: m3MulV(S, p.center),
    normal: m3MulV(S, p.normal),
    v_dir: m3MulV(S, p.v_dir),
  }));
}

/**
 * Matriz raw → local de la malla para la mano dada: S · preTransform (espejo) o
 * preTransform (nativa). Se HORNEA en la geometría; el objeto de la escena sólo
 * lleva la pose (rotación + traslación).
 */
export function meshLocalMatrix(def: StoredDefinition, mano: Mano): THREE.Matrix4 {
  const pre = new THREE.Matrix4().fromArray(def.mesh.preTransform as number[]);
  return mano === 'espejo' ? S4.clone().multiply(pre) : pre;
}

/** Geometría local (en marco de la definición, mano aplicada). */
export function buildDefinitionGeometry(def: StoredDefinition, mano: Mano): THREE.BufferGeometry {
  const geom = buildPrism(def.mesh.polygon as Array<[number, number]>, def.mesh.height, def.mesh.extrudeAlongY);
  const [tx, ty, tz] = def.mesh.translate;
  if (tx !== 0 || ty !== 0 || tz !== 0) geom.translate(tx, ty, tz);
  const m = meshLocalMatrix(def, mano);
  geom.applyMatrix4(m);
  if (m.determinant() < 0) flipWinding(geom);
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

/** Invierte el orden de los triángulos (la reflexión cambió la orientación). */
function flipWinding(geom: THREE.BufferGeometry): void {
  const index = geom.getIndex();
  if (index) {
    const arr = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
    index.needsUpdate = true;
    return;
  }
  for (const name of Object.keys(geom.attributes)) {
    const attr = geom.getAttribute(name) as THREE.BufferAttribute;
    const n = attr.itemSize;
    const a = attr.array as Float32Array;
    for (let i = 0; i < attr.count; i += 3) {
      for (let k = 0; k < n; k++) {
        const t = a[(i + 1) * n + k];
        a[(i + 1) * n + k] = a[(i + 2) * n + k];
        a[(i + 2) * n + k] = t;
      }
    }
    attr.needsUpdate = true;
  }
}

// ─── Huella ──────────────────────────────────────────────────────────────────

function roundDeep(v: unknown): unknown {
  if (typeof v === 'number') return Math.round(v * 1e6) / 1e6 + 0; // +0 normaliza -0
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = roundDeep(x);
    return o;
  }
  return v;
}

function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Huella de la definición efectiva (contenido completo, redondeado a 1e-6). */
export function definitionHash(def: StoredDefinition): string {
  return `def-${cyrb53(canonicalJson(roundDeep(def)))}`;
}

// ─── Construcción de una definición desde una receta resuelta ────────────────

export function definitionFromRecipe(input: {
  patron: string;
  revision: string;
  params: Record<string, number>;
  /** Receta cruda (polígono, altura, translate). */
  raw: GeometryRecipe;
  /** Receta resuelta (bocas post calibración, marco local de la definición). */
  resolved: GeometryRecipe;
  preTransform: THREE.Matrix4;
}): StoredDefinition {
  return {
    version: 'codex:definicion/1',
    patron: input.patron,
    revision: input.revision,
    params: { ...input.params },
    mesh: {
      polygon: input.raw.polygon.map(([a, b]) => [a, b] as const),
      height: input.raw.height,
      extrudeAlongY: input.raw.extrudeAlongY,
      translate: [input.raw.translate[0], input.raw.translate[1], input.raw.translate[2]],
      preTransform: input.preTransform.toArray(),
    },
    ports: input.resolved.ports.map((p) => ({
      name: p.name,
      center: [p.center[0], p.center[1], p.center[2]],
      normal: unit(p.normal),
      v_dir: unit(p.v_dir),
      ancho_mm: p.ancho_mm,
      ala_mm: p.ala_mm,
    })),
  };
}

// ─── Colocación: una sola ruta con marco completo ────────────────────────────

/**
 * Orientación transversal a usar cuando el caller no la provee: Z del mundo
 * proyectada perpendicular a la dirección de avance; si es paralela (entrada
 * vertical), X del mundo. Es un valor explícito y determinista, no un ajuste.
 */
export function defaultSectionUp(entryDir: readonly number[]): V3 {
  const e = unit(entryDir);
  for (const c of [[0, 0, 1], [1, 0, 0], [0, 1, 0]] as const) {
    const p: V3 = [c[0] - dot(c, e) * e[0], c[1] - dot(c, e) * e[1], c[2] - dot(c, e) * e[2]];
    if (norm(p) > 1e-6) return unit(p);
  }
  return [0, 0, 1];
}

export interface PlaceInput {
  readonly def: StoredDefinition;
  readonly huella: string;
  readonly mano: Mano;
  readonly entryPortName: string;
  /** Centro de la boca de la pieza existente (donde va el centro de la boca de entrada). */
  readonly startPos: readonly number[];
  /** Dirección de avance (normal exterior de la boca existente). */
  readonly entryDir: readonly number[];
  /** Orientación transversal de la boca existente (vDir). */
  readonly sectionUp?: readonly number[];
}

export class PlacementError extends Error {}

/**
 * Coloca una definición: la boca de entrada queda con centro = startPos,
 * normal = −entryDir y orientación transversal = sectionUp (proyectada).
 * Devuelve la colocación a guardar y las bocas derivadas.
 */
export function placeDefinition(input: PlaceInput): { colocacion: ColocacionResuelta; ports: WorldPort[] } {
  const local = portsForHand(input.def, input.mano);
  const entry = local.find((p) => p.name === input.entryPortName);
  if (!entry) {
    throw new PlacementError(`la definición no tiene la boca '${input.entryPortName}' (tiene: ${local.map((p) => p.name).join(', ')})`);
  }
  const e = unit(input.entryDir);
  const nW: V3 = [-e[0], -e[1], -e[2]];
  const upIn = input.sectionUp ?? defaultSectionUp(e);
  const up = unit(upIn);
  const vRaw: V3 = [up[0] - dot(up, nW) * nW[0], up[1] - dot(up, nW) * nW[1], up[2] - dot(up, nW) * nW[2]];
  if (norm(vRaw) < 1e-6) {
    throw new PlacementError('la orientación transversal es paralela a la dirección de avance: marco degenerado');
  }
  const vW = unit(vRaw);
  const uW = cross(vW, nW);
  // Marco local de la boca de entrada (derecho por construcción: u = v × n).
  const nL = unit(entry.normal);
  const vL0 = unit(entry.v_dir);
  const vL = unit([vL0[0] - dot(vL0, nL) * nL[0], vL0[1] - dot(vL0, nL) * nL[1], vL0[2] - dot(vL0, nL) * nL[2]]);
  const uL = cross(vL, nL);
  // R = uW⊗uL + vW⊗vL + nW⊗nL  (rotación propia: ambos marcos son derechos).
  const R: M3 = [0, 1, 2].map((i) => [0, 1, 2].map((j) => uW[i] * uL[j] + vW[i] * vL[j] + nW[i] * nL[j]) as V3) as M3;
  const rc = m3MulV(R, entry.center);
  const pose: Pose = {
    posicion_mm: [input.startPos[0] - rc[0], input.startPos[1] - rc[1], input.startPos[2] - rc[2]],
    rotacion: quatFromM3(R),
  };
  const colocacion: ColocacionResuelta = {
    version: 1,
    estado: 'resuelta',
    definicion: {
      huella: input.huella,
      patron: input.def.patron,
      revision: input.def.revision,
      params: { ...input.def.params },
    },
    mano: input.mano,
    pose,
    boca_entrada: input.entryPortName,
  };
  return { colocacion, ports: worldPorts(input.def, input.mano, pose) };
}

/** Bocas en el mundo derivadas de definición + mano + pose. */
export function worldPorts(def: StoredDefinition, mano: Mano, pose: Pose): WorldPort[] {
  const R = m3FromQuat(pose.rotacion);
  const t = pose.posicion_mm;
  return portsForHand(def, mano).map((p) => {
    const c = m3MulV(R, p.center);
    const n = unit(m3MulV(R, p.normal));
    const v = unit(m3MulV(R, p.v_dir));
    return {
      name: p.name,
      pos: [c[0] + t[0], c[1] + t[1], c[2] + t[2]],
      normal: n,
      vDir: v,
      uDir: cross(v, n),
      ancho_mm: p.ancho_mm,
      ala_mm: p.ala_mm,
    };
  });
}

/** Matriz 4x4 (mm) de la pose: es la matrix del objeto en escena. */
export function poseMatrix(pose: Pose): THREE.Matrix4 {
  const [x, y, z, w] = pose.rotacion;
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...pose.posicion_mm),
    new THREE.Quaternion(x, y, z, w),
    new THREE.Vector3(1, 1, 1),
  );
}

/** Bocas del trazado (`piece.puertos`) a partir de las bocas derivadas. */
export function puertosFromWorld(ports: readonly WorldPort[]): Record<string, {
  posicion_mm: [number, number, number];
  direccion: [number, number, number];
  orientacion_seccion_ws: [number, number, number];
}> {
  const out: Record<string, { posicion_mm: [number, number, number]; direccion: [number, number, number]; orientacion_seccion_ws: [number, number, number] }> = {};
  for (const p of ports) {
    out[p.name] = {
      posicion_mm: [p.pos[0], p.pos[1], p.pos[2]],
      direccion: [p.normal[0], p.normal[1], p.normal[2]],
      orientacion_seccion_ws: [p.vDir[0], p.vDir[1], p.vDir[2]],
    };
  }
  return out;
}

/** Aplica una transformación rígida (rotación q alrededor de `pivot`, luego `delta`) a una pose. */
export function transformPose(pose: Pose, q: readonly number[], pivot: readonly number[], delta: readonly number[]): Pose {
  const R = m3FromQuat(q);
  const rel = [pose.posicion_mm[0] - pivot[0], pose.posicion_mm[1] - pivot[1], pose.posicion_mm[2] - pivot[2]];
  const r = m3MulV(R, rel);
  const qn = quatMul(q, pose.rotacion);
  const n = Math.hypot(...qn);
  return {
    posicion_mm: [r[0] + pivot[0] + delta[0], r[1] + pivot[1] + delta[1], r[2] + pivot[2] + delta[2]],
    rotacion: [qn[0] / n, qn[1] / n, qn[2] / n, qn[3] / n],
  };
}

/**
 * ¿La pieza cambia al cambiar de mano? Sí si el conjunto de bocas colocadas
 * difiere (p. ej. una T: la derivación pasa al otro lado). Recto, cruz y curvas
 * verticales son simétricos respecto del plano de la boca de entrada.
 */
export function isHandSensitive(base: Omit<PlaceInput, 'mano'>): boolean {
  try {
    const a = placeDefinition({ ...base, mano: 'nativa' }).ports;
    const b = placeDefinition({ ...base, mano: 'espejo' }).ports;
    const key = (ps: WorldPort[]) => ps.map((p) => p.pos.map((x) => Math.round(x * 100) / 100).join(',')).sort().join('|');
    return key(a) !== key(b);
  } catch {
    return false;
  }
}

/**
 * Lado (izquierda / derecha) hacia el que quedan las bocas que no son la de
 * entrada, mirando en la dirección de avance con la orientación transversal
 * hacia arriba. Se usa para rotular el selector de mano.
 */
export function sideOfHand(base: Omit<PlaceInput, 'mano'>, mano: Mano): 'izquierda' | 'derecha' | null {
  try {
    const { ports } = placeDefinition({ ...base, mano });
    const others = ports.filter((p) => p.name !== base.entryPortName);
    if (!others.length) return null;
    const c = [0, 1, 2].map((i) => others.reduce((s, p) => s + p.pos[i], 0) / others.length);
    const fwd = unit(base.entryDir);
    const up = unit(base.sectionUp ?? defaultSectionUp(fwd));
    const left = cross(up, fwd);
    const s = dot([c[0] - base.startPos[0], c[1] - base.startPos[1], c[2] - base.startPos[2]], left);
    if (Math.abs(s) < 1e-3) return null;
    return s > 0 ? 'izquierda' : 'derecha';
  } catch {
    return null;
  }
}
