/**
 * Regla de las curvas ESLABONADAS (EPS perforada, CUS escalera). Es aritmética,
 * no geometría: la usan la receta (geometry/curvaEslabonada.ts), la longitud de
 * eje, el cómputo y el cambio de ángulo.
 *
 * Declarada por el operador (2026-11-13; radio corregido el 2026-11-15) y
 * respaldada por el catálogo:
 *   - cada articulación cubre 22,5°; eslabones N = techo(θ / 22,5°) + 1 (90° → 5,
 *     45° → 3). N se usa SÓLO para el cómputo de material;
 *   - RADIO: depende de cuánto abre cada articulación, no de la cantidad de
 *     eslabones ni del ancho. El gráfico del catálogo «RADIO APROX EN MM» es una
 *     curva de 90° armada con N eslabones (θ_art = 90°/(N−1)); con 22,5° por
 *     articulación corresponde la fila de 5 eslabones: EPS 260 mm, CUS línea Z
 *     294 mm (el único armado que se vende como código: los 40 CUS son de 5);
 *   - el radio del gráfico se toma al INTERIOR (inferencia fundada: la tabla no
 *     declara la referencia; las curvas planas fijas de la misma familia sí, al
 *     interior). El eje de una curva vertical queda a radio + ala/2;
 *   - longitud de eje = el polígono de N−1 cuerdas sobre el radio del eje;
 *   - ángulo por instancia, 90° por defecto, MAYOR que 22,5° (el gráfico arranca
 *     en 3 eslabones) y hasta 180°.
 * CUS línea G: el catálogo no publica radio. Las G con una Z de igual ancho, ala y
 * espesor toman el de la Z (equivalencia por acabado: mismo eslabón, otro baño,
 * coincidencia verificada en el catálogo); las demás quedan sin definición.
 */

/** Recetas de curva eslabonada (perforada y escalera): ángulo por instancia. */
export const RECETAS_ESLABONADAS: ReadonlySet<string> = new Set(['curva_eslabonada', 'escalera:curva_eslabonada']);

export const GRADOS_POR_ARTICULACION = 22.5;
export const ANGULO_ESLABONADA_POR_DEFECTO = 90;
/** Mínimo EXCLUSIVO: el ángulo tiene que ser mayor (N ≥ 3 eslabones). */
export const ANGULO_ESLABONADA_MIN = 22.5;
export const ANGULO_ESLABONADA_MAX = 180;

/** Radio INTERIOR del gráfico del catálogo para 22,5° por articulación (fila de 5 eslabones). */
export const RADIO_INTERIOR_EPS_MM = 260;
export const RADIO_INTERIOR_CUS_MM = 294;

export const PROCEDENCIA_ESLABONADA =
  'regla del operador (2026-11-15) respaldada por el catálogo: 22,5° por articulación, N = techo(θ/22,5°)+1 sólo para el cómputo; radio del gráfico «RADIO APROX EN MM» para 22,5° por articulación (fila de 5 eslabones: EPS 260, CUS Z 294 mm), tomado al interior (inferencia: la tabla no declara la referencia; las curvas planas de la familia sí, al interior); eje = radio + ala/2; longitud de eje = polígono de N−1 cuerdas';

const grados = (g: number) => `${String(g).replace('.', ',')}°`;

/** null si el ángulo es aceptable; si no, el motivo con el mínimo y la alternativa. */
export function motivoAnguloEslabonada(anguloDeg: number): string | null {
  if (!Number.isFinite(anguloDeg)) return `ángulo inválido: la curva eslabonada acepta más de ${grados(ANGULO_ESLABONADA_MIN)} y hasta ${grados(ANGULO_ESLABONADA_MAX)}`;
  if (anguloDeg <= ANGULO_ESLABONADA_MIN) {
    return `ángulo ${grados(anguloDeg)}: la curva eslabonada necesita más de ${grados(ANGULO_ESLABONADA_MIN)} (3 eslabones o más), porque el gráfico de radios del catálogo arranca en 3 eslabones. Para un giro horizontal menor está la curva ajustable CAS, de 1° a 90°.`;
  }
  if (anguloDeg > ANGULO_ESLABONADA_MAX) return `ángulo ${grados(anguloDeg)}: la curva eslabonada acepta hasta ${grados(ANGULO_ESLABONADA_MAX)}`;
  return null;
}

/** Eslabones de una curva de θ grados: techo(θ/22,5°) + 1 (sólo para el cómputo). Valida el rango. */
export function eslabonesPara(anguloDeg: number): number {
  const motivo = motivoAnguloEslabonada(anguloDeg);
  if (motivo) throw new Error(motivo);
  return eslabonesDeAnguloGuardado(anguloDeg);
}

/**
 * La misma cuenta SIN validar el rango: para piezas ya colocadas con una regla
 * anterior (p. ej. a 20°, que hoy se rechaza), que se siguen mostrando y
 * computando como están hasta que se actualicen.
 */
