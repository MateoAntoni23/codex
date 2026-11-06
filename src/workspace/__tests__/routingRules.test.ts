import { describe, it, expect } from 'vitest';
import {
  getOccupiedPorts,
  getFreePorts,
  snapDirectionToAxis,
  snapChangesDirection,
  angleBetweenDirs,
  computeEndpoint,
  checkDirectCompatibility,
  findReductionCandidates,
  verifyStartPortValid,
  generateConnectionId,
  getCompatibleProductIds,
} from '../routingRules';
import type { FreePort, Point3 } from '../routingRules';
import type { Piece, Product, CatalogCompatibility, CatalogUnionComponent, CatalogPort } from '../../tray/model';

// ─── helpers ──────────────────────────────────────────────────────────────────

const makePiece = (id: string, ports: Record<string, { pos: Point3; dir: Point3 }>): Piece => ({
  instancia_id: id,
  producto_id: 'P',
  puertos: Object.fromEntries(
    Object.entries(ports).map(([name, { pos, dir }]) => [
      name,
      { posicion_mm: pos, direccion: dir },
    ]),
  ),
});

const makeProduct = (
  id: string,
  ancho: number | null,
  familia: string | null,
  tipo = 'recta',
): Product => ({
  producto_id: id,
  descripcion_original: id,
  tipo_pieza: tipo,
  ancho_nominal_mm: ancho,
  sku: id,
  ...(familia ? { familia_id: familia } : {}),
});

const makeCompat = (
  id: string,
  prodA: string,
  portA: string | null,
  prodB: string,
  portB: string | null,
  tipo = 'directa',
  estado = 'vigente',
): CatalogCompatibility => ({
  compatibilidad_id: id,
  producto_a_id: prodA,
  puerto_a_id: portA,
  producto_b_id: prodB,
  puerto_b_id: portB,
  tipo_conexion: tipo,
  estado_compatibilidad: estado,
});

const makeCatalogPort = (productId: string, portSuffix: string): CatalogPort => ({
  puerto_id: `${productId}-${portSuffix}`,
  producto_id: productId,
  nombre_puerto: portSuffix,
  ancho_nominal_mm: null,
  ala_nominal_mm: null,
  interfaz_conexion: null,
});

const P1: Point3 = [0, 0, 0];
const P2: Point3 = [3000, 0, 0];
const DIR_P1: Point3 = [-1, 0, 0];
const DIR_P2: Point3 = [1, 0, 0];

const piece1 = makePiece('R1', {
  P1: { pos: P1, dir: DIR_P1 },
  P2: { pos: P2, dir: DIR_P2 },
});
const piece2 = makePiece('R2', {
  P1: { pos: P2, dir: DIR_P1 },
  P2: { pos: [6000, 0, 0], dir: DIR_P2 },
});

// ─── getOccupiedPorts ─────────────────────────────────────────────────────────

describe('getOccupiedPorts', () => {
  it('returns empty set for no connections', () => {
    expect(getOccupiedPorts([])).toEqual(new Set());
  });

  it('marks both ends of a connection', () => {
    const occ = getOccupiedPorts([{ conexion_id: 'C1', a: ['R1', 'P2'], b: ['R2', 'P1'] }]);
    expect(occ.has('R1:P2')).toBe(true);
    expect(occ.has('R2:P1')).toBe(true);
    expect(occ.has('R1:P1')).toBe(false);
  });
});

// ─── getFreePorts ─────────────────────────────────────────────────────────────

describe('getFreePorts', () => {
  it('returns all ports when no connections', () => {
    const free = getFreePorts([piece1], []);
    expect(free).toHaveLength(2);
    expect(free.map((f) => f.portName).sort()).toEqual(['P1', 'P2']);
  });

  it('excludes occupied ports', () => {
    const free = getFreePorts(
      [piece1, piece2],
      [{ conexion_id: 'C1', a: ['R1', 'P2'], b: ['R2', 'P1'] }],
    );
    const keys = free.map((f) => `${f.pieceId}:${f.portName}`);
    expect(keys).not.toContain('R1:P2');
    expect(keys).not.toContain('R2:P1');
    expect(keys).toContain('R1:P1');
    expect(keys).toContain('R2:P2');
  });

  it('returns empty array for no pieces', () => {
    expect(getFreePorts([], [])).toEqual([]);
  });

  it('free port carries position and direction', () => {
    const free = getFreePorts([piece1], []);
    const p1Port = free.find((f) => f.portName === 'P1') as FreePort;
    expect(p1Port.pos).toEqual([0, 0, 0]);
    expect(p1Port.dir).toEqual([-1, 0, 0]);
  });
});

