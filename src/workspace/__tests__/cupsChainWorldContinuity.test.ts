/**
 * Regresión — cadena recto H → CUPS → recto V: continuidad flush en MUNDO.
 *
 * Exige, por cada junta, los tres invariantes físicos de una conexión plana:
 *   (I-pos)    coinciden los centros de ambas bocas en mundo
 *   (I-normal) las normales exteriores son opuestas (n_a = −n_b)
 *   (I-section) los marcos transversales comparten "arriba de sección":
 *                 v_a_mundo = v_b_mundo, u_a_mundo = −u_b_mundo
 *               (consecuencia de u×v=n en marcos right-handed: cuando las
 *                normales son opuestas, uno de los ejes se conserva y el
 *                otro invierte signo — por convención ancho/ala se conserva
 *                en v y se invierte en u, el que apunta "hacia afuera" de
 *                la pieza).
 *
 * Antes del cierre CUPS (D6) la boca P1_horizontal exponía un marco local
 * rotado 180° alrededor de su normal respecto a la convención TRPS/portOnEdgeXZ.
 * Resultado visual: el cuerpo de CUPS quedaba invertido — v_mundo del recto
 * horizontal apuntaba a +Z (ala arriba) mientras v_mundo de CUPS.P1 apuntaba
 * a −Z. Esta regresión bloquea la vuelta de ese desfase.
 *
 * El test corre independiente de la heurística `routingRules.computePortSectionUp`:
 * usa el `vDir` mundial del puerto de salida de CUPS (ya computado por el
 * puente) para armar el sectionUp del tramo vertical — camino canónico que el
 * resto del pipeline adoptará cuando D7 se cierre. También verifica, con el
 * mismo sectionUp heurístico actual (+X proyectado), que la junta vertical
 * sigue siendo flush: así la heurística puede permanecer temporalmente mientras
 * se migra la fuente de sectionUp.
 */
import { describe, expect, it } from 'vitest';
import {
  placeRecipe,
  resolveRecipe,
  type Vec3,
} from '../parametricBridge';
import type { Product } from '../../tray/model';

