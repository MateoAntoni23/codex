/**
 * measuredLadder — utilidades para alinear un polígono medido STEP con los
 * puertos almacenados de una `Piece` y producir geometría del mundo (mm, Z-up).
 *
 * El polígono viene de `escaleraOutlines.ts`:
 *   - Plano local XZ (Y = altura de extrusión ala).
 *   - CCW visto desde +Y local.
 *   - Dos de las aristas están marcadas como boca (`boundary_edges`),
 *     correspondientes a los puertos del piece (P1 y P2 en orden de aparición).
 *
 * La función `alignOutlineToPorts` devuelve el frame local→mundo que coloca
 * P1 del polígono sobre `piece.puertos.P1` con outward normal igual a
 * `piece.puertos.P1.direccion`. Verifica P2 (si existe) y reporta el error
 * para decidir si la malla es segura o hay que caer al render conceptual.
 *
 * NO mueve puertos. NO altera dimensiones. Si P2 no encaja con tolerancia,
 * el llamante debe decidir el fallback (p.ej. seguir con `LadderCurve`
 * basado en arco o mostrar la representación conceptual).
 */
import type { EscaleraOutline, MeasuredEdge, Vec2 } from '../parametric/geometry/escaleraOutlines';

export type Vec3 = readonly [number, number, number];

export interface MeasuredPlacement {
  /** Punto mundial (mm) del origen local (0,0,0). */
  readonly originMm: Vec3;
  /** Vectores ortonormales (unitarios) que mapean (x_local,z_local) a mundo mm. */
  readonly basisX: Vec3; // dirección en mundo correspondiente a +x_local
  readonly basisZ: Vec3; // dirección en mundo correspondiente a +z_local
  /** Reflejo aplicado respecto al eje definido por P1. true => la curva es espejada. */
  readonly mirrored: boolean;
  /** Error de posición del midpoint P2 (mm) vs puerto almacenado, o null si no hay P2. */
  readonly p2PosErrorMm: number | null;
  /** Error angular de la outward normal P2 vs piece.puertos.P2.direccion (grados). */
  readonly p2DirErrorDeg: number | null;
}

export interface PortLike {
  readonly posicion_mm: Vec3;
  readonly direccion: Vec3;
}

const EPS = 1e-6;

function normalize2(v: Vec2): Vec2 {
  const L = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / L, v[1] / L];
}

function dropToXY(v: Vec3): Vec2 {
  // Dirección en mundo se proyecta al plano horizontal (XY, Z-up mm).
  return normalize2([v[0], v[1]]);
}

/**
 * Aplica una rotación 2D (θ) + traslación (Tx, Ty) a un punto local (x,z).
 * Devuelve el punto en mundo (X, Y) horizontal.
 */
function apply2D(x: number, z: number, cosT: number, sinT: number, tx: number, ty: number): [number, number] {
  return [tx + cosT * x - sinT * z, ty + sinT * x + cosT * z];
}

/**
 * Encuentra θ y traslación tales que:
 *   apply2D(P1_mid.x, P1_mid.z, θ) == piecePorts.P1.posicion_mm (XY)
 *   rotate_by_θ(P1_outward_normal_local) == piecePorts.P1.direccion (XY, normalizada)
 *
 * Si hay reflexión necesaria (chirality mirrored), devolvemos una variante
 * con el polígono reflejado respecto al eje de P1.
 */
function solveTransform(
  p1Mid: Vec2,
  p1Normal: Vec2,
  worldPos: Vec2,
  worldDir: Vec2,
  mirror: boolean,
): { cosT: number; sinT: number; tx: number; ty: number; mirror: boolean } {
  // Si mirror, reflejamos (x_local, z_local) respecto al eje del normal P1 local.
  // Reflexión en 2D a lo largo de la dirección normal: proyectar sobre el eje tangente
  // (perpendicular al normal) y conservar; el componente normal se invierte.
  // Pero más simple: cambiar signo de la componente perpendicular al normal del punto local.
  let localX = p1Mid[0];
  let localZ = p1Mid[1];
  let localNx = p1Normal[0];
  let localNz = p1Normal[1];

  if (mirror) {
    // Reflexión a lo largo del eje normal (invierte la componente tangencial).
    // Para un vector v, su componente normal es (v·n)n y la tangencial es v - (v·n)n.
    // Reflejado: (v·n)n - tangencial = 2(v·n)n - v.
    const dotM = localX * localNx + localZ * localNz;
    localX = 2 * dotM * localNx - localX;
    localZ = 2 * dotM * localNz - localZ;
    // El normal queda igual (está sobre el eje de reflexión).
  }

  // Ángulo que lleva el normal local al normal mundial.
  // normal local = (localNx, localNz), normal mundial = (worldDir.x, worldDir.y).
  // Buscamos θ tal que R(θ)·normalLocal = worldDir.
  const cosT = worldDir[0] * localNx + worldDir[1] * localNz;
  const sinT = worldDir[1] * localNx - worldDir[0] * localNz;

  // Traslación: worldPos = T + R(θ)·p1Mid_local
  const rotatedX = cosT * localX - sinT * localZ;
  const rotatedY = sinT * localX + cosT * localZ;
  const tx = worldPos[0] - rotatedX;
  const ty = worldPos[1] - rotatedY;

  return { cosT, sinT, tx, ty, mirror };
}