// ─── snapDirectionToAxis ──────────────────────────────────────────────────────

describe('snapDirectionToAxis', () => {
  it('snaps dominant X+', () => {
    expect(snapDirectionToAxis([0.9, 0.1, 0.1])).toEqual([1, 0, 0]);
  });

  it('snaps dominant X-', () => {
    expect(snapDirectionToAxis([-0.9, 0.1, 0.1])).toEqual([-1, 0, 0]);
  });

  it('snaps dominant Y', () => {
    expect(snapDirectionToAxis([0.1, 0.8, 0.3])).toEqual([0, 1, 0]);
  });

  it('snaps dominant Z', () => {
    expect(snapDirectionToAxis([0.1, 0.2, 0.9])).toEqual([0, 0, 1]);
  });

  it('handles unit axis without change', () => {
    expect(snapDirectionToAxis([1, 0, 0])).toEqual([1, 0, 0]);
    expect(snapDirectionToAxis([0, 0, -1])).toEqual([0, 0, -1]);
  });
});

// ─── computeEndpoint ─────────────────────────────────────────────────────────

describe('computeEndpoint', () => {
  it('extends along X axis', () => {
    expect(computeEndpoint([0, 0, 0], [1, 0, 0], 3000)).toEqual([3000, 0, 0]);
  });

  it('extends along Z axis', () => {
    expect(computeEndpoint([0, 0, 0], [0, 0, 1], 500)).toEqual([0, 0, 500]);
  });

  it('works from non-origin start', () => {
    const result = computeEndpoint([100, 200, 300], [0, 1, 0], 1000);
    expect(result).toEqual([100, 1200, 300]);
  });
});

// ─── checkDirectCompatibility (legacy heuristic — empty catalog) ──────────────

describe('checkDirectCompatibility (empty catalog — heuristic fallback)', () => {
  const emptyCtx = { compatibilidades: [], componentesUnion: [] };

  const p150famA = makeProduct('A', 150, 'FAM-1');
  const p150famA2 = makeProduct('B', 150, 'FAM-1');
  const p300famA = makeProduct('C', 300, 'FAM-1');
  const p150famB = makeProduct('D', 150, 'FAM-2');

  it('returns compatibilidadId: undefined when catalog is empty', () => {
    const r = checkDirectCompatibility(emptyCtx, p150famA, 'P2', p150famA2, 'P1');
    expect(r.ok).toBe(false);
    expect(r.compatibilidadId).toBeUndefined();
    expect(r.reason).toMatch(/no disponibles/i);
  });

  it('reports needsReduction=false and ok=false when different family (empty catalog)', () => {
    const r = checkDirectCompatibility(emptyCtx, p150famA, 'P2', p150famB, 'P1');
    expect(r.ok).toBe(false);
    expect(r.compatibilidadId).toBeUndefined();
  });

  it('reports ok=false for different width (empty catalog)', () => {
    const r = checkDirectCompatibility(emptyCtx, p150famA, 'P2', p300famA, 'P1');
    expect(r.ok).toBe(false);
    expect(r.compatibilidadId).toBeUndefined();
  });
});

// ─── checkDirectCompatibility with catalog data ───────────────────────────────

