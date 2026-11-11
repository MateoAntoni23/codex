/**
 * calibracionPatron — calibración de bocas POR PATRÓN (B-2.5).
 *
 * Antes la calibración se guardaba por SKU (`ProductPortMapping` con un
 * `modelFrame` y, por boca, centro/normal/orientación ABSOLUTOS en el marco del
 * modelo) y una variante la heredaba buscando otro SKU del mismo maestro, con
 * desempate alfabético. Un centro absoluto medido en 300 no vale en 450.
 *
 * Ahora:
 *   - La calibración es del PATRÓN (maestro) y vale igual para todas sus
 *     variantes. NO se escala con el ancho: sólo hay modelos medidos en 300 y
 *     no hay evidencia para hacerlo.
 *   - Cada boca guarda una CORRECCIÓN respecto de la boca nominal del patrón,
 *     en los ejes de la propia boca nominal:
 *       axial    = normal saliente n
 *       vertical = orientación transversal v (ortogonalizada contra n)
 *       lateral  = v × n
 *     desplazamiento en mm sobre esos ejes y giro en grados como rotación
 *     compuesta alrededor de los ejes nominales: R = R_lateral · R_vertical ·
 *     R_axial (se aplica primero el giro axial, que sólo cambia la orientación
 *     transversal; después el vertical y el lateral, que inclinan la normal).
 *   - En una variante distinta de la medida (los `baseParams` del maestro) la
 *     calibración del patrón se aplica con la marca "calibración heredada, sin
 *     verificar en este ancho".
 *   - Una variante que necesita otra corrección se declara como EXCEPCIÓN
 *     explícita (por producto_id), con motivo. Nada de herencia por búsqueda.
 *   - Sin `modelFrame`: con el marco completo de la fase A, rotar malla y bocas
 *     juntas no cambia la pieza colocada. Lo que importa es la boca respecto del
 *     cuerpo, que es lo que guarda la corrección.
 */
import * as THREE from 'three';

export type V3 = readonly [number, number, number];

export interface CorreccionBoca {
  /** Desplazamiento del centro respecto de la boca nominal, en sus ejes (mm). */
  readonly desplazamiento_mm: { readonly lateral: number; readonly vertical: number; readonly axial: number };
  /** Giro respecto de la boca nominal, alrededor de sus ejes (grados). */
  readonly giro_deg: { readonly lateral: number; readonly vertical: number; readonly axial: number };
}

export interface CalibracionPatron {
  readonly patron: string;
  /** Corrección por boca (nombre de boca de la receta). Bocas ausentes: sin corrección. */
  readonly bocas: Readonly<Record<string, CorreccionBoca>>;
  readonly motivo?: string;
  readonly fecha?: string;
}

export interface ExcepcionVariante {
  readonly productoId: string;
  readonly patron: string;
  readonly bocas: Readonly<Record<string, CorreccionBoca>>;
  /** Obligatorio: por qué esta variante no usa la calibración del patrón. */
  readonly motivo: string;
  readonly fecha?: string;
}

export const BIBLIOTECA_CALIBRACION_VERSION = 'codex:calibracion/2' as const;

export interface BibliotecaCalibracion {
  readonly version: typeof BIBLIOTECA_CALIBRACION_VERSION;
  readonly patrones: Readonly<Record<string, CalibracionPatron>>;
  readonly excepciones: Readonly<Record<string, ExcepcionVariante>>;
}

export const bibliotecaVacia = (): BibliotecaCalibracion => ({
  version: BIBLIOTECA_CALIBRACION_VERSION,
  patrones: {},
  excepciones: {},
});

export const CORRECCION_NULA: CorreccionBoca = {
  desplazamiento_mm: { lateral: 0, vertical: 0, axial: 0 },
  giro_deg: { lateral: 0, vertical: 0, axial: 0 },
};

export function esCorreccionNula(c: CorreccionBoca | null | undefined, tol = 0): boolean {
  if (!c) return true;
  const d = c.desplazamiento_mm;
  const g = c.giro_deg;
  return [d.lateral, d.vertical, d.axial, g.lateral, g.vertical, g.axial].every((x) => Math.abs(x) <= tol);
}

/** Marco de una boca: ejes lateral, vertical, axial (ortonormales). */
export interface MarcoBoca {
  readonly centro: V3;
  readonly lateral: V3;
  readonly vertical: V3;
  readonly axial: V3;
}

const vec = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);
const arr = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];

/** Marco ortonormal desde la normal saliente y la orientación transversal. */
export function marcoDeBoca(centro: V3, normal: V3, vDir: V3): MarcoBoca {
  const n = vec(normal).normalize();
  const v = vec(vDir).sub(n.clone().multiplyScalar(vec(vDir).dot(n)));
  if (v.length() < 1e-9) throw new Error('marcoDeBoca: la orientación transversal es paralela a la normal');
  v.normalize();
  const l = new THREE.Vector3().crossVectors(v, n);
  return { centro, lateral: arr(l), vertical: arr(v), axial: arr(n) };
}

