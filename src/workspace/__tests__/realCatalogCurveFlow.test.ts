/**
 * Real-catalog integration test — reproduces the E2 bug reported in browser.
 *
 * Loads the actual snapshot JSON (no motor required — reads the file directly)
 * and runs the ACTUAL routing functions used by RoutingPanel.
 * This proves the fix at the data layer for the exact scenario reported:
 *   "al continuar desde SAM_TRES-300-065-18-Z, el selector muestra un único
 *    compatible, el tramo recto. No aparecen curvas."
 *
 * Covers P1 and P2 starting ports, left/right turn, and the symmetric port
 * fallback used for curves whose catalog entries only document P1.
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
  isWalkable,
  getLimitationReason,
} from '../pieceClassification';
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

const START_PRODUCT_ID = 'SAM_TRES-300-065-18-Z';
const startProduct = snap.PRODUCTOS.find((p) => p.producto_id === START_PRODUCT_ID)!;

function buildBaseTray(): TrayInput {
  // A single straight piece placed along +X; both ports carry unit directions.
  // P1 is at origin pointing -X (outward), P2 at +3000 pointing +X.
  const piece = buildSegmentPiece('R1', START_PRODUCT_ID, [0, 0, 0], [3000, 0, 0]);
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

/**
 * Mirrors RoutingPanel.compatibleIds: unions both port queries when the catalog
 * declares the existing product's ports as interchangeable (CMP-01535 for
 * SAM_TRES-300, etc.). Used to reproduce the UI's selector-level behavior.
 */
function compatibleIdsForUi(productId: string, portName: 'P1' | 'P2', product: Product): Set<string> {
  const ids = getCompatibleProductIds(snap.COMPATIBILIDADES, productId, portName);
  if (hasSelfPortEquivalence(snap.COMPATIBILIDADES, product)) {
    const alt = portName === 'P1' ? 'P2' : 'P1';
    const altIds = getCompatibleProductIds(snap.COMPATIBILIDADES, productId, alt);
    for (const id of altIds) ids.add(id);
  }
  return ids;
}

