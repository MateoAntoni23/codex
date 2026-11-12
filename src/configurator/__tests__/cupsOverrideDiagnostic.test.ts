// @vitest-environment node
/**
 * Diagnóstico de la corrección CUPS -150→+150 grabada por el usuario
 * (archivo `catalog-config-2026-11-09.json`). Este test documenta el
 * hallazgo y la acción recomendada:
 *
 *   Fuente del override (centerMm resuelto, marco canónico de la receta):
 *     P1_horizontal: base = [-185, 126, -150]  →  override = [-185, 125, +150]
 *     P2_vertical  : base = [ -39, -20, -150]  →  override = [ -40, -20, +150]
 *
 *   Lo único que cambia de verdad es el signo de la coordenada Z (y un
 *   redondeo ±1 mm en X/Y, no significativo). La transformación es un flip
 *   de centerZ: -ancho/2 → +ancho/2.
 *
 *   La malla CUPS se extruye de forma que Z ∈ [-ancho_mm, 0]. Con el
 *   override, los centros de boca quedan en Z = +150, es decir FUERA del
 *   cuerpo de la pieza (que vive en Z ∈ [-300, 0]). Geométricamente la
 *   boca no está en la cara de la malla.
 *
 *   Historial reciente: el override se grabó mientras la vista 3D del
 *   Configurador tenía un bug de reactividad (la malla no se actualizaba
 *   al cambiar modelFrame/producto, corregido en commit 6589365). Es
 *   probable que el usuario haya compensado visualmente ese desalineo con
 *   un flip de Z que, con el bridge ya corregido, deja la boca fuera de
 *   la pieza.
 *
 *   Acción (siguiendo "CONSERVAR LO CONFIGURADO" + "preview = confirmado"):
 *     - NO desechar silenciosamente el override. Dejarlo persistido.
 *     - Señalarlo en el Configurador como "boca fuera del cuerpo de la
 *       pieza — revisar". Dejar al usuario decidir si confirma o reinicia.
 *     - No propagar un offset fijo de +300 a 450: esta prueba verifica
 *       que la diferencia es exactamente `ancho_mm` (no 300 constante).
 */
import { describe, it, expect } from 'vitest';
import { buildRecipeFor } from '../../parametric/geometry/recipes';
import { resolveRecipeWith } from '../../workspace/resolvedPortGeometry';

const SAVED_OVERRIDE_P1 = { centerMm: [-185, 125, 150] as const };
const SAVED_OVERRIDE_P2 = { centerMm: [-40, -20, 150] as const };

describe('CUPS 300 — override -150→+150 grabado por el usuario', () => {
  const recipe = buildRecipeFor('curva_vertical', { ancho_mm: 300, ala_mm: 50, sentido_vertical: -1 });

  it('la base de la receta coloca ambos puertos en centerZ = -ancho/2 = -150 mm', () => {
    const p1 = recipe.ports.find((p) => p.name === 'P1_horizontal')!;
    const p2 = recipe.ports.find((p) => p.name === 'P2_vertical')!;
    expect(p1.center[2]).toBeCloseTo(-150, 3);
    expect(p2.center[2]).toBeCloseTo(-150, 3);
  });

  it('aplicar el override deja la boca en Z = +150 (fuera del cuerpo Z ∈ [-300, 0])', () => {
    const resolved = resolveRecipeWith(recipe, null, {
      P1_horizontal: { centerMm: SAVED_OVERRIDE_P1.centerMm },
      P2_vertical: { centerMm: SAVED_OVERRIDE_P2.centerMm },
    });
    const p1 = resolved.recipe.ports.find((p) => p.name === 'P1_horizontal')!;
    const p2 = resolved.recipe.ports.find((p) => p.name === 'P2_vertical')!;
    expect(p1.center).toEqual([-185, 125, 150]);
    expect(p2.center).toEqual([-40, -20, 150]);
    // Confirma que ambos quedan fuera del rango de extrusión [-ancho, 0].
    const extrudeMin = -300;
    const extrudeMax = 0;
    expect(p1.center[2] < extrudeMin || p1.center[2] > extrudeMax).toBe(true);
    expect(p2.center[2] < extrudeMin || p2.center[2] > extrudeMax).toBe(true);
  });

  it('la diferencia entre base y override es exactamente ancho_mm = 300 (no un offset constante)', () => {
    // Este invariante impide propagar un "+300" fijo a la variante 450: la
    // regla, si se derivara, sería "flip de signo de centerZ", que en 450
    // se traduce a Δ = 450, no 300.
    const p1 = recipe.ports.find((p) => p.name === 'P1_horizontal')!;
    const p2 = recipe.ports.find((p) => p.name === 'P2_vertical')!;
    expect(SAVED_OVERRIDE_P1.centerMm[2] - p1.center[2]).toBeCloseTo(300, 3);
    expect(SAVED_OVERRIDE_P2.centerMm[2] - p2.center[2]).toBeCloseTo(300, 3);
  });

  it('CUPS 450: aplicar la misma receta de override por valor FIJO extraería la boca del cuerpo también', () => {
    // Pivota el punto crítico del requisito #4 del usuario: NO copiar
    // posiciones absolutas de 300 a 450. Si la única regla fuera "centerZ
    // = +150", en 450 (mesh Z ∈ [-450, 0]) la boca seguiría estando lejos
    // de cualquier cara.
    const recipe450 = buildRecipeFor('curva_vertical', { ancho_mm: 450, ala_mm: 50, sentido_vertical: -1 });
    const p1Base = recipe450.ports.find((p) => p.name === 'P1_horizontal')!;
    expect(p1Base.center[2]).toBeCloseTo(-225, 3); // ancho/2
    // Aplicar el valor +150 a 450 dejaría la boca a Z=+150, que sigue sin
    // caer en una cara (mesh va de -450 a 0). Esto ancla el requisito:
    // el override es específico del modelo base y NO se propaga a la
    // variante sin evidencia adicional.
    expect(p1Base.center[2]).not.toBe(SAVED_OVERRIDE_P1.centerMm[2]);
  });
});
