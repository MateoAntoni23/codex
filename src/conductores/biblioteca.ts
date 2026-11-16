/**
 * Biblioteca de conductores (encargo del 2026-11-15, parte A).
 *
 * Dos orígenes, y el origen decide qué se puede tocar:
 *   - «catálogo del motor»: los cables de los datasets vendorizados (`catalogoCables.ts`).
 *     Solo lectura.
 *   - «declarado por el operador»: los que carga él. Se editan y se borran.
 *
 * Un cable declarado guarda lo que el operador escribió, nada más. Diámetro exterior y
 * masa por km pueden quedar vacíos: entonces la ficha dice qué no se va a poder calcular
 * con él. Nunca se inventan ni se estiman desde la sección.
 *
 * La biblioteca es del operador, como la de modelos: su autoridad es localStorage
 * (`CLAVE_CONDUCTORES`). El proyecto lleva aparte los declarados que usa (bloque del
 * archivo, `bloqueArchivo.ts`).
 */
import { lineaCorta, textoTipo, type CableCatalogo } from '../workspace/cables/catalogoCables';

export type TipoDeclarado = 'unipolar' | 'multipolar';
export type MaterialDeclarado = 'cobre' | 'aluminio';

export interface CableDeclarado {
  /** `OP-…`: nunca coincide con un id del motor (`PRY-…`). */
  readonly cable_id: string;
  readonly designacion: string;
  readonly tipo: TipoDeclarado;
  readonly material: MaterialDeclarado;
  readonly n_conductores: number;
  /** Sección de cada conductor (formación «a»: todos iguales). */
  readonly seccion_mm2: number;
  /** null: el operador no lo declaró. */
  readonly diametro_exterior_mm: number | null;
  /** null: el operador no la declaró. */
  readonly masa_kg_km: number | null;
  readonly procedencia: {
    /** ISO de cuándo se declaró. */
    readonly declaradoEl: string;
    /** Si nació duplicando un cable del catálogo: de cuál. */
    readonly duplicadoDe?: { readonly cable_id: string; readonly texto: string };
  };
}

export const PREFIJO_DECLARADO = 'OP-';
export const LINEA_DECLARADO = 'Declarado por el operador';
export const ORIGEN_TEXTO = { catalogo: 'catálogo del motor', operador: 'declarado por el operador' } as const;
export type Origen = keyof typeof ORIGEN_TEXTO;

export const esIdDeclarado = (id: string) => id.startsWith(PREFIJO_DECLARADO);

const coma = (n: number) => String(n).replace('.', ',');

/** Formación como la escribe el fabricante («6», «1,5»): la que entiende la regla de casamiento. */
export const formacionDeclarada = (c: Pick<CableDeclarado, 'seccion_mm2'>) => coma(c.seccion_mm2);

/**
 * Lo que no se va a poder calcular con este cable, por los datos que faltan. Vacío si
 * tiene diámetro y masa.
 */
export function noCalculable(c: Pick<CableDeclarado, 'diametro_exterior_mm' | 'masa_kg_km'>): string[] {
  const r: string[] = [];
  if (c.diametro_exterior_mm === null) r.push('sin diámetro exterior no hay ocupación de bandeja');
  if (c.masa_kg_km === null) r.push('sin masa por km no hay carga por pieza ni vanos');
  return r;
}

// ─── Carga y validación ──────────────────────────────────────────────────────

/** Lo que escribe el operador en la ficha (texto crudo de los campos). */
export interface BorradorDeclarado {
  designacion: string;
  tipo: TipoDeclarado;
  material: MaterialDeclarado;
  n_conductores: string;
  seccion_mm2: string;
  diametro_exterior_mm: string;
  masa_kg_km: string;
}

const numero = (s: string): number | null => {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
};

export type ResultadoBorrador =
  | { ok: true; datos: Omit<CableDeclarado, 'cable_id' | 'procedencia'> }
  | { ok: false; errores: string[] };