const TRPS_300: Product = {
  producto_id: 'SAM_TRPS-300-22-Z',
  descripcion_original: 'TRPS-300-22-Z',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 300,
  sku: 'TRPS-300-22-Z',
  ala_nominal_mm: 50,
  longitud_comercial_mm: 3000,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const CUPS_300: Product = {
  producto_id: 'SAM_CUPS-300-A-Z',
  descripcion_original: 'CUPS-300-A-Z',
  tipo_pieza: 'curva vertical exterior',
  ancho_nominal_mm: 300,
  sku: 'CUPS-300-A-Z',
  ala_nominal_mm: 50,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const EPS_POS = 1e-2; // mm
const EPS_DIR_STRICT = 1e-6;
// El polígono CUPS lleva una rotación +45° medida que introduce ~2·10⁻⁴ de
// residuo numérico en las direcciones derivadas del edge. Esa escala se hereda
// a u/v mundo; las componentes "principales" (±1) siguen siendo exactas a 1e-6.
const EPS_DIR_FRAME = 1e-3;

function assertFlush(
  label: string,
  a: { pos: Vec3; outwardNormal: Vec3; uDir: Vec3; vDir: Vec3 },
  b: { pos: Vec3; outwardNormal: Vec3; uDir: Vec3; vDir: Vec3 },
): void {
  // (I-pos)
  const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
  expect(d, `${label}: posiciones coinciden`).toBeLessThan(EPS_POS);
  // (I-normal): n_a + n_b ≈ 0 — normales en los casos de la cadena son
  // axis-aligned exactos; usamos tolerancia estricta.
  for (let i = 0; i < 3; i++) {
    expect(
      Math.abs(a.outwardNormal[i] + b.outwardNormal[i]),
      `${label}: normales opuestas (componente ${i})`,
    ).toBeLessThan(EPS_DIR_STRICT);
  }
  // (I-section)
  //   v_a = v_b
  for (let i = 0; i < 3; i++) {
    expect(
      Math.abs(a.vDir[i] - b.vDir[i]),
      `${label}: v_dir mundo coincide (componente ${i})`,
    ).toBeLessThan(EPS_DIR_FRAME);
  }
  //   u_a = -u_b (consecuencia de u×v=n cuando n_a=−n_b y v_a=v_b)
  for (let i = 0; i < 3; i++) {
    expect(
      Math.abs(a.uDir[i] + b.uDir[i]),
      `${label}: u_dir mundo opuestos (componente ${i})`,
    ).toBeLessThan(EPS_DIR_FRAME);
  }
}

describe('Cadena recto H → CUPS → recto V — continuidad flush en mundo', () => {
  it('junta TRPS.P2 ↔ CUPS.P1_horizontal: posición, normal y marco transversal coinciden', () => {
    const trpsEntry = resolveRecipe(TRPS_300)!;
    const cupsEntry = resolveRecipe(CUPS_300)!;

    // 1) TRPS horizontal en el origen, avanzando +X. P1.center con ala/2 en Z
    //    (coincide con el fixture de parametricBridge.test.ts).
    const trpsPlaced = placeRecipe(
      TRPS_300,
      trpsEntry,
      [0, 0, 25],
      [1, 0, 0],
      'native',
    );
    expect(trpsPlaced.p2.outwardNormal[0]).toBeCloseTo(1, 6);

    // 2) CUPS entrando por P1_horizontal desde el P2 del recto.
    const cupsPlaced = placeRecipe(
      CUPS_300,
      cupsEntry,
      trpsPlaced.p2.pos,
      [1, 0, 0],
      'native',
      undefined,
      { entryPortName: 'P1_horizontal' },
    );

    const cupsP1 = cupsPlaced.ports.find((p) => p.name === 'P1_horizontal')!;
    assertFlush('TRPS.P2 ↔ CUPS.P1_horizontal', trpsPlaced.p2, cupsP1);
  });

  it('junta CUPS.P2_vertical ↔ recto vertical P1: flush con sectionUp tomado del v_dir mundial del puerto fuente', () => {
    const trpsEntry = resolveRecipe(TRPS_300)!;
    const cupsEntry = resolveRecipe(CUPS_300)!;

    const trpsPlaced = placeRecipe(
      TRPS_300,
      trpsEntry,
      [0, 0, 25],
      [1, 0, 0],
      'native',
    );
    const cupsPlaced = placeRecipe(
      CUPS_300,
      cupsEntry,
      trpsPlaced.p2.pos,
      [1, 0, 0],
      'native',
      undefined,
      { entryPortName: 'P1_horizontal' },
    );
    const cupsP2v = cupsPlaced.ports.find((p) => p.name === 'P2_vertical')!;

    // entryDir del siguiente tramo = outwardNormal del puerto fuente (la nueva
    // pieza avanza "saliendo" de la boca de origen). Convención de placeRecipe:
    // su P1.outwardNormal queda = −entryDir.
    const entryDir: Vec3 = cupsP2v.outwardNormal;
    // sectionUp canónico: el v_dir en mundo del puerto fuente. Esta es la fuente
    // de verdad que D7 propagará; el test verifica que el marco del puente ya
    // consume esa semántica correctamente.
    const sectionUp: Vec3 = cupsP2v.vDir;
    const rectoV = placeRecipe(
      TRPS_300,
      trpsEntry,
      cupsP2v.pos,
      entryDir,
      'native',
      undefined,
      { sectionUp },
    );

    assertFlush('CUPS.P2_vertical ↔ TRPS(vert).P1', cupsP2v, rectoV.p1);
  });

  it('junta CUPS.P2_vertical ↔ recto vertical P1: flush compatible con sectionUp heurístico actual (+X)', () => {
    // Mantiene operativa la heurística `routingRules.computePortSectionUp` hasta
    // que D7 migre la fuente al v_dir del puerto. Con el fix de CUPS.P1_horizontal
    // NO cambia el v_dir local de CUPS.P2_vertical, por lo que el sectionUp
    // heurístico +X sigue siendo consistente.
    const trpsEntry = resolveRecipe(TRPS_300)!;
    const cupsEntry = resolveRecipe(CUPS_300)!;

    const trpsPlaced = placeRecipe(
      TRPS_300,
      trpsEntry,
      [0, 0, 25],
      [1, 0, 0],
      'native',
    );
    const cupsPlaced = placeRecipe(
      CUPS_300,
      cupsEntry,
      trpsPlaced.p2.pos,
      [1, 0, 0],
      'native',
      undefined,
      { entryPortName: 'P1_horizontal' },
    );
    const cupsP2v = cupsPlaced.ports.find((p) => p.name === 'P2_vertical')!;

    const entryDir: Vec3 = cupsP2v.outwardNormal;
    // Heurística equivalente a routingRules.computePortSectionUp: offset XY entre
    // P1_horizontal y P2_vertical de la CUPS en mundo.
    const cupsP1 = cupsPlaced.ports.find((p) => p.name === 'P1_horizontal')!;
    const dx = cupsP2v.pos[0] - cupsP1.pos[0];
    const dy = cupsP2v.pos[1] - cupsP1.pos[1];
    const len = Math.hypot(dx, dy);
    const sectionUp: Vec3 = len > 1e-6 ? [dx / len, dy / len, 0] : [1, 0, 0];

    const rectoV = placeRecipe(
      TRPS_300,
      trpsEntry,
      cupsP2v.pos,
      entryDir,
      'native',
      undefined,
      { sectionUp },
    );

    assertFlush('CUPS.P2_vertical ↔ TRPS(vert).P1 [heurístico]', cupsP2v, rectoV.p1);
  });
});
