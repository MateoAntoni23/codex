/**
 * cupsSectionUpThreeWay — regresión #221.
 *
 * Verificaciones conjuntas: para cada boca de la CUPS en la cadena base
 * (TRPS-300→CUPS-300→TRPS-300) y en la variante (TRPS-450→CUPS-450→TRPS-450),
 * el vector v_dir (orientacion_seccion_ws) DEBE ser idéntico en tres estados:
 *
 *   1. preview   — `placeRecipe(...).ports[i].vDir`
 *   2. confirmed — `planAddAccessory(...).newPiece.puertos.X.orientacion_seccion_ws`
 *   3. recovery  — exportWorkspace → JSON.parse → importWorkspace (round-trip
 *                  completo incluyendo assertInput + perpendicularidad).
 *
 * Esto garantiza que la boca de continuación expuesta al usuario tras guardar
 * y recuperar el proyecto es exactamente la misma que vió durante la inserción
 * — con cualquier configuración de ancho/ala válida — y que ni perpendicularidad
 * ni unitariedad se degradan en la ida-vuelta por disco.
 */
import { describe, expect, it } from 'vitest';
import { planAddAccessory } from '../workspaceOperation';
import { placeRecipe, resolveRecipe } from '../parametricBridge';
import { exportWorkspace, importWorkspace } from '../workspaceFile';
import type { TrayInput, Product } from '../../tray/model';
import type { StartPort, DirectCompatResult } from '../routingRules';