/** Valida la ficha. Vacíos permitidos solo en diámetro y masa. */
export function validarBorrador(b: BorradorDeclarado): ResultadoBorrador {
  const errores: string[] = [];
  const designacion = b.designacion.trim();
  if (!designacion) errores.push('falta la designación');
  if (b.tipo !== 'unipolar' && b.tipo !== 'multipolar') errores.push('tipo inválido');
  if (b.material !== 'cobre' && b.material !== 'aluminio') errores.push('material inválido');
  const n = numero(b.n_conductores);
  if (n === null) errores.push('falta la cantidad de conductores');
  else if (!Number.isInteger(n) || n < 1) errores.push('la cantidad de conductores tiene que ser un entero mayor que 0');
  else if (b.tipo === 'unipolar' && n !== 1) errores.push('un unipolar tiene 1 conductor');
  else if (b.tipo === 'multipolar' && n < 2) errores.push('un multipolar tiene 2 conductores o más');
  const s = numero(b.seccion_mm2);
  if (s === null) errores.push('falta la sección');
  else if (!(s > 0)) errores.push('la sección tiene que ser un número mayor que 0');
  const d = numero(b.diametro_exterior_mm);
  if (d !== null && !(d > 0)) errores.push('el diámetro exterior tiene que ser un número mayor que 0, o quedar vacío');
  const m = numero(b.masa_kg_km);
  if (m !== null && !(m > 0)) errores.push('la masa por km tiene que ser un número mayor que 0, o quedar vacía');
  if (errores.length) return { ok: false, errores };
  return {
    ok: true,
    datos: {
      designacion, tipo: b.tipo, material: b.material, n_conductores: n!, seccion_mm2: s!,
      diametro_exterior_mm: d, masa_kg_km: m,
    },
  };
}

export function borradorDe(c: CableDeclarado): BorradorDeclarado {
  const t = (v: number | null) => (v === null ? '' : coma(v));
  return {
    designacion: c.designacion, tipo: c.tipo, material: c.material, n_conductores: String(c.n_conductores),
    seccion_mm2: coma(c.seccion_mm2), diametro_exterior_mm: t(c.diametro_exterior_mm), masa_kg_km: t(c.masa_kg_km),
  };
}

export const BORRADOR_VACIO: BorradorDeclarado = {
  designacion: '', tipo: 'multipolar', material: 'cobre', n_conductores: '', seccion_mm2: '', diametro_exterior_mm: '', masa_kg_km: '',
};

let contador = 0;
export function nuevoIdDeclarado(): string {
  const azar = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(16).slice(2, 10);
  contador += 1;
  return `${PREFIJO_DECLARADO}${Date.now().toString(36)}-${azar}${contador}`;
}

/**
 * Duplicado de un cable del catálogo como punto de partida: nace declarado por el
 * operador y dice de cuál salió. Solo se copian los datos que el catálogo publica; una
 * formación con conductor reducido («25/16») no se puede declarar (la ficha es de
 * conductores iguales) y se rechaza con el motivo.
 */
export function duplicarDeCatalogo(c: CableCatalogo, ahora = new Date()): { ok: true; cable: CableDeclarado } | { ok: false; motivo: string } {
  if (c.formacion.includes('/')) {
    return { ok: false, motivo: `${c.cable_id}: formación ${c.formacion} con conductor reducido; la ficha declarada es de conductores iguales` };
  }
  const seccion = Number(c.formacion.replace(',', '.'));
  if (!(seccion > 0)) return { ok: false, motivo: `${c.cable_id}: formación ${c.formacion} ilegible` };
  if (c.material !== 'cobre' && c.material !== 'aluminio') return { ok: false, motivo: `${c.cable_id}: material ${c.material} desconocido` };
  return {
    ok: true,
    cable: {
      cable_id: nuevoIdDeclarado(),
      designacion: `Copia de ${lineaCorta(c.linea)} ${c.n_conductores} × ${c.formacion} mm² (${c.material})`,
      tipo: c.n_conductores === 1 ? 'unipolar' : 'multipolar',
      material: c.material,
      n_conductores: c.n_conductores,
      seccion_mm2: seccion,
      diametro_exterior_mm: c.diametro_exterior_mm,
      masa_kg_km: c.masa_kg_km,
      procedencia: {
        declaradoEl: ahora.toISOString(),
        duplicadoDe: { cable_id: c.cable_id, texto: `${lineaCorta(c.linea)} · ${textoTipo(c)} · ${c.n_conductores} × ${c.formacion} mm²` },
      },
    },
  };
}

