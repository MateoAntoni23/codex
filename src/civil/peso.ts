/**
 * Peso de la parte civil (A5): umbral de aviso en triángulos.
 *
 * MEDICIÓN en este equipo (2026-11-15; Intel Iris Xe, ANGLE D3D11; script
 * tools/civil_fixture/medir_peso.mjs; detalle en docs/traspaso-parte-civil.md):
 *   - el GIRO de la escena no es el límite: 60 cuadros por segundo (tope de la
 *     pantalla) con 8 millones de triángulos;
 *   - lo que crece es el PESO: por cada millón de triángulos, ~25 MB más en el
 *     archivo de proyecto, ~0,3 s más en cada autoguardado (se guarda en cada
 *     cambio) y ~0,7 s más al abrir el proyecto.
 * Umbral: 1.000.000 de triángulos → archivo de ~25 MB y autoguardado de ~0,3 s.
 * Más arriba se puede seguir, pero cada cambio del proyecto tarda más en guardarse.
 * Al importar un archivo que deja la parte civil por encima del umbral se avisa
 * ANTES de sumarlo a la escena, con el número y la sugerencia de simplificar.
 */
export const UMBRAL_TRIANGULOS_CIVIL = 1_000_000;

/** Medido: MB del archivo de proyecto y segundos de autoguardado por millón de triángulos. */
export const MB_POR_MILLON = 25;
export const SEGUNDOS_GUARDADO_POR_MILLON = 0.3;

export function avisoDePeso(trianglesActuales: number, trianglesNuevos: number): string | null {
  const total = trianglesActuales + trianglesNuevos;
  if (total <= UMBRAL_TRIANGULOS_CIVIL) return null;
  const f = (n: number) => n.toLocaleString('es-AR');
  const millones = total / 1_000_000;
  return `Con este archivo la parte civil pasa a ${f(total)} triángulos (este archivo: ${f(trianglesNuevos)}), por encima de ${f(UMBRAL_TRIANGULOS_CIVIL)}. `
    + `El proyecto queda pesado: unos ${Math.round(millones * MB_POR_MILLON)} MB de archivo y ~${(millones * SEGUNDOS_GUARDADO_POR_MILLON).toFixed(1).replace('.', ',')} s en cada autoguardado (medido en este equipo). `
    + 'Conviene simplificar el modelo antes de importarlo: sin redondeos, chaflanes ni detalles (agujeros, bulones, textos).';
}