/** Base [lateral vertical axial] como matriz 4×4 (columnas). */
function base(m: MarcoBoca): THREE.Matrix4 {
  return new THREE.Matrix4().makeBasis(vec(m.lateral), vec(m.vertical), vec(m.axial));
}

const DEG = Math.PI / 180;

/** Aplica la corrección a un marco nominal y devuelve el marco calibrado. */
export function aplicarCorreccion(nominal: MarcoBoca, c: CorreccionBoca): MarcoBoca {
  const B = base(nominal);
  // Rotación en coordenadas de la boca (x = lateral, y = vertical, z = axial):
  // M = Rx(lateral) · Ry(vertical) · Rz(axial) — orden 'XYZ' de THREE.
  const M = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(c.giro_deg.lateral * DEG, c.giro_deg.vertical * DEG, c.giro_deg.axial * DEG, 'XYZ'),
  );
  // Rotación en el marco del modelo: R = B · M · Bᵀ.
  const Bt = B.clone().transpose();
  const R = B.clone().multiply(M).multiply(Bt);
  const l = vec(nominal.lateral).applyMatrix4(R);
  const v = vec(nominal.vertical).applyMatrix4(R);
  const n = vec(nominal.axial).applyMatrix4(R);
  const d = c.desplazamiento_mm;
  const centro = vec(nominal.centro)
    .add(vec(nominal.lateral).multiplyScalar(d.lateral))
    .add(vec(nominal.vertical).multiplyScalar(d.vertical))
    .add(vec(nominal.axial).multiplyScalar(d.axial));
  return { centro: arr(centro), lateral: arr(l), vertical: arr(v), axial: arr(n) };
}

/** Corrección que lleva el marco nominal al calibrado (inversa de aplicarCorreccion). */
export function correccionEntre(nominal: MarcoBoca, calibrado: MarcoBoca): CorreccionBoca {
  const B = base(nominal);
  const C = base(calibrado);
  // R · B = C  ⇒  R = C · Bᵀ ;  M = Bᵀ · R · B = Bᵀ · C
  const M = B.clone().transpose().multiply(C);
  const e = new THREE.Euler().setFromRotationMatrix(M, 'XYZ');
  const dd = vec(calibrado.centro).sub(vec(nominal.centro));
  return {
    desplazamiento_mm: {
      lateral: dd.dot(vec(nominal.lateral)),
      vertical: dd.dot(vec(nominal.vertical)),
      axial: dd.dot(vec(nominal.axial)),
    },
    giro_deg: { lateral: e.x / DEG, vertical: e.y / DEG, axial: e.z / DEG },
  };
}

/** Diferencia máxima entre dos correcciones (mm o grados, lo que sea mayor). */
export function diferenciaCorrecciones(a: CorreccionBoca, b: CorreccionBoca): { mm: number; deg: number } {
  const ka = ['lateral', 'vertical', 'axial'] as const;
  return {
    mm: Math.max(...ka.map((k) => Math.abs(a.desplazamiento_mm[k] - b.desplazamiento_mm[k]))),
    deg: Math.max(...ka.map((k) => Math.abs(a.giro_deg[k] - b.giro_deg[k]))),
  };
}

// ─── Estado (lo alimenta el catalogConfigStore) ──────────────────────────────

let _biblioteca: BibliotecaCalibracion = bibliotecaVacia();
let _version = 0;

export function setBibliotecaCalibracion(b: BibliotecaCalibracion): void {
  _biblioteca = b;
  _version++;
}
export function getBibliotecaCalibracion(): BibliotecaCalibracion {
  return _biblioteca;
}
export function clearBibliotecaCalibracion(): void {
  setBibliotecaCalibracion(bibliotecaVacia());
}
export function bibliotecaVersion(): number {
  return _version;
}

/** Origen de la calibración que aplica a un producto. */
export type CalibracionAplicable =
  | { readonly origen: 'ninguna' }
  | { readonly origen: 'patron'; readonly patron: string; readonly bocas: Readonly<Record<string, CorreccionBoca>>; readonly heredada: boolean }
  | { readonly origen: 'excepcion'; readonly patron: string; readonly bocas: Readonly<Record<string, CorreccionBoca>>; readonly motivo: string };

export const MARCA_HEREDADA = 'calibración heredada, sin verificar en este ancho';

/**
 * Calibración aplicable a un producto de un patrón: su excepción explícita, o
 * la del patrón (heredada si el producto no es la variante medida), o ninguna.
 */
export function calibracionPara(
  productoId: string,
  patron: string,
  esVarianteMedida: boolean,
  b: BibliotecaCalibracion = _biblioteca,
): CalibracionAplicable {
  const exc = b.excepciones[productoId];
  if (exc && exc.patron === patron) return { origen: 'excepcion', patron, bocas: exc.bocas, motivo: exc.motivo };
  const p = b.patrones[patron];
  if (!p || Object.values(p.bocas).every((c) => esCorreccionNula(c))) return { origen: 'ninguna' };
  return { origen: 'patron', patron, bocas: p.bocas, heredada: !esVarianteMedida };
}