export function eslabonesDeAnguloGuardado(anguloDeg: number): number {
  // Tolerancia numérica para que 45 / 22,5 dé 2 y no 2,0000000001.
  return Math.ceil(anguloDeg / GRADOS_POR_ARTICULACION - 1e-9) + 1;
}

// ─── Radio por producto ──────────────────────────────────────────────────────

/** Lo que la regla necesita de un producto del catálogo. */
export interface ProductoEslabonado {
  readonly producto_id?: unknown;
  readonly sku?: unknown;
  readonly familia_id?: unknown;
  readonly tipo_pieza?: unknown;
  readonly ancho_nominal_mm?: unknown;
  readonly ala_nominal_mm?: unknown;
  readonly espesor_chapa_mm?: unknown;
}

export type RadioEslabonada =
  | { readonly ok: true; readonly radioInteriorMm: number; readonly procedencia: string }
  | { readonly ok: false; readonly motivo: string };

const sku = (p: ProductoEslabonado) => String(p.sku ?? p.producto_id ?? '').replace(/^SAM_/, '');
const esCUS = (p: ProductoEslabonado) => /^CUS-/.test(sku(p));
const esEPS = (p: ProductoEslabonado) => /^EPS-/.test(sku(p));
const linea = (p: ProductoEslabonado) => String(p.familia_id ?? '');

/**
 * Radio interior de una curva eslabonada, por PRODUCTO. `catalogo`: los productos
 * del catálogo, para buscar la Z equivalente de una CUS G.
 */
export function radioEslabonadaDe(product: ProductoEslabonado, catalogo: Iterable<ProductoEslabonado>): RadioEslabonada {
  if (esEPS(product)) {
    return { ok: true, radioInteriorMm: RADIO_INTERIOR_EPS_MM, procedencia: `gráfico del catálogo (EPS), fila de 5 eslabones = 22,5° por articulación: ${RADIO_INTERIOR_EPS_MM} mm al interior` };
  }
  if (!esCUS(product)) return { ok: false, motivo: `${sku(product)} no es una curva eslabonada (EPS o CUS)` };
  if (linea(product) === 'SAM-STE-Z') {
    return { ok: true, radioInteriorMm: RADIO_INTERIOR_CUS_MM, procedencia: `gráfico del catálogo (CUS línea Z), fila de 5 eslabones = 22,5° por articulación: ${RADIO_INTERIOR_CUS_MM} mm al interior` };
  }
  // Línea G (u otra): el catálogo no publica radio. Se toma el de una Z de igual geometría.
  const mismo = (a: unknown, b: unknown) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9;
  for (const z of catalogo) {
    if (!esCUS(z) || linea(z) !== 'SAM-STE-Z') continue;
    if (mismo(z.ancho_nominal_mm, product.ancho_nominal_mm) && mismo(z.ala_nominal_mm, product.ala_nominal_mm) && mismo(z.espesor_chapa_mm, product.espesor_chapa_mm)) {
      return {
        ok: true,
        radioInteriorMm: RADIO_INTERIOR_CUS_MM,
        procedencia: `equivalencia por acabado con ${sku(z)}: mismo eslabón, distinto baño (ancho ${product.ancho_nominal_mm}, ala ${product.ala_nominal_mm} y espesor ${product.espesor_chapa_mm} mm coinciden en el catálogo); radio del gráfico de la línea Z, ${RADIO_INTERIOR_CUS_MM} mm al interior`,
      };
    }
  }
  return {
    ok: false,
    motivo: `el catálogo no publica radio para ${sku(product)} (ancho ${product.ancho_nominal_mm}, ala ${product.ala_nominal_mm}, espesor ${product.espesor_chapa_mm} mm) y no hay una CUS de la línea Z con la misma geometría de la que tomarlo`,
  };
}

// ─── Medidas ─────────────────────────────────────────────────────────────────

export interface MedidasEslabonada {
  readonly anguloDeg: number;
  readonly radioInteriorMm: number;
  /** Radio del eje (centros de boca): interior + ala/2. */
  readonly radioEjeMm: number;
  readonly eslabones: number;
  readonly articulaciones: number;
  /** Giro de cada articulación (≤ 22,5°). */
  readonly gradosPorArticulacion: number;
  readonly cuerdaMm: number;
  /** Longitud de eje: N−1 cuerdas sobre el radio del eje. */
  readonly longitudEjeMm: number;
}

export function medidasEslabonada(m: { readonly radioInteriorMm: number; readonly alaMm: number; readonly anguloDeg: number }): MedidasEslabonada {
  const eslabones = eslabonesPara(m.anguloDeg);
  const articulaciones = eslabones - 1;
  const alfa = m.anguloDeg / articulaciones;
  const radioEjeMm = m.radioInteriorMm + m.alaMm / 2;
  const cuerdaMm = 2 * radioEjeMm * Math.sin((alfa * Math.PI) / 360);
  return {
    anguloDeg: m.anguloDeg, radioInteriorMm: m.radioInteriorMm, radioEjeMm, eslabones, articulaciones,
    gradosPorArticulacion: alfa, cuerdaMm, longitudEjeMm: articulaciones * cuerdaMm,
  };
}
