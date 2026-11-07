/**
 * catalog.ts — Catálogo paramétrico STP-Z 300: originales + reconstrucciones + variantes.
 *
 * Fuente: artifacts/parametric/fidelity.json (generado por
 * tools/step_parametric/build_all.py). Los GLB se sirven desde /parametric/*.
 *
 * Esta vista es experimental y NO sustituye la geometría operativa del editor
 * ni las fórmulas Python del motor. Las dimensiones aquí son datos de prueba.
 */

export type Vec3 = readonly [number, number, number];

export interface ParametricPort {
  readonly name: string;
  readonly center: Vec3;
  readonly normal: Vec3;
  readonly ancho_mm: number;
  readonly ala_mm: number;
  readonly u_dir: Vec3;
  readonly v_dir: Vec3;
}

export interface ParametricFidelity {
  readonly span_original_mm: Vec3;
  readonly span_reconstruction_mm: Vec3;
  readonly span_delta_pct: Vec3;
  readonly volume_original_mm3: number;
  readonly volume_reconstruction_mm3: number;
  readonly volume_delta_pct: number;
}

export interface ParametricVariantView {
  readonly label: string;
  readonly sku: string;
  readonly glb_url: string;
  readonly params: Readonly<Record<string, number | string | null>>;
  readonly ports: readonly ParametricPort[];
  readonly notes: readonly string[];
  readonly bbox_span_mm?: Vec3;
}

export interface ParametricEntry {
  readonly recipe: string;
  readonly piece_kind: 'tramo_recto' | 'curva_horizontal' | 'curva_vertical' | 'derivacion_lateral' | 'cruz';
  readonly original_glb_url: string;
  readonly original_bbox_span_mm: Vec3;
  readonly original_volume_mm3: number;
  readonly reconstruction: ParametricVariantView;
  readonly variant: ParametricVariantView;
  readonly fidelity: ParametricFidelity;
}

const P = (
  name: string,
  center: Vec3,
  normal: Vec3,
  ancho_mm: number,
  ala_mm: number,
  u_dir: Vec3,
  v_dir: Vec3,
): ParametricPort => ({ name, center, normal, ancho_mm, ala_mm, u_dir, v_dir });