const EPS = 1e-6;

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
  tipo_pieza: 'curva vertical interior',
  ancho_nominal_mm: 300,
  sku: 'CUPS-300-A-Z',
  ala_nominal_mm: 50,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const TRPS_450: Product = {
  producto_id: 'SAM_TRPS-450-20-Z',
  descripcion_original: 'TRPS-450-20-Z',
  tipo_pieza: 'recta',
  ancho_nominal_mm: 450,
  sku: 'TRPS-450-20-Z',
  ala_nominal_mm: 50,
  longitud_comercial_mm: 3000,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

const CUPS_450: Product = {
  producto_id: 'SAM_CUPS-450-A-Z',
  descripcion_original: 'CUPS-450-A-Z',
  tipo_pieza: 'curva vertical interior',
  ancho_nominal_mm: 450,
  sku: 'CUPS-450-A-Z',
  ala_nominal_mm: 50,
  familia_id: 'SAM-STP-Z',
} as unknown as Product;

function emptyEntrada(): TrayInput {
  return {
    version_contrato: 'trazado/1',
    piezas: [],
    conexiones: [],
    circuitos: [],
    soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  };
}

function compatOk(newPiecePort: string): DirectCompatResult {
  return {
    ok: true,
    needsReduction: false,
    reason: 'test-fixture',
    compatibilidadId: null,
    requiredUnion: [],
    evidence: '',
    newPiecePort,
  };
}

function runChain(trps: Product, cups: Product) {
  // 1. Colocar recto entrante horizontal con vDir mundial = Z.
  const trpsEntry = resolveRecipe(trps)!;
  const trpsPlaced = placeRecipe(trps, trpsEntry, [0, 0, 25], [1, 0, 0], 'native');

  const entrada = emptyEntrada();
  entrada.piezas.push({
    instancia_id: 'R1',
    producto_id: trps.producto_id,
    longitud_mm: 3000,
    puertos: {
      P1: {
        posicion_mm: trpsPlaced.p1.pos as [number, number, number],
        direccion: trpsPlaced.p1.outwardNormal as [number, number, number],
        orientacion_seccion_ws: trpsPlaced.p1.vDir as [number, number, number],
      },
      P2: {
        posicion_mm: trpsPlaced.p2.pos as [number, number, number],
        direccion: trpsPlaced.p2.outwardNormal as [number, number, number],
        orientacion_seccion_ws: trpsPlaced.p2.vDir as [number, number, number],
      },
    },
  });

  const startPort: StartPort = {
    pieceId: 'R1',
    portName: 'P2',
    pos: trpsPlaced.p2.pos as [number, number, number],
    dir: trpsPlaced.p2.outwardNormal as [number, number, number],
    sectionUp: trpsPlaced.p2.vDir as [number, number, number],
  };

  // 2. Preview — placeRecipe para la CUPS con el mismo startPort.
  const cupsEntry = resolveRecipe(cups)!;
  const previewPlaced = placeRecipe(
    cups,
    cupsEntry,
    startPort.pos,
    startPort.dir,
    'native',
    undefined,
    { entryPortName: 'P1_horizontal', sectionUp: startPort.sectionUp },
  );

  // 3. Confirmed — planAddAccessory persiste la CUPS en la entrada.
  const plan = planAddAccessory(
    entrada,
    startPort,
    cups,
    compatOk('P1_horizontal'),
    'P1_horizontal',
    'right',
  );
  entrada.piezas.push(plan.newPiece);
  entrada.conexiones.push(plan.newConnection);

  // 4. Recovery — roundtrip por workspaceFile (export + import)
  const serialized = exportWorkspace([], [], {
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
  const restored = importWorkspace(serialized);
  const cupsRestored = restored.trayInput.piezas.find((p) => p.instancia_id === plan.newPiece.instancia_id)!;

  return { previewPlaced, plan, cupsRestored };
}

function assertThreeWayAgreement(
  label: string,
  previewPlaced: ReturnType<typeof placeRecipe>,
  plan: { newPiece: { puertos: Record<string, { orientacion_seccion_ws?: [number, number, number]; direccion: [number, number, number] }> } },
  cupsRestored: { puertos: Record<string, { orientacion_seccion_ws?: [number, number, number]; direccion: [number, number, number] }> },
): void {
  for (const port of previewPlaced.ports) {
    const previewV = port.vDir as [number, number, number];
    const confirmedV = plan.newPiece.puertos[port.name].orientacion_seccion_ws;
    const restoredV = cupsRestored.puertos[port.name].orientacion_seccion_ws;

    expect(confirmedV, `${label}.${port.name}: confirmed presente`).toBeDefined();
    expect(restoredV, `${label}.${port.name}: recovery presente`).toBeDefined();

    for (let i = 0; i < 3; i++) {
      expect(
        Math.abs(previewV[i] - confirmedV![i]),
        `${label}.${port.name}: preview[${i}]=${previewV[i]} vs confirmed[${i}]=${confirmedV![i]}`,
      ).toBeLessThan(EPS);
      expect(
        Math.abs(confirmedV![i] - restoredV![i]),
        `${label}.${port.name}: confirmed[${i}]=${confirmedV![i]} vs restored[${i}]=${restoredV![i]}`,
      ).toBeLessThan(EPS);
    }

    // Invariantes: unitario y perpendicular a direccion persistidos.
    const norm = Math.hypot(restoredV![0], restoredV![1], restoredV![2]);
    expect(Math.abs(norm - 1), `${label}.${port.name}: restored unitario`).toBeLessThan(1e-3);
    const d = cupsRestored.puertos[port.name].direccion;
    const dot = restoredV![0] * d[0] + restoredV![1] * d[1] + restoredV![2] * d[2];
    expect(Math.abs(dot), `${label}.${port.name}: restored ⊥ direccion`).toBeLessThan(1e-3);
  }
}

describe('CUPS sectionUp — preview = confirmed = recovery (#221)', () => {
  it('cadena base TRPS-300 → CUPS-300 → TRPS-300 preserva v_dir en los tres estados', () => {
    const { previewPlaced, plan, cupsRestored } = runChain(TRPS_300, CUPS_300);
    assertThreeWayAgreement('base-300', previewPlaced, plan, cupsRestored);
  });

  it('cadena variante TRPS-450 → CUPS-450 → TRPS-450 preserva v_dir en los tres estados', () => {
    const { previewPlaced, plan, cupsRestored } = runChain(TRPS_450, CUPS_450);
    assertThreeWayAgreement('variant-450', previewPlaced, plan, cupsRestored);
  });
});
