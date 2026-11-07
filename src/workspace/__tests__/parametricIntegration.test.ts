/**
 * Integración paramétrica — recto (TRPS-300-22-Z) → curva horizontal paramétrica
 * (CPS-300-45-Z / CPS-300-90-Z) → recto, usando las funciones reales que corre
 * `RoutingPanel`: `getCompatibleProductIds` + `hasSelfPortEquivalence`,
 * `checkDirectCompatibility`, `planAddCurve`, `planAddSegment`, con el bridge
 * paramétrico resolviendo P1/P2 desde los polígonos medidos del STEP.
 *
 * Objetivos verificados aquí (reflejan los requisitos del plan):
 *  • Las curvas CPS (radio_mm=null) NO se filtran del selector porque
 *    hasParametricRecipe las admite, aunque isInteractivelyInsertable las rechace.
 *  • planAddCurve usa la receta paramétrica: P2 coincide con el puente, no con
 *    el arco sustituto (R=300+ancho/2) que daría otra posición.
 *  • Puertos coherentes: la dirección saliente en P2 se puede continuar con una
 *    recta compatible desde ese puerto (planAddSegment crea pieza válida).
 *  • Chiralidad: giro izquierda vs. derecha produce P2 en signos opuestos de Y.
 *  • Desde P1 y desde P2 del recto de origen.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getCompatibleProductIds,
  checkDirectCompatibility,
  hasSelfPortEquivalence,
} from '../routingRules';
import { planAddCurve, planAddSegment } from '../workspaceOperation';
import {
  isHorizontalCurve,
  isInteractivelyInsertable,
} from '../pieceClassification';
import { hasParametricRecipe, resolveRecipe } from '../parametricBridge';
import { buildSegmentPiece } from '../addTraySegment';
import { assertInput } from '../../tray/model';
import type {
  Product,
  CatalogCompatibility,
  CatalogUnionComponent,
  CatalogPort,
  TrayInput,
} from '../../tray/model';
import type { StartPort } from '../routingRules';

const SNAPSHOT_PATH = resolve(
  __dirname,
  '../../../vendor/motor_bandejas/datos/catalogo/catalogo_bandejas_snapshot.json',
);

interface Snapshot {
  PRODUCTOS: Product[];
  COMPATIBILIDADES: CatalogCompatibility[];
  COMPONENTES_UNION: CatalogUnionComponent[];
  PUERTOS_PRODUCTO: CatalogPort[];
}
const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as Snapshot;

const START_ID = 'SAM_TRPS-300-22-Z';
const CURVE_45_ID = 'SAM_CPS-300-45-Z';
const CURVE_90_ID = 'SAM_CPS-300-90-Z';

const startProduct = snap.PRODUCTOS.find((p) => p.producto_id === START_ID)!;
const curve45 = snap.PRODUCTOS.find((p) => p.producto_id === CURVE_45_ID)!;
const curve90 = snap.PRODUCTOS.find((p) => p.producto_id === CURVE_90_ID)!;

function buildBaseTray(): TrayInput {
  const piece = buildSegmentPiece('R1', START_ID, [0, 0, 0], [3000, 0, 0]);
  const tray: TrayInput = {
    version_contrato: 'trazado/1',
    piezas: [piece],
    conexiones: [],
    circuitos: [],
    soportes: [],
    pe: { seccion_requerida_mm2: 16, cable_id: 'TEST', origen_requisito: 'test', conductores: [] },
  };
  assertInput(tray);
  return tray;
}

function startPortFrom(tray: TrayInput, portName: 'P1' | 'P2'): StartPort {
  const piece = tray.piezas[0];
  const port = piece.puertos[portName];
  return {
    pieceId: piece.instancia_id,
    portName,
    pos: port.posicion_mm as [number, number, number],
    dir: port.direccion as [number, number, number],
  };
}

function compatibleIdsForUi(productId: string, portName: 'P1' | 'P2', product: Product): Set<string> {
  const ids = getCompatibleProductIds(snap.COMPATIBILIDADES, productId, portName);
  if (hasSelfPortEquivalence(snap.COMPATIBILIDADES, product)) {
    const alt = portName === 'P1' ? 'P2' : 'P1';
    for (const id of getCompatibleProductIds(snap.COMPATIBILIDADES, productId, alt)) ids.add(id);
  }
  return ids;
}

describe('Integración paramétrica — TRPS-300-22-Z + CPS-300-{45,90}-Z', () => {
  it('productos clave existen en el snapshot y tienen receta paramétrica', () => {
    expect(startProduct).toBeDefined();
    expect(curve45).toBeDefined();
    expect(curve90).toBeDefined();
    // Las CPS tienen radio nulo en catálogo — justo el caso que antes bloqueaba
    // isInteractivelyInsertable y que ahora resuelve la receta paramétrica.
    expect((curve45 as Record<string, unknown>).radio_mm).toBeNull();
    expect((curve90 as Record<string, unknown>).radio_mm).toBeNull();
    expect(isInteractivelyInsertable(curve45)).toBe(false);
    expect(isInteractivelyInsertable(curve90)).toBe(false);
    expect(hasParametricRecipe(curve45)).toBe(true);
    expect(hasParametricRecipe(curve90)).toBe(true);
    expect(hasParametricRecipe(startProduct)).toBe(true);
  });

  it('el selector (compatibleWalkable con hasParametricRecipe) incluye ambas CPS desde P1', () => {
    const ids = compatibleIdsForUi(START_ID, 'P1', startProduct);
    const selectable = snap.PRODUCTOS.filter(
      (p) => ids.has(p.producto_id) && isHorizontalCurve(p)
        && (isInteractivelyInsertable(p) || hasParametricRecipe(p)),
    );
    const selectableIds = new Set(selectable.map((p) => p.producto_id));
    expect(selectableIds.has(CURVE_45_ID)).toBe(true);
    expect(selectableIds.has(CURVE_90_ID)).toBe(true);
  });

  describe.each([
    { label: 'desde P1', portName: 'P1' as const },
    { label: 'desde P2', portName: 'P2' as const },
  ])('planAddCurve con receta paramétrica $label', ({ portName }) => {
    for (const curve of [curve45, curve90]) {
      const ang = (curve as Record<string, unknown>).angulo_grados as number;

      it(`${curve.producto_id} coloca P2 con el polígono medido (no con arco sustituto)`, () => {
        const tray = buildBaseTray();
        const start = startPortFrom(tray, portName);
        const compat = checkDirectCompatibility(
          { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
          startProduct, portName, curve, 'P1',
        );
        expect(compat.ok, `compat falló: ${compat.reason}`).toBe(true);

        const op = planAddCurve(tray, start, curve, compat, 'left');
        expect(op.newPiece.puertos.P1.posicion_mm[0]).toBeCloseTo(start.pos[0], 3);
        expect(op.newPiece.puertos.P1.posicion_mm[1]).toBeCloseTo(start.pos[1], 3);
        expect(op.newPiece.puertos.P1.posicion_mm[2]).toBeCloseTo(start.pos[2], 3);

        // P1 de la curva mira hacia el puerto de origen (dirección opuesta).
        const dirP1 = op.newPiece.puertos.P1.direccion as [number, number, number];
        expect(dirP1[0]).toBeCloseTo(-start.dir[0], 2);
        expect(dirP1[1]).toBeCloseTo(-start.dir[1], 2);

        // Radio medido (línea central) vs fallback de catálogo (300+ancho/2=450).
        const p2 = op.newPiece.puertos.P2.posicion_mm as [number, number, number];
        const p1 = op.newPiece.puertos.P1.posicion_mm as [number, number, number];
        const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
        const θ = (ang * Math.PI) / 180;
        const measuredR = chord / (2 * Math.sin(θ / 2));
        // El fallback daría exactamente R=450 → cualquier desvío >1 mm prueba
        // que estamos usando el polígono medido (no el arco sustituto).
        expect(Math.abs(measuredR - 450)).toBeGreaterThan(1);

        // Longitud de eje coincide con R·θ del medido.
        expect(op.newPiece.longitud_eje_mm).toBeCloseTo(measuredR * θ, 1);

        assertInput({ ...tray, piezas: [...tray.piezas, op.newPiece] });
      });

      it(`${curve.producto_id}: giros izquierda/derecha producen P2 en signos opuestos`, () => {
        const tray = buildBaseTray();
        const start = startPortFrom(tray, portName);
        const compat = checkDirectCompatibility(
          { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
          startProduct, portName, curve, 'P1',
        );
        const opL = planAddCurve(tray, start, curve, compat, 'left');
        const opR = planAddCurve(tray, start, curve, compat, 'right');
        const yL = (opL.newPiece.puertos.P2.posicion_mm as [number, number, number])[1];
        const yR = (opR.newPiece.puertos.P2.posicion_mm as [number, number, number])[1];
        expect(Math.sign(yL)).not.toBe(Math.sign(yR));
        expect(Math.abs(yL)).toBeGreaterThan(50);
        expect(Math.abs(yR)).toBeGreaterThan(50);
        // Las magnitudes deben coincidir por simetría del reflejo Householder.
        expect(Math.abs(Math.abs(yL) - Math.abs(yR))).toBeLessThan(1e-6);
      });
    }
  });

  it('cadena recto → CPS-90 paramétrico → recto se encadena sin romper assertInput', () => {
    const tray = buildBaseTray();
    const start = startPortFrom(tray, 'P2');
    const curveCompat = checkDirectCompatibility(
      { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
      startProduct, 'P2', curve90, 'P1',
    );
    expect(curveCompat.ok).toBe(true);
    const curveOp = planAddCurve(tray, start, curve90, curveCompat, 'left');

    const afterCurve: TrayInput = {
      ...tray,
      piezas: [...tray.piezas, curveOp.newPiece],
      conexiones: [...tray.conexiones, curveOp.newConnection],
    };
    assertInput(afterCurve);

    const curveP2 = curveOp.newPiece.puertos.P2;
    const curveStart: StartPort = {
      pieceId: curveOp.newPiece.instancia_id,
      portName: 'P2',
      pos: curveP2.posicion_mm as [number, number, number],
      dir: curveP2.direccion as [number, number, number],
    };

    const candIds = compatibleIdsForUi(curve90.producto_id, 'P2', curve90);
    const straight = snap.PRODUCTOS.find(
      (p) => candIds.has(p.producto_id) && p.tipo_pieza === 'recta' && isInteractivelyInsertable(p),
    );
    expect(straight, 'esperábamos un recto compatible luego de CPS-90 P2').toBeDefined();

    const straightCompat = checkDirectCompatibility(
      { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
      curve90, 'P2', straight!, 'P1',
    );
    expect(straightCompat.ok, straightCompat.reason).toBe(true);

    const straightOp = planAddSegment(
      afterCurve, curveStart, straight!, straightCompat, 1500, curveStart.dir,
    );
    expect(straightOp.newPiece).toBeDefined();
    assertInput({
      ...afterCurve,
      piezas: [...afterCurve.piezas, straightOp.newPiece],
      conexiones: [...afterCurve.conexiones, straightOp.newConnection],
    });
  });

  it('receta resuelta de CPS-300-90-Z mide un radio ≠ 450 mm (justifica el bridge)', () => {
    const entry = resolveRecipe(curve90)!;
    expect(entry).toBeTruthy();
    expect(entry.piece_kind).toBe('curva_horizontal');
    // El fallback actual usaría 450 mm. Si el polígono medido coincidiera con
    // eso, el bridge sería innecesario — este guard documenta que no coincide.
    const tray = buildBaseTray();
    const start = startPortFrom(tray, 'P2');
    const compat = checkDirectCompatibility(
      { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
      startProduct, 'P2', curve90, 'P1',
    );
    const op = planAddCurve(tray, start, curve90, compat, 'left');
    const p1 = op.newPiece.puertos.P1.posicion_mm as [number, number, number];
    const p2 = op.newPiece.puertos.P2.posicion_mm as [number, number, number];
    const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const θ = Math.PI / 2;
    const measuredR = chord / (2 * Math.sin(θ / 2));
    expect(Math.abs(measuredR - 450)).toBeGreaterThan(50);
  });
});