describe('checkDirectCompatibility with catalog data', () => {
  const prodA = makeProduct('TRES-300', 300, 'FAM-1', 'recta');
  const prodB = makeProduct('TRES-150', 150, 'FAM-1', 'recta');
  const prodC = makeProduct('TRES-200', 200, 'FAM-1', 'recta');
  const prodD = makeProduct('OTRO', 300, 'FAM-2', 'recta');

  // CMP-001 documents the specific P1↔P1 connection
  const compatDirecta = makeCompat('CMP-001', 'TRES-300', 'TRES-300-P1', 'TRES-150', 'TRES-150-P1');
  const compatNoComp = makeCompat('CMP-002', 'TRES-300', null, 'OTRO', null, 'directa', 'no compatible');
  const unionEntry: CatalogUnionComponent = { compatibilidad_id: 'CMP-001', producto_requerido_id: 'UNION-KIT', cantidad: 2 };

  it('compatible when COMPATIBILIDADES has a directa entry matching the specific ports', () => {
    const ctx = { compatibilidades: [compatDirecta], componentesUnion: [] };
    const r = checkDirectCompatibility(ctx, prodA, 'P1', prodB, 'P1');
    expect(r.ok).toBe(true);
    expect(r.needsReduction).toBe(false);
    expect(r.compatibilidadId).toBe('CMP-001');
  });

  it('blocks when port names do not match catalog entry (port-level validation)', () => {
    // CMP-001 documents P1↔P1; asking for P2↔P1 should NOT match
    const ctx = { compatibilidades: [compatDirecta], componentesUnion: [] };
    const r = checkDirectCompatibility(ctx, prodA, 'P2', prodB, 'P1');
    expect(r.ok).toBe(false);
    expect(r.compatibilidadId).toBeNull();
  });

  it('accepts when catalog entry has null ports (product-level match sufficient)', () => {
    const nullPortCompat = makeCompat('CMP-NULL', 'TRES-300', null, 'TRES-150', null);
    const ctx = { compatibilidades: [nullPortCompat], componentesUnion: [] };
    const r = checkDirectCompatibility(ctx, prodA, 'P2', prodB, 'P1');
    expect(r.ok).toBe(true);
    expect(r.compatibilidadId).toBe('CMP-NULL');
  });

  it('blocks when no entry found', () => {
    const ctx = { compatibilidades: [compatDirecta], componentesUnion: [] };
    const r = checkDirectCompatibility(ctx, prodA, 'P1', prodC, 'P1');
    expect(r.ok).toBe(false);
    expect(r.compatibilidadId).toBeNull();
  });

  it('blocks when entry exists but is "no compatible"', () => {
    const ctx = { compatibilidades: [compatNoComp], componentesUnion: [] };
    const r = checkDirectCompatibility(ctx, prodA, 'P2', prodD, 'P1');
    expect(r.ok).toBe(false);
    expect(r.compatibilidadId).toBe('CMP-002');
  });

  it('reports requiredUnion when componentesUnion has entries', () => {
    const ctx = { compatibilidades: [compatDirecta], componentesUnion: [unionEntry] };
    const r = checkDirectCompatibility(ctx, prodA, 'P1', prodB, 'P1');
    expect(r.ok).toBe(true);
    expect(r.requiredUnion).toHaveLength(1);
    expect(r.requiredUnion[0].productId).toBe('UNION-KIT');
    expect(r.requiredUnion[0].quantity).toBe(2);
  });

  it('works bidirectionally (B→A same as A→B)', () => {
    const ctx = { compatibilidades: [compatDirecta], componentesUnion: [] };
    const r = checkDirectCompatibility(ctx, prodB, 'P1', prodA, 'P1');
    expect(r.ok).toBe(true);
    expect(r.compatibilidadId).toBe('CMP-001');
  });
});

// ─── findReductionCandidates (legacy — empty catalog) ────────────────────────

describe('findReductionCandidates (empty catalog)', () => {
  const emptyCtx = { productos: [], compatibilidades: [], componentesUnion: [], puertos: [] };

  it('returns empty when compatibilidades is empty', () => {
    const existing = makeProduct('BASE', 300, 'FAM-1', 'recta');
    const newProd  = makeProduct('TRES-150', 150, 'FAM-1', 'recta');
    const result = findReductionCandidates(emptyCtx, existing, newProd);
    expect(result).toHaveLength(0);
  });
});

// ─── findReductionCandidates with catalog data ────────────────────────────────

