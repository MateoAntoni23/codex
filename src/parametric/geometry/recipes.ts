/**
 * recipes.ts — dispatcher que elige la receta geométrica correcta para un
 * piece_kind + parámetros efectivos.
 *
 * Intencionalmente NO importa nada de `../catalog` para evitar ciclos:
 * el catálogo (que depende del output de las recetas para sus puertos)
 * importa desde aquí.
 */

import {
  buildCPS45Recipe,
  buildCPS90Recipe,
  buildCUPSRecipe,
  buildDCPSRecipe,
  buildDCPSLateralRecipe,
  buildTRPSRecipe,
  buildXPSRecipe,
  type GeometryRecipe,
} from './outlines';
import {
  buildCS45Recipe,
  buildCS90Recipe,
  buildRISRecipe,
  buildTRESRecipe,
  buildTSRecipe,
  buildXSRecipe,
} from './escaleraRecipes';
import { buildCurvaEslabonadaRecipe } from './curvaEslabonada';
export { RECETAS_ESLABONADAS } from '../reglaEslabones';

export type PieceKind =
  | 'tramo_recto'
  | 'curva_horizontal'
  | 'curva_vertical'
  | 'derivacion_lateral'
  | 'cruz';

export type RawParams = Readonly<Record<string, number | string | null>>;

/**
 * Un parámetro dimensional que el producto no declara. No hay valores por
 * defecto: antes había (ala 65, ancho 300, largo 3000, ángulo 90) y rellenaban
 * en silencio piezas con medidas inventadas. Ahora la receta no se construye y
 * el motivo llega a quien la pidió (`buildDefinition` lo informa como
 * "no se pudo construir la receta: …").
 */
export class ParametroFaltanteError extends Error {
  constructor(readonly parametro: string, readonly contexto: string) {
    super(`falta ${parametro} (${NOMBRE_CATALOGO[parametro] ?? parametro} en el catálogo) para ${contexto}`);
    this.name = 'ParametroFaltanteError';
  }
}

const NOMBRE_CATALOGO: Record<string, string> = {
  ancho_mm: 'ancho_nominal_mm',
  ala_mm: 'ala_nominal_mm',
  longitud_mm: 'longitud_comercial_mm',
  angulo_deg: 'angulo_grados',
};

