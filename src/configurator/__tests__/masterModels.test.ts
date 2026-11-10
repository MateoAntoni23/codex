// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { findMasterForProduct, findMasterById, MASTER_MODELS } from '../masterModels';
import { enumerateVariantsForMaster, findMasterAndVariantForProduct } from '../masterVariants';
import type { Product } from '../../tray/model';

function makeProduct(partial: Partial<Product> & { producto_id: string; sku: string }): Product {
  return {
    descripcion_original: '',
    tipo_pieza: 'recta',
    ancho_nominal_mm: 300,
    ...partial,
  } as Product;
}

describe('MASTER_MODELS inventory', () => {
  it('tiene 15 maestros (8 perforada + 7 escalera)', () => {
    // 8 perforada = 6 geometrías medidas + 1 "derivación lateral pendiente"
    // (DCPS) declarada sin STEP + 1 "curva vertical exterior" (CUPS-D-Z) que
    // comparte patrón geométrico con CUPS-A-Z pero se declara aparte para
    // preservar la distinción comercial.
    // 7 escalera = 6 geometrías medidas + 1 "curva vertical articulada" (CUS)
    // que comparte el patrón geométrico CUPS por equivalencia conceptual
    // autorizada por el usuario (2026-11-10). SAMET no publica STEP CUS;
    // provenance='estimated'.
    expect(MASTER_MODELS.length).toBe(15);
    expect(MASTER_MODELS.filter((m) => m.sistema === 'perforada').length).toBe(8);
    expect(MASTER_MODELS.filter((m) => m.sistema === 'escalera').length).toBe(7);
  });

  it('cada maestro declara un id único', () => {
    const ids = MASTER_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('findMasterById devuelve null para id inexistente', () => {
    expect(findMasterById('master:no-existe')).toBeNull();
  });

  it('CUPS queda clasificada como curva_vertical, no derivación', () => {
    const cups = MASTER_MODELS.find((m) => m.id === 'master:perforada:curva_vertical_interior');
    expect(cups).toBeTruthy();
    expect(cups!.pieceKind).toBe('curva_vertical');
  });

  it('cada maestro declara closure en 3 dimensiones (continuity / fidelity / variants)', () => {
    // Taxonomía orthogonal: no se agrupa en un "validado" único. Cada dimensión
    // tiene su propia regresión y limitaciones.
    for (const m of MASTER_MODELS) {
      const dims = [
        ['continuity', m.closure.continuity] as const,
        ['fidelity', m.closure.fidelity] as const,
        ['variants', m.closure.variants] as const,
      ];
      for (const [name, dim] of dims) {
        expect(['validated', 'partial', 'pending', 'n/a'], `${m.id}.${name}`).toContain(dim.status);
        if (dim.status === 'pending' || dim.status === 'n/a') {
          expect(
            dim.regressionSpecs.length,
            `${m.id}.${name}: estado ${dim.status} no debe tener spec`,
          ).toBe(0);
        }
        if (dim.status === 'validated') {
          expect(
            dim.regressionSpecs.length,
            `${m.id}.${name}: 'validated' exige regressionSpec`,
          ).toBeGreaterThan(0);
        }
        if (dim.status === 'partial') {
          expect(
            dim.limitations.length,
            `${m.id}.${name}: 'partial' debe declarar alcance concreto`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it('CUPS declara continuity=partial con el alcance H→V y limitaciones restantes documentadas', () => {
    const cups = MASTER_MODELS.find((m) => m.id === 'master:perforada:curva_vertical_interior')!;
    expect(cups.closure.continuity.status).toBe('partial');
    expect(cups.closure.continuity.limitations.join('\n')).toMatch(/P1_horizontal.*P2_vertical/);
    expect(cups.closure.continuity.limitations.join('\n')).toMatch(/inverso|descendente|dos curvas/);
    // D7 ya migrado: la continuidad referencia cupsSectionUpPersistence (regresión de v_dir persistido).
    expect(cups.closure.continuity.regressionSpecs.join('\n')).toMatch(/cupsSectionUpPersistence/);
    // Fidelidad regresionada (port en chaflán correcta).
    expect(cups.closure.fidelity.status).toBe('validated');
    expect(cups.closure.fidelity.regressionSpecs.join('\n')).toMatch(/portFidelity/);
    // Variantes validadas con depth-only (CUPS-450-A-Z).
    expect(cups.closure.variants.status).toBe('validated');
    expect(cups.closure.variants.regressionSpecs.join('\n')).toMatch(/cupsVariantsClosure/);
  });

  it('DCPS sin STEP queda pending en las 3 dimensiones', () => {
    const dcps = MASTER_MODELS.find((m) => m.id === 'master:perforada:derivacion_pendiente')!;
    expect(dcps.closure.continuity.status).toBe('pending');
    expect(dcps.closure.fidelity.status).toBe('pending');
    expect(dcps.closure.variants.status).toBe('pending');
    expect(dcps.closure.continuity.regressionSpecs).toEqual([]);
  });

  it('maestros escalera con regla "none" marcan variants=n/a (sin extrapolación posible)', () => {
    // RIS: la transición 300→150 es específica del STEP y SAMET no publica
    // regla de extensión a otros anchos — kind='none'. La dimensión no aplica.
    const noVariants = MASTER_MODELS.filter(
      (m) => m.sistema === 'escalera' && m.variationRule.kind === 'none',
    );
    expect(noVariants.length).toBeGreaterThan(0);
    for (const m of noVariants) {
      expect(m.closure.variants.status, `${m.id}: variants debe ser n/a`).toBe('n/a');
    }
  });

  it('maestros escalera no-rectos con regla ala-independent reportan variants=partial', () => {
    // CS-45, CS-90, TS, XS: polígono medido sobre ancho 300 ala 65 + hipótesis
    // visual uniform-xz + ala-independent. Catálogo SAMET publica ancho ∈
    // {150,300,450,600} × ala ∈ {65,90,115,150} — propagación comprobada por
    // regresión pero NO validada vs segundo STEP → status='partial' con
    // limitación explícita. Excluye curva_vertical (CUS): comparte semántica
    // depth-only con CUPS vía recipeKey='escalera:curva_vertical', no
    // uniform-xz — su limitación concreta es "sin STEP articulado".
    const estimados = MASTER_MODELS.filter(
      (m) =>
        m.sistema === 'escalera' &&
        m.pieceKind !== 'tramo_recto' &&
        m.pieceKind !== 'curva_vertical' &&
        m.variationRule.kind === 'ala-independent',
    );
    expect(estimados.length).toBeGreaterThan(0);
    for (const m of estimados) {
      expect(m.variationRule.provenance, `${m.id}: provenance debe ser estimated`).toBe('estimated');
      expect(m.closure.variants.status, `${m.id}: variants debe ser partial`).toBe('partial');
      expect(
        m.closure.variants.limitations.join('\n'),
        `${m.id}: limitación uniform-xz debe explicitarse`,
      ).toMatch(/uniform-xz/);
    }
  });

  it('TPS (tee simétrica) y DCPS (derivación pendiente) son maestros distintos', () => {
    const tps = MASTER_MODELS.find((m) => m.id === 'master:perforada:tee_simetrica');
    const dcps = MASTER_MODELS.find((m) => m.id === 'master:perforada:derivacion_pendiente');
    expect(tps).toBeTruthy();
    expect(dcps).toBeTruthy();
    expect(tps!.pieceKind).toBe('tee_simetrica');
    expect(dcps!.pieceKind).toBe('derivacion_lateral');
    // DCPS carece de STEP medido — declaración explícita pendiente.
    expect(dcps!.source.stepHashShort).toBe('--------');
    expect(dcps!.variationRule.kind).toBe('none');
    // Sin STEP ni polígono: no se puede derivar; la asociación queda como
    // hipótesis explícita → procedencia 'estimated'.
    expect(dcps!.variationRule.provenance).toBe('estimated');
  });
});

describe('findMasterForProduct', () => {
  it('ancla TRPS-300-22-Z al maestro perforada:tramo_recto', () => {
    const p = makeProduct({
      producto_id: 'SAM_TRPS-300-22-Z',
      sku: 'TRPS-300-22-Z',
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'recta',
      ala_nominal_mm: 50,
    });
    const m = findMasterForProduct(p as unknown as Record<string, unknown>);
    expect(m?.id).toBe('master:perforada:tramo_recto');
  });

  it('desambigua CPS por ángulo', () => {
    const base = {
      producto_id: 'SAM_CPS-300-45-Z',
      sku: 'CPS-300-45-Z',
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'curva horizontal',
      ala_nominal_mm: 50,
    };
    const cps45 = findMasterForProduct({ ...base, angulo_grados: 45 });
    const cps90 = findMasterForProduct({ ...base, angulo_grados: 90 });
    expect(cps45?.id).toBe('master:perforada:curva_horizontal_45');
    expect(cps90?.id).toBe('master:perforada:curva_horizontal_90');
  });

  it('TRES SAM-STE-Z ala 65 → master:escalera:tramo_recto', () => {
    const m = findMasterForProduct({
      familia_id: 'SAM-STE-Z',
      tipo_pieza: 'recta',
      ala_nominal_mm: 65,
    });
    expect(m?.id).toBe('master:escalera:tramo_recto');
  });

  it('producto sin familia_id devuelve null', () => {
    const m = findMasterForProduct({ tipo_pieza: 'recta', ala_nominal_mm: 50 });
    expect(m).toBeNull();
  });
});

describe('enumerateVariantsForMaster — TRPS (regla ancho-only-z)', () => {
  const master = findMasterById('master:perforada:tramo_recto')!;
  const productos: Product[] = [
    makeProduct({
      producto_id: 'SAM_TRPS-300-22-Z',
      sku: 'TRPS-300-22-Z',
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 300,
      ala_nominal_mm: 50,
      longitud_comercial_mm: 3000,
    }),
    makeProduct({
      producto_id: 'SAM_TRPS-450-20-Z',
      sku: 'TRPS-450-20-Z',
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 450,
      ala_nominal_mm: 50,
      longitud_comercial_mm: 3000,
    }),
  ];
  const variants = enumerateVariantsForMaster(master, productos);

  it('base ancho=300 queda clasificada como "base" y usa la receta medida', () => {
    const v = variants.find((v) => v.ancho_mm === 300)!;
    expect(v.origin).toBe('base');
    expect(v.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(v.ports.length).toBe(2);
  });

  it('ancho=450 queda clasificada como "declared" y proyecta Z por 450/300=1.5', () => {
    const v = variants.find((v) => v.ancho_mm === 450)!;
    expect(v.origin).toBe('declared');
    expect(v.scale.z).toBeCloseTo(1.5, 3);
    expect(v.scale.x).toBe(1);
    expect(v.scale.y).toBe(1);
    // Puertos proyectados vienen de buildRecipeFor('tramo_recto', ancho=450),
    // que ubica P1/P2 en los extremos +X/-X con ancho 450 en Z.
    expect(v.ports.length).toBe(2);
    const p1 = v.ports.find((p) => p.recipePortName === 'P1')!;
    expect(p1.centerMm).not.toBeNull();
  });
});

describe('enumerateVariantsForMaster — CPS-45 (regla uniform-xz estimada)', () => {
  const master = findMasterById('master:perforada:curva_horizontal_45')!;
  const productos: Product[] = [
    makeProduct({
      producto_id: 'SAM_CPS-450-45-Z',
      sku: 'CPS-450-45-Z',
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'curva horizontal',
      ancho_nominal_mm: 450,
      ala_nominal_mm: 50,
      angulo_grados: 45,
    }),
  ];
  const variants = enumerateVariantsForMaster(master, productos);

  it('CPS-450 queda "declared" (listada en declaredVariantSkus), scale XZ=1.5, con warning de estimación', () => {
    const v = variants[0];
    expect(v.origin).toBe('declared');
    expect(v.scale.x).toBeCloseTo(1.5, 3);
    expect(v.scale.z).toBeCloseTo(1.5, 3);
    // Regla no medida → se agrega warning estimado.
    expect(v.warnings.some((w) => /no medida|estim/i.test(w))).toBe(true);
  });
});

describe('enumerateVariantsForMaster — TRES (regla ala-independent MEDIDA)', () => {
  const master = findMasterById('master:escalera:tramo_recto')!;
  const productos: Product[] = [
    // Mismo ancho+ala → base.
    makeProduct({
      producto_id: 'SAM_TRES-300-065-18-Z',
      sku: 'TRES-300-065-18-Z',
      familia_id: 'SAM-STE-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 300,
      ala_nominal_mm: 65,
      longitud_comercial_mm: 3000,
    }),
    // Ancho distinto → regla ala-independent cubre; además está declared.
    makeProduct({
      producto_id: 'SAM_TRES-450-065-18-Z',
      sku: 'TRES-450-065-18-Z',
      familia_id: 'SAM-STE-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 450,
      ala_nominal_mm: 65,
      longitud_comercial_mm: 3000,
    }),
    // Ala distinta → regla ala-independent cubre también.
    makeProduct({
      producto_id: 'SAM_TRES-300-090-18-Z',
      sku: 'TRES-300-090-18-Z',
      familia_id: 'SAM-STE-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 300,
      ala_nominal_mm: 90,
      longitud_comercial_mm: 3000,
    }),
  ];
  const variants = enumerateVariantsForMaster(master, productos);

  it('ancho=300 ala=65 queda base y proyecta puertos vía outline', () => {
    const v = variants.find((v) => v.sku === 'TRES-300-065-18-Z')!;
    expect(v.origin).toBe('base');
    // Puertos proyectados desde escaleraOutlines (TRES polígono rectangular).
    expect(v.ports.length).toBe(2);
    expect(v.ports[0].centerMm).not.toBeNull();
    expect(v.ports[0].normal).not.toBeNull();
  });

  it('ancho=450 ala=65 queda declared y proyecta Z por 450/300=1.5', () => {
    const v = variants.find((v) => v.sku === 'TRES-450-065-18-Z')!;
    expect(v.origin).toBe('declared');
    expect(v.scale.x).toBe(1);       // longitud no cambia
    expect(v.scale.z).toBeCloseTo(1.5, 3);
    expect(v.scale.y).toBe(1);
    // Puertos proyectados con factorZ=1.5 aplicado al ancho_nominal de la boca.
    expect(v.ports.length).toBe(2);
    const p1 = v.ports[0];
    expect(p1.centerMm).not.toBeNull();
    // La ala centra el puerto en Y=ala/2 (65/2=32.5 — no cambia con ancho).
    expect(p1.centerMm![1]).toBeCloseTo(32.5, 3);
  });

  it('ancho=300 ala=90 queda declared, scale.y=90/65 y centra Y en ala/2=45', () => {
    const v = variants.find((v) => v.sku === 'TRES-300-090-18-Z')!;
    expect(v.origin).toBe('declared');
    expect(v.scale.z).toBe(1);                    // ancho no cambia
    expect(v.scale.y).toBeCloseTo(90 / 65, 3);   // ala-independent escala Y por ala/baseAla
    const p1 = v.ports[0];
    expect(p1.centerMm).not.toBeNull();
    expect(p1.centerMm![1]).toBeCloseTo(45, 3);
  });
});

describe('DCPS producto sin STEP medido → master pendiente', () => {
  it('SAM_DCPS-300-Z resuelve al master derivacion_pendiente, no a tee_simetrica', () => {
    const m = findMasterForProduct({
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'T',
      ala_nominal_mm: 50,
      sku: 'DCPS-300-Z',
      producto_id: 'SAM_DCPS-300-Z',
    });
    expect(m?.id).toBe('master:perforada:derivacion_pendiente');
  });

  it('SAM_TPS-300-Z resuelve al master tee_simetrica (no pendiente)', () => {
    const m = findMasterForProduct({
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'T',
      ala_nominal_mm: 50,
      sku: 'TPS-300-Z',
      producto_id: 'SAM_TPS-300-Z',
    });
    expect(m?.id).toBe('master:perforada:tee_simetrica');
  });

  it('DCPS-450 queda requires-master por regla "none" (sin STEP)', () => {
    const master = findMasterById('master:perforada:derivacion_pendiente')!;
    const productos: Product[] = [
      makeProduct({
        producto_id: 'SAM_DCPS-450-Z',
        sku: 'DCPS-450-Z',
        familia_id: 'SAM-STP-Z',
        tipo_pieza: 'T',
        ancho_nominal_mm: 450,
        ala_nominal_mm: 50,
      }),
    ];
    const variants = enumerateVariantsForMaster(master, productos);
    const v = variants.find((v) => v.sku === 'DCPS-450-Z')!;
    expect(v.origin).toBe('requires-master');
  });
});

describe('findMasterAndVariantForProduct — flujo del inspector', () => {
  const productos: Product[] = [
    makeProduct({
      producto_id: 'SAM_TRPS-450-20-Z',
      sku: 'TRPS-450-20-Z',
      familia_id: 'SAM-STP-Z',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 450,
      ala_nominal_mm: 50,
      longitud_comercial_mm: 3000,
    }),
  ];

  it('un producto 450 resuelve maestro=TRPS y variant.origin=declared', () => {
    const res = findMasterAndVariantForProduct(productos[0], productos);
    expect(res?.master.id).toBe('master:perforada:tramo_recto');
    expect(res?.variant.origin).toBe('declared');
  });

  it('producto sin maestro devuelve null (no hay match familia+tipo+ala)', () => {
    const outlier = makeProduct({
      producto_id: 'SAM_INVENTADO',
      sku: 'INVENTADO',
      familia_id: 'FAMIQ-ALAMBRE-INOX',
      tipo_pieza: 'recta',
      ancho_nominal_mm: 300,
    });
    const res = findMasterAndVariantForProduct(outlier, [outlier]);
    expect(res).toBeNull();
  });
});
