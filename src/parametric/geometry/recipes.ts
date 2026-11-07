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
 * Devuelve la receta geométrica efectiva para una combinación
 * piece_kind + params. Si el tipo de pieza no está soportado lanza, para que
 * el callsite caiga a la ruta GLB o reporte configuración inválida.
 */
export function buildRecipeFor(
  piece_kind: PieceKind,
  params: RawParams,
): GeometryRecipe {
  const ancho_mm = readNumber(params, 'ancho_mm', 300);
  const ala_mm = readNumber(params, 'ala_mm', 65);

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