describe('findReductionCandidates with catalog data', () => {
  const existing = makeProduct('TRES-300', 300, 'FAM-1', 'recta');
  const newProd  = makeProduct('TRES-150', 150, 'FAM-1', 'recta');
  const redValid = makeProduct('RED-300-150', 300, 'FAM-1', 'reducción');
  const redOther = makeProduct('RED-300-100', 300, 'FAM-1', 'reducción');

  // Catalog ports for redValid
  const portP1 = makeCatalogPort('RED-300-150', 'P1');
  const portP2 = makeCatalogPort('RED-300-150', 'P2');

  // Compatibility: existing ↔ redValid P1
  const compatExisting = makeCompat('CMP-EX', 'TRES-300', 'TRES-300-P1', 'RED-300-150', 'RED-300-150-P1');
  // Compatibility: redValid P2 ↔ newProd
  const compatNew = makeCompat('CMP-NEW', 'RED-300-150', 'RED-300-150-P2', 'TRES-150', 'TRES-150-P1');

  // For redOther: existing ↔ redOther P1 (compatible), but no P2 ↔ newProd entry
  const portP1b = makeCatalogPort('RED-300-100', 'P1');
  const portP2b = makeCatalogPort('RED-300-100', 'P2');
  const compatExistingB = makeCompat('CMP-EX2', 'TRES-300', 'TRES-300-P1', 'RED-300-100', 'RED-300-100-P1');

  it('returns candidate when both ports are documented in COMPATIBILIDADES', () => {
    const ctx = {
      productos: [existing, newProd, redValid],
      compatibilidades: [compatExisting, compatNew],
      componentesUnion: [],
      puertos: [portP1, portP2],
    };
    const candidates = findReductionCandidates(ctx, existing, newProd);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].reductionProduct.producto_id).toBe('RED-300-150');
    expect(candidates[0].reductionPortToExisting).toBe('P1');
    expect(candidates[0].reductionPortToNew).toBe('P2');
  });

  it('excludes candidates where only one port has a compatibility entry', () => {
    const ctx = {
      productos: [existing, newProd, redOther],
      compatibilidades: [compatExistingB], // only side A, no side B
      componentesUnion: [],
      puertos: [portP1b, portP2b],
    };
    const candidates = findReductionCandidates(ctx, existing, newProd);
    expect(candidates).toHaveLength(0);
  });

  it('returns exactly the reduction product that matches, not a fallback', () => {
    const ctx = {
      productos: [existing, newProd, redValid, redOther],
      compatibilidades: [compatExisting, compatNew, compatExistingB],
      componentesUnion: [],
      puertos: [portP1, portP2, portP1b, portP2b],
    };
    const candidates = findReductionCandidates(ctx, existing, newProd);
    // Only redValid has both sides documented
    expect(candidates.map((c) => c.reductionProduct.producto_id)).toContain('RED-300-150');
    expect(candidates.map((c) => c.reductionProduct.producto_id)).not.toContain('RED-300-100');
  });

  it('reduction-shown === reduction-saved (via reductionProduct.producto_id)', () => {
    const ctx = {
      productos: [existing, newProd, redValid],
      compatibilidades: [compatExisting, compatNew],
      componentesUnion: [],
      puertos: [portP1, portP2],
    };
    const candidates = findReductionCandidates(ctx, existing, newProd);
    expect(candidates[0].reductionProduct.producto_id).toBe('RED-300-150');
    // The ID in the candidate is what gets stored and committed
  });

  it('reports union accessories for each connection side', () => {
    const union1: CatalogUnionComponent = { compatibilidad_id: 'CMP-EX', producto_requerido_id: 'KIT-A', cantidad: 1 };
    const union2: CatalogUnionComponent = { compatibilidad_id: 'CMP-NEW', producto_requerido_id: 'KIT-B', cantidad: 2 };
    const ctx = {
      productos: [existing, newProd, redValid],
      compatibilidades: [compatExisting, compatNew],
      componentesUnion: [union1, union2],
      puertos: [portP1, portP2],
    };
    const candidates = findReductionCandidates(ctx, existing, newProd);
    expect(candidates[0].unionForExistingConn).toHaveLength(1);
    expect(candidates[0].unionForExistingConn[0].productId).toBe('KIT-A');
    expect(candidates[0].unionForNewConn).toHaveLength(1);
    expect(candidates[0].unionForNewConn[0].productId).toBe('KIT-B');
  });

  it('geometryDocumented is false when longitud_comercial_mm is null (no catalog data)', () => {
    // makeProduct does not set longitud_comercial_mm → access returns undefined → treated as null
    const ctx = {
      productos: [existing, newProd, redValid],
      compatibilidades: [compatExisting, compatNew],
      componentesUnion: [],
      puertos: [portP1, portP2],
    };
    const candidates = findReductionCandidates(ctx, existing, newProd);
    expect(candidates[0].geometryDocumented).toBe(false);
  });

  it('geometryDocumented is true when longitud_comercial_mm is set', () => {
    const redWithLength = { ...redValid, longitud_comercial_mm: 150 } as Product;
    const ctx = {
      productos: [existing, newProd, redWithLength],
      compatibilidades: [compatExisting, compatNew],
      componentesUnion: [],
      puertos: [portP1, portP2],
    };
    const candidates = findReductionCandidates(ctx, existing, newProd);
    expect(candidates[0].geometryDocumented).toBe(true);
  });
});

