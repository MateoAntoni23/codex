/**
 * Opciones del selector de pieza en tres pasos (A2, interfaz 2026-11-14):
 * TIPO → ANCHO → VARIANTE, y dentro de la variante ESPESOR y ACABADO.
 *
 * Las piezas que sólo difieren en espesor o acabado son UNA variante: la clave de
 * variante deja afuera el espesor de chapa y el acabado (prefijo del código, ala,
 * ángulo, radio y tipo de bandeja). Lo que se computa sigue siendo el código
 * exacto elegido (`productoDe`).
 *
 * Por defecto: el espesor y el acabado de la pieza desde la que se continúa.
 *
 * Tipos que no aparecen: si un tipo de pieza existe en el tipo de bandeja que se
 * está trazando pero no se ofrece desde esta boca, se dice por qué
 * (`tiposAusentes`). Nunca una lista vacía sin explicación.
 *
 * No cambia qué es compatible: recibe los candidatos ya decididos por las reglas
 * de unión (`compatiblesDirectos`, excepciones con motivo); sólo los ordena.
 */
import type { Product } from '../../tray/model';
import { acabadoDe, grupoDe } from '../mezclaAcabados';
import { eligeAnguloAlColocar } from '../placement/routingPlacementState';

export interface Candidato {
  readonly product: Product;
  /** Excepción con motivo (compatibilidad no documentada): se puede elegir, con motivo. */
  readonly excepcion?: boolean;
  /** Insertable, pero sin modelo paramétrico (se dibuja esquemática). */
  readonly sinModelo?: boolean;
}

export interface Variante {
  readonly clave: string;
  readonly texto: string;
  readonly candidatos: readonly Candidato[];
}
export interface Ancho { readonly ancho: number | null; readonly variantes: readonly Variante[] }
export interface Tipo {
  readonly clave: string;
  readonly texto: string;
  readonly anchos: readonly Ancho[];
  /** El tipo no existe en la familia de origen: sólo se ofrece en otro acabado (mezcla). */
  readonly soloOtroAcabado: boolean;
}

/** Tipos de pieza que se trazan (los demás —tapas, soportes, herrajes— no se continúan). */
export const TIPOS_TRAZABLES = [
  'recta', 'curva horizontal', 'curva vertical interior', 'curva vertical exterior', 'curva vertical articulada', 'T', 'X', 'reducción',
] as const;

export const TEXTO_TIPO: Readonly<Record<string, string>> = {
  recta: 'Recto',
  'curva horizontal': 'Curva plana',
  'curva vertical interior': 'Curva vertical interior',
  'curva vertical exterior': 'Curva vertical exterior',
  'curva vertical articulada': 'Curva eslabonada',
  T: 'T',
  X: 'X (cruz)',
  'reducción': 'Reducción',
};

const reg = (p: Product) => p as Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : null);
const prefijo = (p: Product) => String(p.sku ?? p.producto_id).split('-')[0];
export const espesorDe = (p: Product) => num(reg(p).espesor_chapa_mm);
export const acabadoCodigo = (p: Product) => acabadoDe(p)?.codigo ?? '—';
const familia = (p: Product) => String(reg(p).familia_id ?? '');

function claveVariante(p: Product): string {
  return JSON.stringify([grupoDe(p)?.id ?? familia(p), prefijo(p), num(reg(p).ala_nominal_mm), num(reg(p).angulo_grados), num(reg(p).radio_mm)]);
}
function textoVariante(p: Product): string {
  const partes = [prefijo(p)];
  const ala = num(reg(p).ala_nominal_mm);
  const ang = num(reg(p).angulo_grados);
  const rad = num(reg(p).radio_mm);
  if (ala !== null) partes.push(`ala ${ala}`);
  if (ang !== null) partes.push(`${ang}°`);
  // Curva ajustable (CAS): el ángulo no es del producto; se elige al colocar.
  else if (eligeAnguloAlColocar(p)) partes.push('ángulo ajustable');
  if (rad !== null) partes.push(`R ${rad}`);
  return partes.join(' · ');
}