function requireNumber(params: RawParams, key: string, contexto: string): number {
  const raw = params[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  throw new ParametroFaltanteError(key, contexto);
}

/**
 * Devuelve la receta geométrica efectiva para una combinación
 * piece_kind + params. Si el tipo de pieza no está soportado lanza, para que
 * el callsite caiga a la ruta GLB o reporte configuración inválida.
 */
export function buildRecipeFor(
  piece_kind: PieceKind,
  params: RawParams,
): GeometryRecipe {
  const ancho_mm = requireNumber(params, 'ancho_mm', piece_kind);
  const ala_mm = requireNumber(params, 'ala_mm', piece_kind);

  switch (piece_kind) {
    case 'tramo_recto': {
      const longitud_mm = requireNumber(params, 'longitud_mm', piece_kind);
      return buildTRPSRecipe({ ancho_mm, ala_mm, longitud_mm });
    }
    case 'curva_horizontal': {
      const ang = requireNumber(params, 'angulo_deg', piece_kind);
      return ang <= 45
        ? buildCPS45Recipe({ ancho_mm, ala_mm })
        : buildCPS90Recipe({ ancho_mm, ala_mm });
    }
    case 'curva_vertical':
      return buildCUPSRecipe({ ancho_mm, ala_mm, sentido: sentidoDe(params, piece_kind) });
    case 'derivacion_lateral':
      return buildDCPSRecipe({ ancho_mm, ala_mm });
    case 'cruz':
      return buildXPSRecipe({ ancho_mm, ala_mm });
    default: {
      // Exhaustividad a nivel de tipo; runtime guard por si llega un literal.
      const _never: never = piece_kind;
      throw new Error(`buildRecipeFor: piece_kind no soportado (${String(_never)})`);
    }
  }
}

/**
 * Despacha una receta por `recipeKey` arbitraria — cubre tanto maestros
 * perforada (recipeKey == PieceKind) como escalera (prefijo `escalera:`).
 *
 * La función es el punto de resolución común: `resolveParametricEntry` del
 * workspace llama aquí cuando el SKU no está indexado en `PARAMETRIC_CATALOG`
 * pero el producto SÍ se resuelve a un maestro. Así variants reales del
 * catálogo (p.ej. TRES-450-090-18-Z) vuelven a tener receta sin que haya que
 * duplicar entradas en el índice `ENTRY_BY_SKU`.
 *
 * Reglas de `recipeKey`:
 *   - 'tramo_recto', 'curva_horizontal', 'curva_vertical',
 *     'derivacion_lateral', 'tee_simetrica', 'cruz' → dispatcher perforada
 *     (`buildRecipeFor`). `tee_simetrica` re-utiliza la receta DCPS (misma
 *     geometría medida del archivo físico DCPS-*.STEP).
 *   - 'escalera:tramo_recto'         → `buildTRESRecipe`
 *   - 'escalera:curva_horizontal'    → `buildCS45Recipe` o `buildCS90Recipe`
 *                                       según `angulo_deg` en params.
 *   - 'curva_eslabonada' / 'escalera:curva_eslabonada' → `buildCurvaEslabonadaRecipe`
 *                                       (EPS y CUS: cadena de eslabones con ángulo
 *                                       por instancia; regla declarada por el
 *                                       operador 2026-11-13). La CUS dejó de usar
 *                                       el perfil de la CUPS ("equivalencia
 *                                       autorizada" retirada: es otra pieza).
 *   - 'escalera:derivacion_lateral'  → `buildTSRecipe`
 *   - 'escalera:cruz'                → `buildXSRecipe`
 *   - 'escalera:reduccion_lateral'   → `buildRISRecipe`
 */
/**
 * Sentido de una curva vertical: parámetro `sentido_vertical` (+1 sube, −1 baja).
 * Sin valor por defecto: lo fija el producto (CUPS-A sube, CUPS-D baja) o la
 * colocación (CUS articulada); ver `buildRecipeFromProduct`.
 */
function sentidoDe(params: RawParams, quien: string): 'sube' | 'baja' {
  const v = requireNumber(params, 'sentido_vertical', quien);
  if (v === 1) return 'sube';
  if (v === -1) return 'baja';
  throw new Error(`${quien}: sentido_vertical ${v} inválido (1 sube, −1 baja)`);
}

export function buildRecipeByKey(recipeKey: string, params: RawParams): GeometryRecipe {
  const ancho_mm = requireNumber(params, 'ancho_mm', recipeKey);
  const ala_mm = requireNumber(params, 'ala_mm', recipeKey);

  switch (recipeKey) {
    case 'escalera:tramo_recto':
      return buildTRESRecipe({ ancho_mm, ala_mm, longitud_mm: requireNumber(params, 'longitud_mm', recipeKey) });
    case 'escalera:curva_horizontal':
      return requireNumber(params, 'angulo_deg', recipeKey) <= 45
        ? buildCS45Recipe({ ancho_mm, ala_mm })
        : buildCS90Recipe({ ancho_mm, ala_mm });
    case 'curva_eslabonada':
    case 'escalera:curva_eslabonada':
      return buildCurvaEslabonadaRecipe({ ancho_mm, ala_mm, angulo_deg: requireNumber(params, 'angulo_deg', recipeKey), sentido: sentidoDe(params, recipeKey) });
    case 'escalera:derivacion_lateral':
      return buildTSRecipe({ ancho_mm, ala_mm });
    case 'escalera:cruz':
      return buildXSRecipe({ ancho_mm, ala_mm });
    case 'escalera:reduccion_lateral':
      return buildRISRecipe({ ancho_mm, ala_mm });
    // Perforada — mapear a PieceKind del dispatcher legacy.
    case 'tramo_recto':
    case 'curva_horizontal':
    case 'curva_vertical':
    case 'derivacion_lateral':
    case 'cruz':
      return buildRecipeFor(recipeKey, params);
    case 'derivacion_dcps':
      // DCPS lateral: medida en los STEP del operador (50 y 300) y ley de escala para el resto.
      return buildDCPSLateralRecipe({ ancho_mm, ala_mm });
    case 'tee_simetrica':
      // El archivo físico DCPS-*.STEP contiene el polígono de la TPS (tee
      // simétrica). Reutilizamos la receta DCPS — la única confusión es el
      // nombre del archivo; la geometría es correcta.
      return buildRecipeFor('derivacion_lateral', params);
    default:
      throw new Error(`buildRecipeByKey: recipeKey no soportada (${recipeKey})`);
  }
}
