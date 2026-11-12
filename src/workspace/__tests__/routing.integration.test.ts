/**
 * Integration test: build a two-piece tray, submit to the Python motor,
 * verify that the connection and union components appear in the cómputo,
 * and check that export→import preserves the tray unchanged.
 *
 * Skipped automatically when the motor is not running.
 * To run: start the motor at 127.0.0.1:8765, then `npx vitest run routing.integration`.
 *
 * Real catalog evidence:
 *   Product: SAM_TRES-150-065-18-G (recta, 150 mm)
 *   Connection: R1.P2 → SEG-1.P1 → compatibility CMP-00001
 *   Expected union component: 4× SAM_JB-CC-3_8 (juego de bulonería 3/8")
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildSegmentPiece } from '../addTraySegment';
import { exportWorkspace, importWorkspace } from '../workspaceFile';
import { checkDirectCompatibility } from '../routingRules';
import type { TrayInput, CatalogCompatibility } from '../../tray/model';

const MOTOR_URL = 'http://127.0.0.1:8765';
const PRODUCT_ID = 'SAM_TRES-150-065-18-G';
const EXPECTED_COMPAT_ID = 'CMP-00001';
const EXPECTED_UNION_PRODUCT = 'SAM_JB-CC-3_8';

// Bug case: Z-product has CMP-01535 as P1↔P2 (not P1↔P1)
const PRODUCT_Z = 'SAM_TRES-300-065-18-Z';
const COMPAT_Z = 'CMP-01535';

let motorAvailable = false;
let catalogCompat: CatalogCompatibility[] = [];
// Base entrada built from motor's own example (includes required Python-side fields)
let baseEntrada: Record<string, unknown> = {
  version_contrato: 'trazado/1',
  piezas: [],
  conexiones: [],
  circuitos: [],
  soportes: [],
  pe: { seccion_requerida_mm2: 16, cable_id: 'UNKNOWN', origen_requisito: 'test', conductores: [] },
};

beforeAll(async () => {
  try {
    const res = await fetch(`${MOTOR_URL}/v1/salud`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    motorAvailable = true;
    const [ex, cat] = await Promise.all([
      fetch(`${MOTOR_URL}/v1/ejemplos`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${MOTOR_URL}/v1/catalogos`, { signal: AbortSignal.timeout(10000) }),
    ]);
    const exData = await ex.json() as Record<string, unknown>;
    const trazado = (exData.ejemplos as Record<string, unknown>)?.trazado_derivacion_pe;
    if (trazado && typeof trazado === 'object' && !Array.isArray(trazado)) {
      baseEntrada = { ...(trazado as Record<string, unknown>) };
    }
    if (cat.ok) {
      const catData = await cat.json() as Record<string, unknown>;
      const rawCat = (catData as Record<string, unknown>).catalogo as Record<string, unknown> | undefined;
      if (Array.isArray(rawCat?.COMPATIBILIDADES)) {
        catalogCompat = rawCat.COMPATIBILIDADES as CatalogCompatibility[];
      }
    }
  } catch {
    motorAvailable = false;
  }
});

/**
 * Build entrada by APPENDING test pieces and connection to the base example.
 * The base example's pe.conductores/equipotencial/tapas/circuitos stay intact,
 * so they still reference valid original pieces. The added SAM_TRES-150-065-18-G
 * connection will appear in the cómputo alongside the example's BOM entries.
 */
function makeEntrada(): Record<string, unknown> {
  const intR1 = buildSegmentPiece('INT-R1', PRODUCT_ID, [0, 100000, 0], [3000, 100000, 0]);
  const intSeg = buildSegmentPiece('INT-SEG', PRODUCT_ID, [3000, 100000, 0], [6000, 100000, 0]);
  const basePiezas = Array.isArray(baseEntrada.piezas) ? baseEntrada.piezas as unknown[] : [];
  const baseConexiones = Array.isArray(baseEntrada.conexiones) ? baseEntrada.conexiones as unknown[] : [];
  return {
    ...baseEntrada,
    piezas: [...basePiezas, intR1, intSeg],
    conexiones: [
      ...baseConexiones,
      { conexion_id: 'CON-INT-001', a: ['INT-R1', 'P2'], b: ['INT-SEG', 'P1'] },
    ],
  };
}