/** Agrupa los candidatos: tipo → ancho → variante. `origen`: la pieza desde la que se continúa. */
export function agruparCandidatos(candidatos: readonly Candidato[], origen: Product | null | undefined): Tipo[] {
  const famOrigen = origen ? familia(origen) : '';
  const porTipo = new Map<string, Candidato[]>();
  for (const c of candidatos) {
    const t = c.product.tipo_pieza || 'sin tipo';
    (porTipo.get(t) ?? porTipo.set(t, []).get(t)!).push(c);
  }
  const orden = (t: string) => {
    const i = (TIPOS_TRAZABLES as readonly string[]).indexOf(t);
    return i < 0 ? 99 : i;
  };
  return [...porTipo.entries()]
    .sort(([a], [b]) => orden(a) - orden(b) || a.localeCompare(b))
    .map(([t, cs]) => {
      const porAncho = new Map<number | null, Candidato[]>();
      for (const c of cs) {
        const a = c.product.ancho_nominal_mm;
        (porAncho.get(a) ?? porAncho.set(a, []).get(a)!).push(c);
      }
      const anchos: Ancho[] = [...porAncho.entries()]
        .sort(([a], [b]) => (a ?? 1e9) - (b ?? 1e9))
        .map(([ancho, cs2]) => {
          const porVar = new Map<string, Candidato[]>();
          for (const c of cs2) {
            const k = claveVariante(c.product);
            (porVar.get(k) ?? porVar.set(k, []).get(k)!).push(c);
          }
          const variantes = [...porVar.entries()]
            .map(([clave, cs3]) => ({ clave, texto: textoVariante(cs3[0].product) + (cs3.every((c) => c.excepcion) ? ' — excepción con motivo' : ''), candidatos: cs3 }))
            .sort((a, b) => a.texto.localeCompare(b.texto, 'es', { numeric: true }));
          return { ancho, variantes };
        });
      return {
        clave: t,
        texto: TEXTO_TIPO[t] ?? t,
        anchos,
        soloOtroAcabado: !!famOrigen && !cs.some((c) => familia(c.product) === famOrigen),
      };
    });
}

/** Espesores de una variante y acabados disponibles para un espesor. */
export function espesoresDe(v: Variante): Array<number | null> {
  return [...new Set(v.candidatos.map((c) => espesorDe(c.product)))].sort((a, b) => (a ?? 0) - (b ?? 0));
}
export function acabadosDe(v: Variante, espesor: number | null): string[] {
  return [...new Set(v.candidatos.filter((c) => espesorDe(c.product) === espesor).map((c) => acabadoCodigo(c.product)))].sort();
}
/** El código exacto que se computa para (variante, espesor, acabado), o null. */
export function productoDe(v: Variante, espesor: number | null, acabado: string): Candidato | null {
  return v.candidatos.find((c) => espesorDe(c.product) === espesor && acabadoCodigo(c.product) === acabado) ?? null;
}

/** Por defecto, el espesor y el acabado de la pieza de origen si la variante los tiene. */
export function porDefecto(v: Variante, origen: Product | null | undefined): { espesor: number | null; acabado: string } {
  const es = espesoresDe(v);
  const eo = origen ? espesorDe(origen) : null;
  const espesor = origen && es.includes(eo) ? eo : es[0];
  const as = acabadosDe(v, espesor);
  const ao = origen ? acabadoCodigo(origen) : '';
  return { espesor, acabado: as.includes(ao) ? ao : as[0] };
}

/**
 * Tipos trazables que existen en el tipo de bandeja de origen (en cualquier
 * acabado) pero no se ofrecen desde esta boca, con el motivo. `pendientes`: los
 * compatibles que todavía no se pueden insertar (sin modelo).
 */
export function tiposAusentes(
  ofrecidos: readonly Tipo[],
  origen: Product | null | undefined,
  catalogo: readonly Product[],
  pendientes: readonly Product[],
): Array<{ tipo: string; texto: string; motivo: string }> {
  if (!origen) return [];
  const grupo = grupoDe(origen);
  const familias = new Set(grupo ? grupo.familias : [familia(origen)]);
  const linea = grupo?.nombre ?? String(reg(origen).familia_id ?? 'esta línea');
  const ya = new Set(ofrecidos.map((t) => t.clave));
  const ancho = origen.ancho_nominal_mm;
  const out: Array<{ tipo: string; texto: string; motivo: string }> = [];
  for (const t of TIPOS_TRAZABLES) {
    if (ya.has(t)) continue;
    const enLinea = catalogo.filter((p) => p.tipo_pieza === t && familias.has(familia(p)));
    const texto = TEXTO_TIPO[t] ?? t;
    if (!enLinea.length) { out.push({ tipo: t, texto, motivo: `no existe en ${linea}, en ningún acabado` }); continue; }
    const pend = pendientes.filter((p) => p.tipo_pieza === t);
    if (pend.length) { out.push({ tipo: t, texto, motivo: `existe (${pend.map((p) => p.sku).slice(0, 3).join(', ')}) pero todavía no tiene modelo para colocarla` }); continue; }
    const delAncho = enLinea.filter((p) => p.ancho_nominal_mm === ancho);
    out.push({
      tipo: t, texto,
      motivo: delAncho.length
        ? `existe de ${ancho} mm, pero ninguna es compatible con esta boca en ningún acabado (las reglas de unión no la admiten acá)`
        : `no hay de ${ancho ?? '—'} mm en ${linea}, en ningún acabado`,
    });
  }
  return out;
}