function angleDeg(a: Vec2, b: Vec2): number {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]));
  return (Math.acos(dot) * 180) / Math.PI;
}

function diffPos2(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * Alinea un polígono medido con los puertos almacenados en `piece`.
 *
 * Reglas:
 *   - `outline.boundary_edges[0]` es P1, `[1]` es P2 (si existe), etc.
 *   - `piecePorts.P1` fija la posición y orientación.
 *   - Si existe `piecePorts.P2`, se prueban las dos quiralidades y se escoge
 *     la de menor error combinado.
 *   - El plano de la placa se sitúa con Y_local=0 en Z_world = P1.z − ala/2
 *     (ala centrada en el punto de puerto, que vive a altura media).
 */
export function alignOutlineToPorts(
  outline: EscaleraOutline,
  piecePorts: { P1: PortLike; P2?: PortLike | undefined },
  options?: { posTolMm?: number; dirTolDeg?: number },
): MeasuredPlacement | null {
  const posTol = options?.posTolMm ?? 2.0;
  const dirTol = options?.dirTolDeg ?? 1.5;

  if (!outline.boundary_edges.length) return null;
  const outlineP1Edge = outline.boundary_edges[0];
  const outlineP2Edge = outline.boundary_edges[1];

  const p1Mid = outlineP1Edge.midpoint;
  const p1Normal = outlineP1Edge.outward_normal;

  const worldP1xy: Vec2 = [piecePorts.P1.posicion_mm[0], piecePorts.P1.posicion_mm[1]];
  const worldP1dir = dropToXY(piecePorts.P1.direccion);

  if (Math.hypot(worldP1dir[0], worldP1dir[1]) < EPS) return null;

  const alaHeight = outline.bbox_local.y_height_mm;
  const planeZ = piecePorts.P1.posicion_mm[2] - alaHeight / 2;

  const candidates: MeasuredPlacement[] = [];
  for (const mirror of [false, true]) {
    const t = solveTransform(p1Mid, p1Normal, worldP1xy, worldP1dir, mirror);
    let p2PosErr: number | null = null;
    let p2DirErr: number | null = null;
    if (outlineP2Edge && piecePorts.P2) {
      let p2Mid: Vec2 = outlineP2Edge.midpoint;
      let p2Normal: Vec2 = outlineP2Edge.outward_normal;
      if (mirror) {
        const dotM = p2Mid[0] * p1Normal[0] + p2Mid[1] * p1Normal[1];
        p2Mid = [2 * dotM * p1Normal[0] - p2Mid[0], 2 * dotM * p1Normal[1] - p2Mid[1]];
        const dotN = p2Normal[0] * p1Normal[0] + p2Normal[1] * p1Normal[1];
        p2Normal = [2 * dotN * p1Normal[0] - p2Normal[0], 2 * dotN * p1Normal[1] - p2Normal[1]];
      }
      const [p2x, p2y] = apply2D(p2Mid[0], p2Mid[1], t.cosT, t.sinT, t.tx, t.ty);
      const [nx2, ny2] = apply2D(p2Normal[0], p2Normal[1], t.cosT, t.sinT, 0, 0);
      p2PosErr = diffPos2([p2x, p2y], [piecePorts.P2.posicion_mm[0], piecePorts.P2.posicion_mm[1]]);
      p2DirErr = angleDeg([nx2, ny2], dropToXY(piecePorts.P2.direccion));
    }
    const basisX: Vec3 = [t.cosT, t.sinT, 0];
    const basisZ: Vec3 = [-t.sinT, t.cosT, 0];
    // Si mirror, los puntos se reflejan ANTES de rotar, pero el basis local sigue mismo.
    // Aplicamos la reflexión encapsulando los vértices via convertOutlinePoint (ver abajo).
    const originMm: Vec3 = [t.tx, t.ty, planeZ];
    candidates.push({ originMm, basisX, basisZ, mirrored: mirror, p2PosErrorMm: p2PosErr, p2DirErrorDeg: p2DirErr });
  }

  // Si tenemos P2, elegir la quiralidad con menor error combinado.
  if (outlineP2Edge && piecePorts.P2) {
    candidates.sort((a, b) => {
      const ea = (a.p2PosErrorMm ?? 1e9) + (a.p2DirErrorDeg ?? 1e9);
      const eb = (b.p2PosErrorMm ?? 1e9) + (b.p2DirErrorDeg ?? 1e9);
      return ea - eb;
    });
    const best = candidates[0];
    if ((best.p2PosErrorMm ?? 0) > posTol || (best.p2DirErrorDeg ?? 0) > dirTol) {
      return null;
    }
    return best;
  }
  // Sin P2: devolver la variante sin reflejar.
  return candidates[0];
}

/**
 * Convierte un punto del polígono local (x,z) + altura y en un punto mundo mm.
 * Si `placement.mirrored` es true, aplica la reflexión respecto al normal P1
 * antes de rotar.
 */
export function outlinePointToWorld(
  outline: EscaleraOutline,
  placement: MeasuredPlacement,
  xLocal: number,
  zLocal: number,
  yLocal = 0,
): Vec3 {
  let x = xLocal;
  let z = zLocal;
  if (placement.mirrored) {
    const n = outline.boundary_edges[0].outward_normal;
    const dotM = x * n[0] + z * n[1];
    x = 2 * dotM * n[0] - x;
    z = 2 * dotM * n[1] - z;
  }
  return [
    placement.originMm[0] + placement.basisX[0] * x + placement.basisZ[0] * z,
    placement.originMm[1] + placement.basisX[1] * x + placement.basisZ[1] * z,
    placement.originMm[2] + yLocal,
  ];
}

/**
 * Dado un polígono con dos aristas de boca marcadas, parte el contorno en los
 * dos tramos "de riel" (desde el final de P1 al inicio de P2 y viceversa).
 * Para contornos con más de dos puertos (TS, XS), partiremos en cada apertura.
 *
 * Devuelve lista de cadenas (cada una es una polilínea local XZ) que forman
 * las paredes de la escalera.
 */
export function segmentRailsFromOutline(outline: EscaleraOutline): Vec2[][] {
  const n = outline.polygon.length;
  if (n === 0) return [];
  const portEdgeIndices = new Set(outline.boundary_edges.map((e) => e.i));
  const chains: Vec2[][] = [];
  let current: Vec2[] | null = null;
  for (let i = 0; i < n; i++) {
    const edgeIsPort = portEdgeIndices.has(i);
    const a: Vec2 = outline.polygon[i];
    const b: Vec2 = outline.polygon[(i + 1) % n];
    if (edgeIsPort) {
      if (current && current.length) {
        current.push(a);
        chains.push(current);
      }
      current = null;
    } else {
      if (!current) {
        current = [a];
      } else {
        current.push(a);
      }
      // No cerramos aún; el extremo b se agregará cuando empecemos la siguiente arista o puerto.
      // Caso especial: si la próxima arista es puerto, cerraremos arriba con 'a' siguiente;
      // aquí dejamos 'b' para que se añada en la próxima iteración (como 'a').
      // Para ser explícitos: si i === n-1 (última arista) y no es puerto, cerrar con b.
      if (i === n - 1) {
        current.push(b);
        chains.push(current);
        current = null;
      }
    }
  }
  // Puede quedar una cadena abierta si empezamos a mitad: unir con la primera chain si corresponde.
  if (current && current.length) {
    chains.push(current);
    current = null;
  }
  return chains;
}

/** Longitud acumulada de una polilínea 2D (mm). */
export function polylineLengthMm(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  }
  return total;
}

/** Devuelve el punto sobre la polilínea a distancia `s` desde el primer vértice (mm). */
export function pointAtArclength(points: readonly Vec2[], s: number): Vec2 | null {
  let remaining = s;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dy = points[i + 1][1] - points[i][1];
    const L = Math.hypot(dx, dy);
    if (L < EPS) continue;
    if (remaining <= L) {
      const t = remaining / L;
      return [points[i][0] + dx * t, points[i][1] + dy * t];
    }
    remaining -= L;
  }
  return null;
}

/** Exporta tipos reutilizables. */
export type { MeasuredEdge };
