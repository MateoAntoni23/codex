/**
 * Parte civil de la planta (2026-11-15): columnas, vigas, muros y losas importados
 * de STEP 3D, como CONTEXTO VISUAL del trazado.
 *
 * Reglas del encargo (docs/traspaso-parte-civil.md):
 *   - un archivo por piso y por tipo; el tipo y el nivel los DECLARA el operador
 *     (no se deduce nada de la geometría ni de los nombres internos del STEP);
 *   - el STEP se convierte una vez, al importar, a una malla liviana que se guarda;
 *   - por defecto se respetan las coordenadas del archivo; cada archivo admite un
 *     desplazamiento y un giro en planta;
 *   - NO interactúa con las bandejas (uniones, cómputo, cálculo) y NUNCA viaja al
 *     motor: vive en su propio bloque del proyecto, fuera del trazado.
 */

export type TipoCivil = 'columna' | 'viga' | 'muro' | 'losa' | 'otro';
export const TIPOS_CIVIL: readonly TipoCivil[] = ['columna', 'viga', 'muro', 'losa', 'otro'];
export const NOMBRE_TIPO_CIVIL: Record<TipoCivil, string> = {
  columna: 'Columnas',
  viga: 'Vigas',
  muro: 'Muros',
  losa: 'Losas / entrepisos',
  otro: 'Otro',
};

/** Eje del ARCHIVO que el operador declara como altura (la app trabaja con Z hacia arriba). */
export type EjeVertical = 'X' | 'Y' | 'Z';
export const EJES_VERTICALES: readonly EjeVertical[] = ['Z', 'Y', 'X'];

/** Malla que devuelve el servicio (server/civil_step.py), en mm y en los ejes del archivo. */
export interface MallaCivil {
  readonly version: 'codex:civilMalla/1';
  readonly unidades: { readonly codigo: string; readonly texto: string };
  readonly solidos: number;
  readonly vertices: number;
  readonly triangulos: number;
  readonly tolerancia_mm: number;
  readonly caja_mm: { readonly min: readonly number[]; readonly max: readonly number[] };
  /** float32 little-endian, base64. */
  readonly posiciones: string;
  /** uint32 little-endian, base64. */
  readonly indices: string;
}

export interface NivelCivil {
  readonly nombre: string;
  readonly cotaMm: number;
}

export interface ArchivoCivil {
  readonly id: string;
  /** Nombre del archivo importado (el operador lo reconoce así). */
  readonly nombre: string;
  readonly tipo: TipoCivil;
  readonly nivel: NivelCivil;
  readonly ejeVertical: EjeVertical;
  /** Desplazamiento del archivo en mm (x, y en planta; z, altura). Por defecto 0: coordenadas del archivo. */
  readonly desplazamientoMm: readonly [number, number, number];
  /** Giro en planta (alrededor de la vertical), en grados. */
  readonly giroDeg: number;
  readonly malla: MallaCivil;
  readonly importadoEn: string;
  /** Veces que se reemplazó por una versión nueva. */
  readonly version: number;
}

export const VERSION_BLOQUE_CIVIL = 'codex:parteCivil/1';

/** Bloque del archivo de proyecto (fileVersion 4). */
export interface ParteCivilBlock {
  readonly version: typeof VERSION_BLOQUE_CIVIL;
  readonly archivos: readonly ArchivoCivil[];
}

// ─── Ejes ────────────────────────────────────────────────────────────────────

/**
 * Lleva un punto de los ejes del archivo a los de la app (Z arriba), según el eje que
 * el operador declaró como altura. Rotaciones propias (sin espejar):
 *   Z: (x, y, z);  Y: (x, −z, y);  X: (y, z, x).
 */
export function aEjesApp(eje: EjeVertical, p: readonly [number, number, number]): [number, number, number] {
  const [x, y, z] = p;
  if (eje === 'Y') return [x, -z, y];
  if (eje === 'X') return [y, z, x];
  return [x, y, z];
}