describe('Real catalog — SAM_TRES-300-065-18-Z curve flow (E2 bug repro)', () => {
  it('start product exists and is tipo_pieza=recta', () => {
    expect(startProduct).toBeDefined();
    expect(startProduct.tipo_pieza).toBe('recta');
  });

  it('catalog uses "curva horizontal" (never "curva") — regression guard', () => {
    const tipos = new Set(snap.PRODUCTOS.map((p) => p.tipo_pieza));
    expect(tipos.has('curva horizontal')).toBe(true);
    expect(tipos.has('curva')).toBe(false);
  });

  // ─── P1 ────────────────────────────────────────────────────────────────────

  describe('from P1 (extremo A)', () => {
    const tray = buildBaseTray();
    const startPort = startPortFrom(tray, 'P1');

    const compatibleIds = compatibleIdsForUi(START_PRODUCT_ID, 'P1', startProduct);
    const compatibleProducts = snap.PRODUCTOS.filter((p) => compatibleIds.has(p.producto_id));
    const horizontalCurves = compatibleProducts.filter(isHorizontalCurve);
    // Insertable curves: fixed radius + angle. Others (articulable, e.g. SAM_CAS) are
    // walkable but surfaced under the limitation list, not in the selector.
    const insertableCurves = horizontalCurves.filter(isInteractivelyInsertable);
    const articulableCurves = horizontalCurves.filter((c) => !isInteractivelyInsertable(c));

    it('selector sees ≥1 horizontal curve as compatible', () => {
      expect(horizontalCurves.length).toBeGreaterThan(0);
    });

    it('insertable curves are isWalkable + isInteractivelyInsertable + no limitation', () => {
      expect(insertableCurves.length).toBeGreaterThan(0);
      for (const c of insertableCurves) {
        expect(isWalkable(c)).toBe(true);
        expect(isInteractivelyInsertable(c)).toBe(true);
        expect(getLimitationReason(c)).toBeNull();
      }
    });

    it('articulable curves (no radio/ángulo) are walkable but non-insertable with explicit limitation', () => {
      for (const c of articulableCurves) {
        expect(isWalkable(c)).toBe(true);
        expect(isInteractivelyInsertable(c)).toBe(false);
        const reason = getLimitationReason(c);
        expect(reason).not.toBeNull();
        expect(reason!.toLowerCase()).toContain('articulable');
      }
    });

    it('checkDirectCompatibility succeeds for every horizontal curve found', () => {
      for (const curve of horizontalCurves) {
        const r = checkDirectCompatibility(
          { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
          startProduct, 'P1', curve, 'P1',
        );
        expect(r.ok, `expected ${curve.producto_id} to be compatible with ${START_PRODUCT_ID} P1 — got: ${r.reason}`).toBe(true);
      }
    });

    it('insertable curves carry finite radio_mm and angulo_grados — radius is data-backed', () => {
      for (const curve of insertableCurves) {
        const radio = (curve as Record<string, unknown>).radio_mm;
        const angulo = (curve as Record<string, unknown>).angulo_grados;
        expect(typeof radio).toBe('number');
        expect(typeof angulo).toBe('number');
        expect(curve.ancho_nominal_mm).not.toBeNull();
      }
    });

    it('planAddCurve builds a valid piece — left turn', () => {
      const curve = insertableCurves[0];
      const compat = checkDirectCompatibility(
        { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
        startProduct, 'P1', curve, 'P1',
      );
      const op = planAddCurve(tray, startPort, curve, compat, 'left');
      expect(op.newPiece.puertos.P1).toBeDefined();
      expect(op.newPiece.puertos.P2).toBeDefined();
      expect(op.newPiece.longitud_eje_mm).toBeGreaterThan(0);
      assertInput({ ...tray, piezas: [...tray.piezas, op.newPiece] });
    });

    it('planAddCurve builds a valid piece — right turn', () => {
      const curve = insertableCurves[0];
      const compat = checkDirectCompatibility(
        { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
        startProduct, 'P1', curve, 'P1',
      );
      const op = planAddCurve(tray, startPort, curve, compat, 'right');
      // P1 of the straight points outward (-X at origin). Right of -X is +Y.
      // Left and right must produce P2 on opposite sides of the Y axis.
      const leftOp = planAddCurve(tray, startPort, curve, compat, 'left');
      const yRight = (op.newPiece.puertos.P2.posicion_mm as [number, number, number])[1];
      const yLeft = (leftOp.newPiece.puertos.P2.posicion_mm as [number, number, number])[1];
      expect(Math.sign(yRight)).not.toBe(Math.sign(yLeft));
      expect(Math.abs(yRight)).toBeGreaterThan(0);
    });
  });

  // ─── P2 ────────────────────────────────────────────────────────────────────

  describe('from P2 (extremo B)', () => {
    const tray = buildBaseTray();
    const startPort = startPortFrom(tray, 'P2');

    const compatibleIds = compatibleIdsForUi(START_PRODUCT_ID, 'P2', startProduct);
    const compatibleProducts = snap.PRODUCTOS.filter((p) => compatibleIds.has(p.producto_id));
    const horizontalCurves = compatibleProducts.filter(isHorizontalCurve);
    const insertableCurves = horizontalCurves.filter(isInteractivelyInsertable);

    it('selector sees ≥1 horizontal curve as compatible', () => {
      expect(horizontalCurves.length).toBeGreaterThan(0);
    });

    it('checkDirectCompatibility succeeds for every horizontal curve found (P2 entry)', () => {
      for (const curve of horizontalCurves) {
        const r = checkDirectCompatibility(
          { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
          startProduct, 'P2', curve, 'P1',
        );
        expect(r.ok, `P2 compat failed for ${curve.producto_id}: ${r.reason}`).toBe(true);
      }
    });

    it('planAddCurve from P2 builds a valid piece and connection uses correct straight port', () => {
      const curve = insertableCurves[0];
      const compat = checkDirectCompatibility(
        { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
        startProduct, 'P2', curve, 'P1',
      );
      const op = planAddCurve(tray, startPort, curve, compat, 'left');
      expect(op.newConnection.a).toEqual(['R1', 'P2']);
      expect(op.newConnection.b[1]).toBe('P1');
    });
  });

  // ─── Continuing with a straight after the curve ────────────────────────────

  it('after curve, continuing with a straight is planAddSegment-compatible', () => {
    const tray = buildBaseTray();
    const startPort = startPortFrom(tray, 'P2');
    const compatibleIds = compatibleIdsForUi(START_PRODUCT_ID, 'P2', startProduct);
    const curves = snap.PRODUCTOS.filter(
      (p) => compatibleIds.has(p.producto_id) && isHorizontalCurve(p) && isInteractivelyInsertable(p),
    );
    const curve = curves[0];
    const curveCompat = checkDirectCompatibility(
      { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
      startProduct, 'P2', curve, 'P1',
    );
    const curveOp = planAddCurve(tray, startPort, curve, curveCompat, 'left');

    // Apply the curve
    const afterCurve: TrayInput = {
      ...tray,
      piezas: [...tray.piezas, curveOp.newPiece],
      conexiones: [...tray.conexiones, curveOp.newConnection],
    };

    // Now continue from the curve's free port (P2 of the curve)
    const curvePiece = curveOp.newPiece;
    const curveP2 = curvePiece.puertos.P2;
    const curveStartPort: StartPort = {
      pieceId: curvePiece.instancia_id,
      portName: 'P2',
      pos: curveP2.posicion_mm as [number, number, number],
      dir: curveP2.direccion as [number, number, number],
    };

    // From the curve's P2, the UI applies hasSelfPortEquivalence (true for horizontal
    // curves by construction), so both P1 and P2 entries are unioned.
    const candidateIds = compatibleIdsForUi(curve.producto_id, 'P2', curve);
    const straight = snap.PRODUCTOS.find(
      (p) => candidateIds.has(p.producto_id) && p.tipo_pieza === 'recta',
    );
    expect(straight, 'expected at least one compatible straight after curve').toBeDefined();

    const straightCompat = checkDirectCompatibility(
      { compatibilidades: snap.COMPATIBILIDADES, componentesUnion: snap.COMPONENTES_UNION },
      curve, 'P2', straight!, 'P1',
    );
    expect(straightCompat.ok, `continuation failed: ${straightCompat.reason}`).toBe(true);
    // Either a direct catalog entry (CMP-01574/CMP-01575 for this pair) or the
    // self-port-equivalence symmetric fallback is acceptable — both are data-backed.

    const straightOp = planAddSegment(
      afterCurve, curveStartPort, straight!, straightCompat, 2000, curveStartPort.dir,
    );
    expect(straightOp.newPiece).toBeDefined();
    assertInput({
      ...afterCurve,
      piezas: [...afterCurve.piezas, straightOp.newPiece],
      conexiones: [...afterCurve.conexiones, straightOp.newConnection],
    });
  });

  // ─── Pre-fix regression ────────────────────────────────────────────────────

  it('pre-fix regression: filtering by tipo_pieza==="curva" returns zero results', () => {
    const compatibleIds = compatibleIdsForUi(START_PRODUCT_ID, 'P1', startProduct);
    const oldFilter = snap.PRODUCTOS.filter(
      (p) => compatibleIds.has(p.producto_id) && p.tipo_pieza === 'curva',
    );
    expect(oldFilter.length).toBe(0); // proves the old filter was always empty
    const newFilter = snap.PRODUCTOS.filter(
      (p) => compatibleIds.has(p.producto_id) && isHorizontalCurve(p),
    );
    expect(newFilter.length).toBeGreaterThan(0); // proves the fix finds curves
  });

  it('pre-fix regression: from P2, old code found zero curves (now fixed via self-equivalence)', () => {
    // The catalog for SAM_TRES-300 documents only P1 entries. Without the
    // hasSelfPortEquivalence fallback, from P2 the compat set is empty.
    const rawP2 = getCompatibleProductIds(snap.COMPATIBILIDADES, START_PRODUCT_ID, 'P2');
    const curvesWithoutFallback = snap.PRODUCTOS.filter(
      (p) => rawP2.has(p.producto_id) && isHorizontalCurve(p),
    );
    expect(curvesWithoutFallback.length).toBe(0); // reproduces the user report
    const uiIds = compatibleIdsForUi(START_PRODUCT_ID, 'P2', startProduct);
    const curvesWithFallback = snap.PRODUCTOS.filter(
      (p) => uiIds.has(p.producto_id) && isHorizontalCurve(p),
    );
    expect(curvesWithFallback.length).toBeGreaterThan(0); // fixed
  });
});