// ─── verifyStartPortValid ─────────────────────────────────────────────────────

describe('verifyStartPortValid', () => {
  const pos: Point3 = [100, 200, 300];
  const dir: Point3 = [1, 0, 0];
  const piece = makePiece('P1', { P1: { pos, dir } });
  piece.instancia_id = 'PIECE-1';
  piece.puertos['P1'] = { posicion_mm: pos, direccion: dir };

  const startPort = { pieceId: 'PIECE-1', portName: 'P1', pos, dir };

  it('returns valid when port exists and is free', () => {
    const result = verifyStartPortValid([piece], [], startPort);
    expect(result.valid).toBe(true);
    expect(result.reason).toBe('');
  });

  it('returns invalid when piece does not exist', () => {
    const result = verifyStartPortValid([], [], startPort);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/ya no existe/i);
  });

  it('returns invalid when port is occupied', () => {
    const conn = { conexion_id: 'C1', a: ['PIECE-1', 'P1'] as [string, string], b: ['OTHER', 'P2'] as [string, string] };
    const result = verifyStartPortValid([piece], [conn], startPort);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/ocupado/i);
  });

  it('returns invalid when position changed beyond tolerance', () => {
    const movedPort = { pieceId: 'PIECE-1', portName: 'P1', pos: [100, 200, 301] as Point3, dir };
    const result = verifyStartPortValid([piece], [], movedPort);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/posición/i);
  });

  it('returns valid when position is within tolerance (0.001 mm)', () => {
    const nearPort = { pieceId: 'PIECE-1', portName: 'P1', pos: [100.001, 200, 300] as Point3, dir };
    const result = verifyStartPortValid([piece], [], nearPort);
    expect(result.valid).toBe(true);
  });

  it('returns invalid when direction changed beyond 1 degree', () => {
    // Piece has dir [1,0,0] but stored startPort had dir [0,1,0] — 90° mismatch
    const wrongDirPort = { pieceId: 'PIECE-1', portName: 'P1', pos, dir: [0, 1, 0] as Point3 };
    const result = verifyStartPortValid([piece], [], wrongDirPort);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/dirección/i);
  });

  it('returns valid when stored direction is within 1 degree of actual', () => {
    // 0.5° off from [1,0,0] — within tolerance
    const angleRad = (0.5 * Math.PI) / 180;
    const slightDir: Point3 = [Math.cos(angleRad), Math.sin(angleRad), 0];
    const nearDirPort = { pieceId: 'PIECE-1', portName: 'P1', pos, dir: slightDir };
    const result = verifyStartPortValid([piece], [], nearDirPort);
    expect(result.valid).toBe(true);
  });
});

// ─── snapChangesDirection ─────────────────────────────────────────────────────

describe('snapChangesDirection', () => {
  it('returns false when direction is already axis-aligned', () => {
    expect(snapChangesDirection([1, 0, 0])).toBe(false);
    expect(snapChangesDirection([0, 0, -1])).toBe(false);
    expect(snapChangesDirection([0, 1, 0])).toBe(false);
  });

  it('returns true when direction is at 45 degrees', () => {
    const d45 = Math.SQRT1_2; // 1/sqrt(2)
    expect(snapChangesDirection([d45, d45, 0])).toBe(true);
  });

  it('returns false for near-axis direction within 1 degree', () => {
    // Direction nearly aligned with X axis (less than 1° off)
    const angleRad = (0.5 * Math.PI) / 180; // 0.5 degrees
    const dir: Point3 = [Math.cos(angleRad), Math.sin(angleRad), 0];
    expect(snapChangesDirection(dir)).toBe(false);
  });

  it('returns true for direction more than 1 degree off axis', () => {
    // Direction 2° off X axis
    const angleRad = (2 * Math.PI) / 180;
    const dir: Point3 = [Math.cos(angleRad), Math.sin(angleRad), 0];
    expect(snapChangesDirection(dir)).toBe(true);
  });
});