describe('routing integration with real motor catalog', () => {
  it('motor availability check (skips remaining tests if unavailable)', () => {
    if (!motorAvailable) {
      console.log('[integration] Motor not reachable at 127.0.0.1:8765 — skipping');
    }
    expect(true).toBe(true);
  });

  it('R1.P2 → SEG-1.P1 connection produces union components in cómputo', async () => {
    if (!motorAvailable) return;

    const payload = {
      version_contrato: '1.0',
      tipo: 'trazado',
      solicitud_id: 'INT-TEST-001',
      clave: 'int-test',
      revision_entrada: 1,
      entrada: makeEntrada(),
    };

    const res = await fetch(`${MOTOR_URL}/v1/calcular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    expect(res.ok, `Motor returned ${res.status}`).toBe(true);

    const data = await res.json() as Record<string, unknown>;
    expect(data.estado, `Motor error: ${JSON.stringify(data)}`).toBe('ok');

    const resultado = data.resultado as Record<string, unknown>;

    // Our added connection must appear in result
    const conexiones = resultado.conexiones as Record<string, unknown>;
    expect(Object.keys(conexiones), 'CON-INT-001 not in result').toContain('CON-INT-001');

    // Union component SAM_JB-CC-3_8 must appear in cómputo (from CMP-00001)
    const computoJson = JSON.stringify(resultado.computo);
    expect(
      computoJson,
      `Expected union product ${EXPECTED_UNION_PRODUCT} (from ${EXPECTED_COMPAT_ID}) in cómputo`,
    ).toContain(EXPECTED_UNION_PRODUCT);
  });

  // ─── Bug regression: SAM_TRES-300-065-18-Z CMP-01535 (P1↔P2, not P1↔P1) ─────

  it('checkDirectCompatibility resolves Z-product P1↔P1 via D-13 using real catalog', () => {
    if (!motorAvailable || catalogCompat.length === 0) return;

    const zProd = catalogCompat
      .flatMap((c) => [
        c.producto_a_id === PRODUCT_Z ? { producto_id: PRODUCT_Z, tipo_pieza: 'recta', ancho_nominal_mm: 300, familia_id: 'SAM-STE-Z', ala_nominal_mm: 65, sku: PRODUCT_Z, descripcion_original: PRODUCT_Z } : null,
        c.producto_b_id === PRODUCT_Z ? { producto_id: PRODUCT_Z, tipo_pieza: 'recta', ancho_nominal_mm: 300, familia_id: 'SAM-STE-Z', ala_nominal_mm: 65, sku: PRODUCT_Z, descripcion_original: PRODUCT_Z } : null,
      ])
      .find((p) => p !== null);

    if (!zProd) {
      console.log(`[integration] ${PRODUCT_Z} not found in COMPATIBILIDADES — skipping`);
      return;
    }

    const r = checkDirectCompatibility(
      { compatibilidades: catalogCompat, componentesUnion: [] },
      zProd,
      'P1', // source port (the bug case)
      zProd,
      'P1', // requested new-piece port
    );

    expect(r.ok, `Expected ok=true but got: ${r.reason}`).toBe(true);
    expect(r.compatibilidadId).toBe(COMPAT_Z);
    expect(r.newPiecePort).toBe('P1'); // D-13: same product → keep P1
    expect(r.reason).toMatch(/D-13/i);
  });

  it('checkDirectCompatibility resolves Z-product P2↔P1 via real catalog (direct match)', () => {
    if (!motorAvailable || catalogCompat.length === 0) return;

    const zProd = { producto_id: PRODUCT_Z, tipo_pieza: 'recta', ancho_nominal_mm: 300, familia_id: 'SAM-STE-Z', ala_nominal_mm: 65, sku: PRODUCT_Z, descripcion_original: PRODUCT_Z };

    const r = checkDirectCompatibility(
      { compatibilidades: catalogCompat, componentesUnion: [] },
      zProd,
      'P2', // source port
      zProd,
      'P1',
    );

    expect(r.ok, `Expected ok=true from P2 but got: ${r.reason}`).toBe(true);
    expect(r.compatibilidadId).toBe(COMPAT_Z);
    expect(r.newPiecePort).toBe('P1');
  });

  it('Z-product from P1: Python motor accepts the connection', async () => {
    if (!motorAvailable) return;

    const r1 = buildSegmentPiece('INT-Z1', PRODUCT_Z, [0, 200000, 0], [3000, 200000, 0]);
    const seg = buildSegmentPiece('INT-Z2', PRODUCT_Z, [3000, 200000, 0], [6000, 200000, 0]);
    const basePiezas = Array.isArray(baseEntrada.piezas) ? baseEntrada.piezas as unknown[] : [];
    const baseConexiones = Array.isArray(baseEntrada.conexiones) ? baseEntrada.conexiones as unknown[] : [];

    // R1.P2 → SEG.P1 — the connection the motor sees: P2 of R1 connects to P1 of SEG
    // This matches CMP-01535 (P1↔P2 means SAM_TRES-300-065-18-Z-P1 of one piece ↔ SAM_TRES-300-065-18-Z-P2 of another)
    const payload = {
      version_contrato: '1.0',
      tipo: 'trazado',
      solicitud_id: 'INT-Z-P1-001',
      clave: 'int-test',
      revision_entrada: 1,
      entrada: {
        ...baseEntrada,
        piezas: [...basePiezas, r1, seg],
        conexiones: [
          ...baseConexiones,
          { conexion_id: 'CON-Z-001', a: ['INT-Z1', 'P2'], b: ['INT-Z2', 'P1'] },
        ],
      },
    };

    const res = await fetch(`${MOTOR_URL}/v1/calcular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    expect(res.ok, `Motor returned ${res.status}`).toBe(true);

    const data = await res.json() as Record<string, unknown>;
    expect(data.estado, `Motor error: ${JSON.stringify(data)}`).toBe('ok');

    const resultado = data.resultado as Record<string, unknown>;
    const conexiones = resultado.conexiones as Record<string, unknown>;
    expect(Object.keys(conexiones), 'CON-Z-001 not in result').toContain('CON-Z-001');
  });

  it('export → import round-trip preserves pieces and connection', () => {
    // Use a minimal standalone trazado for the round-trip (no need for motor-valid pe structure)
    const r1 = buildSegmentPiece('R1', PRODUCT_ID, [0, 0, 0], [3000, 0, 0]);
    const seg1 = buildSegmentPiece('SEG-1', PRODUCT_ID, [3000, 0, 0], [6000, 0, 0]);
    const entrada: TrayInput = {
      version_contrato: 'trazado/1',
      piezas: [r1, seg1],
      conexiones: [{ conexion_id: 'CON-001', a: ['R1', 'P2'], b: ['SEG-1', 'P1'] }],
      circuitos: [],
      soportes: [],
      pe: { seccion_requerida_mm2: 16, cable_id: 'TEST', origen_requisito: 'test', conductores: [] },
    };

    const json = exportWorkspace([], [], {
      projectOrigin: { x: 0, y: 0, z: 0 },
      factories: [],
      subareas: [],
      elementServices: [],
      ports: [],
      connections: [],
      cableCores: [],
      internalLinks: [],
      functionalRelations: [],
      migrationIncidents: [],
    }, entrada);

    const loaded = importWorkspace(json);
    expect(loaded.trayInput.piezas).toHaveLength(2);
    expect(loaded.trayInput.conexiones).toHaveLength(1);
    expect(loaded.trayInput.conexiones[0].conexion_id).toBe('CON-001');
    expect(loaded.trayInput.conexiones[0].a).toEqual(['R1', 'P2']);
    expect(loaded.trayInput.conexiones[0].b).toEqual(['SEG-1', 'P1']);
    expect(loaded.trayInput.piezas[0].producto_id).toBe(PRODUCT_ID);
    expect(loaded.trayInput.piezas[1].producto_id).toBe(PRODUCT_ID);
  });
});