/** Matriz 3×3 (fila mayor) de `aEjesApp`. */
export function matrizEjes(eje: EjeVertical): readonly number[] {
  if (eje === 'Y') return [1, 0, 0, 0, 0, -1, 0, 1, 0];
  if (eje === 'X') return [0, 1, 0, 0, 0, 1, 1, 0, 0];
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export interface Caja {
  /** x */ readonly ancho: number;
  /** y */ readonly fondo: number;
  /** z (altura) */ readonly alto: number;
  readonly min: [number, number, number];
  readonly max: [number, number, number];
}

/** Caja envolvente en los ejes de la app según el eje vertical elegido (sin desplazamiento ni giro). */
export function cajaEnApp(malla: MallaCivil, eje: EjeVertical): Caja {
  const a = aEjesApp(eje, malla.caja_mm.min as [number, number, number]);
  const b = aEjesApp(eje, malla.caja_mm.max as [number, number, number]);
  const min: [number, number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
  const max: [number, number, number] = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
  return { ancho: max[0] - min[0], fondo: max[1] - min[1], alto: max[2] - min[2], min, max };
}

/**
 * Transformación completa archivo → app (mm, Z arriba), como matriz 4×4 en orden de
 * COLUMNA (la de THREE.Matrix4.fromArray): ejes declarados, giro en planta alrededor
 * del origen y desplazamiento.
 */
export function matrizArchivo(a: Pick<ArchivoCivil, 'ejeVertical' | 'giroDeg' | 'desplazamientoMm'>): number[] {
  const e = matrizEjes(a.ejeVertical);
  const g = (a.giroDeg * Math.PI) / 180;
  const c = Math.cos(g);
  const s = Math.sin(g);
  const rz = [c, -s, 0, s, c, 0, 0, 0, 1];
  // m = rz · e (3×3, fila mayor)
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] = rz[i * 3] * e[j] + rz[i * 3 + 1] * e[3 + j] + rz[i * 3 + 2] * e[6 + j];
  const [dx, dy, dz] = a.desplazamientoMm;
  return [m[0], m[3], m[6], 0, m[1], m[4], m[7], 0, m[2], m[5], m[8], 0, dx, dy, dz, 1];
}

// ─── Malla ───────────────────────────────────────────────────────────────────

function b64aBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Por OBJETO de malla (WeakMap): se libera solo cuando la malla deja de usarse. Un Map por
// contenido retenía para siempre todas las mallas decodificadas (en la medición A5, la
// pestaña se caía al acumular varias naves grandes).
const cacheMallas = new WeakMap<MallaCivil, { posiciones: Float32Array; indices: Uint32Array }>();

/** Posiciones e índices de la malla (decodificados una vez por malla). */
export function decodificarMalla(m: MallaCivil): { posiciones: Float32Array; indices: Uint32Array } {
  const hit = cacheMallas.get(m);
  if (hit) return hit;
  const p = b64aBytes(m.posiciones);
  const i = b64aBytes(m.indices);
  const out = {
    posiciones: new Float32Array(p.buffer, p.byteOffset, p.byteLength / 4),
    indices: new Uint32Array(i.buffer, i.byteOffset, i.byteLength / 4),
  };
  cacheMallas.set(m, out);
  return out;
}

// ─── Validación del bloque (al abrir un archivo de proyecto) ────────────────

const esObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, que: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`parteCivil: ${que} debe ser un número`);
  return v;
};
const str = (v: unknown, que: string): string => {
  if (typeof v !== 'string' || !v) throw new Error(`parteCivil: ${que} debe ser un texto`);
  return v;
};

export function validarParteCivil(raw: unknown): ParteCivilBlock | null {
  if (raw === undefined || raw === null) return null;
  if (!esObj(raw)) throw new Error('parteCivil: formato inválido');
  if (raw.version !== VERSION_BLOQUE_CIVIL) throw new Error(`parteCivil: versión no soportada (${String(raw.version)})`);
  if (!Array.isArray(raw.archivos)) throw new Error('parteCivil.archivos debe ser una lista');
  const archivos = raw.archivos.map((a, i): ArchivoCivil => {
    if (!esObj(a)) throw new Error(`parteCivil.archivos[${i}] inválido`);
    const tipo = a.tipo as TipoCivil;
    if (!TIPOS_CIVIL.includes(tipo)) throw new Error(`parteCivil.archivos[${i}].tipo inválido: ${String(a.tipo)}`);
    const eje = a.ejeVertical as EjeVertical;
    if (!EJES_VERTICALES.includes(eje)) throw new Error(`parteCivil.archivos[${i}].ejeVertical inválido: ${String(a.ejeVertical)}`);
    const nivel = esObj(a.nivel) ? a.nivel : {};
    const d = Array.isArray(a.desplazamientoMm) ? a.desplazamientoMm : [];
    const m = esObj(a.malla) ? a.malla : null;
    if (!m || m.version !== 'codex:civilMalla/1' || typeof m.posiciones !== 'string' || typeof m.indices !== 'string') {
      throw new Error(`parteCivil.archivos[${i}].malla inválida`);
    }
    return {
      id: str(a.id, `archivos[${i}].id`),
      nombre: str(a.nombre, `archivos[${i}].nombre`),
      tipo,
      nivel: { nombre: str(nivel.nombre, `archivos[${i}].nivel.nombre`), cotaMm: num(nivel.cotaMm, `archivos[${i}].nivel.cotaMm`) },
      ejeVertical: eje,
      desplazamientoMm: [num(d[0], 'desplazamiento x'), num(d[1], 'desplazamiento y'), num(d[2], 'desplazamiento z')],
      giroDeg: num(a.giroDeg, `archivos[${i}].giroDeg`),
      malla: m as unknown as MallaCivil,
      importadoEn: typeof a.importadoEn === 'string' ? a.importadoEn : '',
      version: typeof a.version === 'number' ? a.version : 1,
    };
  });
  return { version: VERSION_BLOQUE_CIVIL, archivos };
}