// ─── angleBetweenDirs ─────────────────────────────────────────────────────────

describe('angleBetweenDirs', () => {
  it('returns 0 for same direction', () => {
    expect(angleBetweenDirs([1, 0, 0], [1, 0, 0])).toBeCloseTo(0);
  });

  it('returns 0 for opposite directions (uses abs dot)', () => {
    expect(angleBetweenDirs([1, 0, 0], [-1, 0, 0])).toBeCloseTo(0);
  });

  it('returns 90 for perpendicular directions', () => {
    expect(angleBetweenDirs([1, 0, 0], [0, 1, 0])).toBeCloseTo(90);
  });

  it('returns 45 for 45-degree angle', () => {
    const d = Math.SQRT1_2;
    expect(angleBetweenDirs([1, 0, 0], [d, d, 0])).toBeCloseTo(45);
  });
});

// ─── generateConnectionId ────────────────────────────────────────────────────

describe('generateConnectionId', () => {
  it('returns CON-001 for empty set', () => {
    expect(generateConnectionId(new Set())).toBe('CON-001');
  });

  it('skips existing IDs', () => {
    expect(generateConnectionId(new Set(['CON-001', 'CON-002']))).toBe('CON-003');
  });

  it('never returns an ID in the set', () => {
    const existing = new Set(['CON-001', 'CON-002', 'CON-003']);
    expect(existing.has(generateConnectionId(existing))).toBe(false);
  });

  it('is not confused by IDs from other namespaces', () => {
    expect(generateConnectionId(new Set(['SUP-1', 'SEG-1']))).toBe('CON-001');
  });
});

// ─── getCompatibleProductIds ──────────────────────────────────────────────────

describe('getCompatibleProductIds', () => {
  const c1 = makeCompat('C1', 'PROD-A', 'PROD-A-P2', 'PROD-B', 'PROD-B-P1');
  const c2 = makeCompat('C2', 'PROD-A', null, 'PROD-C', null);
  const c3 = makeCompat('C3', 'PROD-B', null, 'PROD-D', null, 'reduccion');
  const c4 = makeCompat('C4', 'PROD-E', 'PROD-E-P1', 'PROD-A', 'PROD-A-P2', 'directa', 'no compatible');

  it('finds direct compatible product via port-level entry', () => {
    const result = getCompatibleProductIds([c1], 'PROD-A', 'P2');
    expect(result.has('PROD-B')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('excludes result when port does not match a port-level entry', () => {
    const result = getCompatibleProductIds([c1], 'PROD-A', 'P1');
    expect(result.size).toBe(0);
  });

  it('includes product from null-port entry regardless of port name queried', () => {
    const result = getCompatibleProductIds([c2], 'PROD-A', 'P1');
    expect(result.has('PROD-C')).toBe(true);
  });

  it('excludes non-directa connection types', () => {
    const result = getCompatibleProductIds([c3], 'PROD-B', 'P1');
    expect(result.size).toBe(0);
  });

  it('excludes "no compatible" entries', () => {
    const result = getCompatibleProductIds([c4], 'PROD-A', 'P2');
    expect(result.size).toBe(0);
  });

  it('returns ids for both directions (A→B and B→A)', () => {
    const sym = makeCompat('C5', 'PROD-X', null, 'PROD-Y', null);
    const fromX = getCompatibleProductIds([sym], 'PROD-X', 'P1');
    const fromY = getCompatibleProductIds([sym], 'PROD-Y', 'P1');
    expect(fromX.has('PROD-Y')).toBe(true);
    expect(fromY.has('PROD-X')).toBe(true);
  });

  it('returns empty set when no entries match', () => {
    expect(getCompatibleProductIds([c1, c2, c3], 'PROD-Z', 'P1').size).toBe(0);
  });
});