/** Validación estructural de un cable leído (localStorage o archivo). */
export function esCableDeclarado(v: unknown): v is CableDeclarado {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  const numONull = (x: unknown) => x === null || (typeof x === 'number' && x > 0);
  const p = c.procedencia as Record<string, unknown> | undefined;
  return typeof c.cable_id === 'string' && esIdDeclarado(c.cable_id)
    && typeof c.designacion === 'string' && c.designacion.trim() !== ''
    && (c.tipo === 'unipolar' || c.tipo === 'multipolar')
    && (c.material === 'cobre' || c.material === 'aluminio')
    && typeof c.n_conductores === 'number' && Number.isInteger(c.n_conductores) && c.n_conductores >= 1
    && typeof c.seccion_mm2 === 'number' && c.seccion_mm2 > 0
    && numONull(c.diametro_exterior_mm) && numONull(c.masa_kg_km)
    && !!p && typeof p === 'object' && typeof p.declaradoEl === 'string'
    && (p.duplicadoDe === undefined || (!!p.duplicadoDe && typeof (p.duplicadoDe as Record<string, unknown>).cable_id === 'string'));
}

// ─── Vista unificada (lista de la pestaña) ───────────────────────────────────

export interface CableBiblioteca {
  readonly cable_id: string;
  readonly origen: Origen;
  readonly designacion: string;
  readonly linea: string;
  readonly tipoTexto: string;
  readonly n_conductores: number;
  /** Formación del fabricante o la sección declarada («25/16», «6»). */
  readonly formacion: string;
  /** Sección principal, para filtrar. */
  readonly seccion_mm2: number;
  readonly diametro_exterior_mm: number | null;
  readonly masa_kg_km: number | null;
  readonly declarado?: CableDeclarado;
}

const TIPO_DECLARADO_TEXTO: Record<TipoDeclarado, string> = { unipolar: 'Unipolar', multipolar: 'Multipolar' };
export const textoTipoDeclarado = (c: Pick<CableDeclarado, 'tipo' | 'material'>) => `${TIPO_DECLARADO_TEXTO[c.tipo]} · ${c.material}`;

export function entradasBiblioteca(catalogo: readonly CableCatalogo[], declarados: readonly CableDeclarado[]): CableBiblioteca[] {
  return [
    ...catalogo.map((c): CableBiblioteca => ({
      cable_id: c.cable_id, origen: 'catalogo', designacion: `${lineaCorta(c.linea)} ${c.n_conductores} × ${c.formacion} mm²`,
      linea: c.linea, tipoTexto: textoTipo(c), n_conductores: c.n_conductores, formacion: c.formacion,
      seccion_mm2: Number(c.formacion.split('/')[0].replace(',', '.')),
      diametro_exterior_mm: c.diametro_exterior_mm, masa_kg_km: c.masa_kg_km,
    })),
    ...declarados.map((d): CableBiblioteca => ({
      cable_id: d.cable_id, origen: 'operador', designacion: d.designacion, linea: LINEA_DECLARADO,
      tipoTexto: textoTipoDeclarado(d), n_conductores: d.n_conductores, formacion: formacionDeclarada(d),
      seccion_mm2: d.seccion_mm2, diametro_exterior_mm: d.diametro_exterior_mm, masa_kg_km: d.masa_kg_km, declarado: d,
    })),
  ];
}

/** Lo que mira la regla de casamiento, para un declarado. */
export const casableDe = (d: CableDeclarado) => ({ cable_id: d.cable_id, n_conductores: d.n_conductores, formacion: formacionDeclarada(d) });