export const PARAMETRIC_CATALOG: readonly ParametricEntry[] = [
  {
    recipe: 'TRPS-300-22-Z.STEP',
    piece_kind: 'tramo_recto',
    original_glb_url: '/parametric/originals_glb/TRPS-300-22-Z.glb',
    original_bbox_span_mm: [3000, 65, 300],
    original_volume_mm3: 58500000,
    reconstruction: {
      label: 'Reconstrucción paramétrica (ancho=300)',
      sku: 'TRPS-300-22-Z',
      glb_url: '/parametric/reconstructions/TRPS-300-22-Z__recon.glb',
      params: { ancho_mm: 300, ala_mm: 65, longitud_mm: 3000, espesor_mm: 0.71 },
      ports: [
        P('P1', [0, 32.5, -150], [-1, 0, 0], 300, 65, [0, 0, 1], [0, 1, 0]),
        P('P2', [3000, 32.5, -150], [1, 0, 0], 300, 65, [0, 0, 1], [0, 1, 0]),
      ],
      notes: ['Envolvente simplificada compatible con el STEP original (sin perfil Z ni perforaciones).'],
      bbox_span_mm: [3000, 65, 300],
    },
    variant: {
      label: 'Variante ancho=450 (ala, largo y espesor sin cambio)',
      sku: 'TRPS-450-22-Z',
      glb_url: '/parametric/variants/TRPS-450-22-Z__variante.glb',
      params: { ancho_mm: 450, ala_mm: 65, longitud_mm: 3000, espesor_mm: 0.71 },
      ports: [
        P('P1', [0, 32.5, -225], [-1, 0, 0], 450, 65, [0, 0, 1], [0, 1, 0]),
        P('P2', [3000, 32.5, -225], [1, 0, 0], 450, 65, [0, 0, 1], [0, 1, 0]),
      ],
      notes: ['Envolvente simplificada compatible con el STEP original (sin perfil Z ni perforaciones).'],
      bbox_span_mm: [3000, 65, 450],
    },
    fidelity: {
      span_original_mm: [3000, 65, 300],
      span_reconstruction_mm: [3000, 65, 300],
      span_delta_pct: [0, 0, 0],
      volume_original_mm3: 58500000,
      volume_reconstruction_mm3: 58500000,
      volume_delta_pct: 0,
    },
  },
  {
    recipe: 'CPS-300-45-Z.STEP',
    piece_kind: 'curva_horizontal',
    original_glb_url: '/parametric/originals_glb/CPS-300-45-Z.glb',
    original_bbox_span_mm: [345.99, 65, 321.98],
    original_volume_mm3: 4961049.74,
    reconstruction: {
      label: 'Reconstrucción paramétrica (ancho=300, R_in=155.3 mm)',
      sku: 'CPS-300-45-Z',
      glb_url: '/parametric/reconstructions/CPS-300-45-Z__recon.glb',
      params: { ancho_mm: 300, ala_mm: 65, espesor_mm: 0.71, angulo_deg: 45 },
      ports: [
        P('P1', [305.34, 32.5, 0], [1, 0, 0], 300, 65, [0, 0, 1], [0, 1, 0]),
        P('P2', [215.91, 32.5, -215.91], [-0.70711, 0, -0.70711], 300, 65, [0.70711, 0, -0.70711], [0, 1, 0]),
      ],
      notes: [
        'Radio derivado del bbox Z del STEP (R_out = dz / sin ang). R_in=155.34 mm, R_out=455.34 mm.',
        'Envolvente simplificada: perfil rectangular barrido (no refleja perforaciones ni ala real).',
      ],
      bbox_span_mm: [346.23, 66.1, 323.07],
    },
    variant: {
      label: 'Variante ancho=450 — mismo R_out=455.34 (R_in se recalcula a 5.3 mm)',
      sku: 'CPS-450-45-Z',
      glb_url: '/parametric/variants/CPS-450-45-Z__variante.glb',
      params: { ancho_mm: 450, ala_mm: 65, espesor_mm: 0.71, angulo_deg: 45 },
      ports: [
        P('P1', [230.34, 32.5, 0], [1, 0, 0], 450, 65, [0, 0, 1], [0, 1, 0]),
        P('P2', [162.88, 32.5, -162.88], [-0.70711, 0, -0.70711], 450, 65, [0.70711, 0, -0.70711], [0, 1, 0]),
      ],
      notes: [
        'Regla provisional: al variar ancho se mantiene R_out; R_in = R_out - ancho.',
        'Valores paramétricos sin dato oficial del fabricante — revisión técnica obligatoria.',
      ],
    },
    fidelity: {
      span_original_mm: [345.99, 65, 321.98],
      span_reconstruction_mm: [346.23, 66.1, 323.07],
      span_delta_pct: [0.07, 1.69, 0.34],
      volume_original_mm3: 4961049.74,
      volume_reconstruction_mm3: 4676384.66,
      volume_delta_pct: -5.74,
    },
  },
  {
    recipe: 'CPS-300-90-Z.STEP',
    piece_kind: 'curva_horizontal',
    original_glb_url: '/parametric/originals_glb/CPS-300-90-Z.glb',
    original_bbox_span_mm: [744.12, 65, 744.03],
    original_volume_mm3: 19402777.71,
    reconstruction: {
      label: 'Reconstrucción paramétrica (ancho=300, R_in=444.0 mm)',
      sku: 'CPS-300-90-Z',
      glb_url: '/parametric/reconstructions/CPS-300-90-Z__recon.glb',
      params: { ancho_mm: 300, ala_mm: 65, espesor_mm: 0.71, angulo_deg: 90 },
      ports: [
        P('P1', [594.03, 32.5, 0], [1, 0, 0], 300, 65, [0, 0, 1], [0, 1, 0]),
        P('P2', [0, 32.5, -594.03], [-1, 0, 0], 300, 65, [0, 0, -1], [0, 1, 0]),
      ],
      notes: [
        'Radio derivado del bbox Z del STEP (R_out = dz / sin ang). R_in=444.03 mm, R_out=744.03 mm.',
        'Envolvente simplificada: perfil rectangular barrido (no refleja perforaciones ni ala real).',
      ],
      bbox_span_mm: [745.82, 66.79, 745.82],
    },
    variant: {
      label: 'Variante ancho=450 — mismo R_out=744.03 (R_in=294.0 mm)',
      sku: 'CPS-450-90-Z',
      glb_url: '/parametric/variants/CPS-450-90-Z__variante.glb',
      params: { ancho_mm: 450, ala_mm: 65, espesor_mm: 0.71, angulo_deg: 90 },
      ports: [
        P('P1', [519.03, 32.5, 0], [1, 0, 0], 450, 65, [0, 0, 1], [0, 1, 0]),
        P('P2', [0, 32.5, -519.03], [-1, 0, 0], 450, 65, [0, 0, -1], [0, 1, 0]),
      ],
      notes: [
        'Regla provisional: al variar ancho se mantiene R_out; R_in = R_out - ancho.',
        'Valores paramétricos sin dato oficial del fabricante — revisión técnica obligatoria.',
      ],
    },
    fidelity: {
      span_original_mm: [744.12, 65, 744.03],
      span_reconstruction_mm: [745.82, 66.79, 745.82],
      span_delta_pct: [0.23, 2.76, 0.24],
      volume_original_mm3: 19402777.71,
      volume_reconstruction_mm3: 18195479.98,
      volume_delta_pct: -6.22,
    },
  },
  {
    recipe: 'CUPS-300-A-Z.STEP',
    piece_kind: 'curva_vertical',
    original_glb_url: '/parametric/originals_glb/CUPS-300-A-Z.glb',
    original_bbox_span_mm: [54.63, 232.97, 300],
    original_volume_mm3: 2375093.49,
    reconstruction: {
      label: 'Reconstrucción paramétrica (envolvente — SAMET no publica radio)',
      sku: 'CUPS-300-A-Z',
      glb_url: '/parametric/reconstructions/CUPS-300-A-Z__recon.glb',
      params: { ancho_mm: 300, ala_mm: 65, espesor_mm: 0.71, angulo_vertical_deg: 90 },
      ports: [
        P('P1_horizontal', [-27.32, 0, -150], [0, -1, 0], 300, 54.63, [1, 0, 0], [0, 0, -1]),
        P('P2_vertical', [-54.63, 116.49, -150], [-1, 0, 0], 300, 232.97, [0, 0, -1], [0, 1, 0]),
      ],
      notes: [
        'Modo ENVOLVENTE: reproduce bbox del STEP simplificado (54.6 × 233 × 300).',
        'SAMET no publica radio ni ángulo verticales STP-Z: para generar codo curvo paramétrico pasar radio_interior_mm.',
      ],
      bbox_span_mm: [54.63, 232.97, 300],
    },
    variant: {
      label: 'Variante ancho=450 (envolvente — ala y profundidad constantes)',
      sku: 'CUPS-450-A-Z',
      glb_url: '/parametric/variants/CUPS-450-A-Z__variante.glb',
      params: { ancho_mm: 450, ala_mm: 65, espesor_mm: 0.71, angulo_vertical_deg: 90 },
      ports: [
        P('P1_horizontal', [-27.32, 0, -225], [0, -1, 0], 450, 54.63, [1, 0, 0], [0, 0, -1]),
        P('P2_vertical', [-54.63, 116.49, -225], [-1, 0, 0], 450, 232.97, [0, 0, -1], [0, 1, 0]),
      ],
      notes: [
        'Al variar ancho (eje Z local) se mantienen ala y profundidad frontal (65 × 54.6).',
        'Variante de envolvente: sin dato de radio/ángulo vertical del fabricante.',
      ],
    },
    fidelity: {
      span_original_mm: [54.63, 232.97, 300],
      span_reconstruction_mm: [54.63, 232.97, 300],
      span_delta_pct: [0, 0, 0],
      volume_original_mm3: 2375093.49,
      volume_reconstruction_mm3: 3818488.2,
      volume_delta_pct: 60.77,
    },
  },
  {
    recipe: 'DCPS-300-Z.STEP',
    piece_kind: 'derivacion_lateral',
    original_glb_url: '/parametric/originals_glb/DCPS-300-Z.glb',
    original_bbox_span_mm: [449.5, 65, 375.15],
    original_volume_mm3: 10378217.58,
    reconstruction: {
      label: 'Reconstrucción paramétrica (tronco_x=449.5, overhang_z=75.1)',
      sku: 'DCPS-300-Z',
      glb_url: '/parametric/reconstructions/DCPS-300-Z__recon.glb',
      params: { ancho_mm: 300, ala_mm: 65, espesor_mm: 0.71 },
      ports: [
        P('boca_derivacion', [224.75, 32.5, -375.15], [0, 0, -1], 300, 65, [1, 0, 0], [0, 1, 0]),
        P('tronco_P1', [0, 32.5, -37.57], [-1, 0, 0], 75.15, 65, [0, 0, 1], [0, 1, 0]),
        P('tronco_P2', [449.5, 32.5, -37.57], [1, 0, 0], 75.15, 65, [0, 0, 1], [0, 1, 0]),
      ],
      notes: [
        'Envolvente en L: tronco_x=449.5, overhang_z=75.1, ramal ancho×ala=300×65.',
        'SAMET declara solo boca_derivacion como puerto operativo; las dos del tronco son zonas de fijación.',
      ],
      bbox_span_mm: [449.5, 65, 375.15],
    },
    variant: {
      label: 'Variante ancho=450 (ramal 450×65, overhang=75.1 constante)',
      sku: 'DCPS-450-Z',
      glb_url: '/parametric/variants/DCPS-450-Z__variante.glb',
      params: { ancho_mm: 450, ala_mm: 65, espesor_mm: 0.71 },
      ports: [
        P('boca_derivacion', [224.75, 32.5, -525.15], [0, 0, -1], 450, 65, [1, 0, 0], [0, 1, 0]),
        P('tronco_P1', [0, 32.5, -37.57], [-1, 0, 0], 75.15, 65, [0, 0, 1], [0, 1, 0]),
        P('tronco_P2', [449.5, 32.5, -37.57], [1, 0, 0], 75.15, 65, [0, 0, 1], [0, 1, 0]),
      ],
      notes: [
        'tronco_x y overhang_z permanecen constantes al variar ancho; sólo cambia la boca_derivacion.',
        'El fabricante no publica reglas de escalado: variante provisional.',
      ],
    },
    fidelity: {
      span_original_mm: [449.5, 65, 375.15],
      span_reconstruction_mm: [449.5, 65, 375.15],
      span_delta_pct: [0, 0, 0],
      volume_original_mm3: 10378217.58,
      volume_reconstruction_mm3: 8045653.02,
      volume_delta_pct: -22.48,
    },
  },
  {
    recipe: 'XPS-300-Z.STEP',
    piece_kind: 'cruz',
    original_glb_url: '/parametric/originals_glb/XPS-300-Z.glb',
    original_bbox_span_mm: [449.4, 65, 449.4],
    original_volume_mm3: 11964879.34,
    reconstruction: {
      label: 'Reconstrucción paramétrica (cruz simétrica L=449.4 mm)',
      sku: 'XPS-300-Z',
      glb_url: '/parametric/reconstructions/XPS-300-Z__recon.glb',
      params: { ancho_mm: 300, ala_mm: 65, espesor_mm: 0.71 },
      ports: [
        P('P1_x_neg', [0, 32.5, -224.7], [-1, 0, 0], 300, 65, [0, 0, 1], [0, 1, 0]),
        P('P2_x_pos', [449.4, 32.5, -224.7], [1, 0, 0], 300, 65, [0, 0, 1], [0, 1, 0]),
        P('P3_z_neg', [224.7, 32.5, -449.4], [0, 0, -1], 300, 65, [1, 0, 0], [0, 1, 0]),
        P('P4_z_pos', [224.7, 32.5, 0], [0, 0, 1], 300, 65, [1, 0, 0], [0, 1, 0]),
      ],
      notes: ['Cruz simétrica L=449.4 mm, ancho=300 mm, ala=65 mm. Cuatro bocas.'],
      bbox_span_mm: [449.4, 65, 449.4],
    },
    variant: {
      label: 'Variante ancho=450 (L=449.4 constante, bocas pasan a 450×65)',
      sku: 'XPS-450-Z',
      glb_url: '/parametric/variants/XPS-450-Z__variante.glb',
      params: { ancho_mm: 450, ala_mm: 65, espesor_mm: 0.71 },
      ports: [
        P('P1_x_neg', [0, 32.5, -224.7], [-1, 0, 0], 450, 65, [0, 0, 1], [0, 1, 0]),
        P('P2_x_pos', [449.4, 32.5, -224.7], [1, 0, 0], 450, 65, [0, 0, 1], [0, 1, 0]),
        P('P3_z_neg', [224.7, 32.5, -449.4], [0, 0, -1], 450, 65, [1, 0, 0], [0, 1, 0]),
        P('P4_z_pos', [224.7, 32.5, 0], [0, 0, 1], 450, 65, [1, 0, 0], [0, 1, 0]),
      ],
      notes: [
        'L=449.4 mm se mantiene (envolvente XY del STEP); las bocas usan ancho variante.',
      ],
    },
    fidelity: {
      span_original_mm: [449.4, 65, 449.4],
      span_reconstruction_mm: [449.4, 65, 449.4],
      span_delta_pct: [0, 0, 0],
      volume_original_mm3: 11964879.34,
      volume_reconstruction_mm3: 11676487.58,
      volume_delta_pct: -2.41,
    },
  },
];

export type ViewId = 'original' | 'reconstruction' | 'variant';

export function viewLabel(view: ViewId): string {
  switch (view) {
    case 'original':
      return 'STEP original (SAMET)';
    case 'reconstruction':
      return 'Reconstrucción paramétrica (300)';
    case 'variant':
      return 'Variante paramétrica (450)';
  }
}
