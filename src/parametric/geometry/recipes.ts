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

export type PieceKind =
  | 'tramo_recto'
  | 'curva_horizontal'
  | 'curva_vertical'
  | 'derivacion_lateral'
  | 'cruz';

export type RawParams = Readonly<Record<string, number | string | null>>;

function readNumber(params: RawParams, key: string, fallback: number): number {
  const raw = params[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return fallback;
}

/**
 * Advierte una sola vez por combinación (piece_kind, key) cuando se activa un
 * fallback. Mantener un fallback (65 mm para ala) es intencional: no todas las
 * familias usan la misma cota (p.ej. escalera SAM-STE y perforada SAM-STP-Z
 * difieren); cambiarlo globalmente taparía bugs de datos. Esta traza permite
 * localizar en caliente los productos que llegan sin dimensional declarado.
 */
const FALLBACK_WARNED = new Set<string>();
function warnFallback(piece_kind: PieceKind, key: string, fallback: number): void {
  const tag = `${piece_kind}:${key}`;
  if (FALLBACK_WARNED.has(tag)) return;
  FALLBACK_WARNED.add(tag);
  // eslint-disable-next-line no-console
  console.warn(
    `[parametric/recipes] fallback ${key}=${fallback} aplicado para piece_kind=${piece_kind}. ` +
    `El producto no publica '${key}' — revisá el snapshot del catálogo. ` +
    `Este fallback NO sustituye un valor real y no corresponde a todas las familias.`,
  );
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
  const ancho_mm_raw = params.ancho_mm;
  const ancho_mm =
    typeof ancho_mm_raw === 'number' && Number.isFinite(ancho_mm_raw)
      ? ancho_mm_raw
      : (warnFallback(piece_kind, 'ancho_mm', 300), 300);
  const ala_mm_raw = params.ala_mm;
  const ala_mm =
    typeof ala_mm_raw === 'number' && Number.isFinite(ala_mm_raw)
      ? ala_mm_raw
      : (warnFallback(piece_kind, 'ala_mm', 65), 65);

  switch (piece_kind) {
    case 'tramo_recto': {
      const longitud_mm = readNumber(params, 'longitud_mm', 3000);
      return buildTRPSRecipe({ ancho_mm, ala_mm, longitud_mm });
    }
    case 'curva_horizontal': {
      const ang = readNumber(params, 'angulo_deg', 90);
      return ang <= 45
        ? buildCPS45Recipe({ ancho_mm, ala_mm })
        : buildCPS90Recipe({ ancho_mm, ala_mm });
    }
    case 'curva_vertical':
      return buildCUPSRecipe({ ancho_mm, ala_mm });
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
 *   - 'escalera:derivacion_lateral'  → `buildTSRecipe`
 *   - 'escalera:cruz'                → `buildXSRecipe`
 *   - 'escalera:reduccion_lateral'   → `buildRISRecipe`
 */
export function buildRecipeByKey(recipeKey: string, params: RawParams): GeometryRecipe {
  const ancho_mm_raw = params.ancho_mm;
  const ancho_mm =
    typeof ancho_mm_raw === 'number' && Number.isFinite(ancho_mm_raw)
      ? ancho_mm_raw
      : 300;
  const ala_mm_raw = params.ala_mm;
  const ala_mm =
    typeof ala_mm_raw === 'number' && Number.isFinite(ala_mm_raw)
      ? ala_mm_raw
      : 65;
  const longitud_mm = readNumber(params, 'longitud_mm', 3000);
  const angulo_deg = readNumber(params, 'angulo_deg', 90);

  switch (recipeKey) {
    case 'escalera:tramo_recto':
      return buildTRESRecipe({ ancho_mm, ala_mm, longitud_mm });
    case 'escalera:curva_horizontal':
      return angulo_deg <= 45
        ? buildCS45Recipe({ ancho_mm, ala_mm })
        : buildCS90Recipe({ ancho_mm, ala_mm });
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
    case 'tee_simetrica':
      // El archivo físico DCPS-*.STEP contiene el polígono de la TPS (tee
      // simétrica). Reutilizamos la receta DCPS — la única confusión es el
      // nombre del archivo; la geometría es correcta.
      return buildRecipeFor('derivacion_lateral', params);
    default:
      throw new Error(`buildRecipeByKey: recipeKey no soportada (${recipeKey})`);
  }
}
