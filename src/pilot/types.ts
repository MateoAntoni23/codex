/**
 * types.ts — Contratos TypeScript para pilot-geometry-reconstruction.json (schema_version="4").
 *
 * El JSON es generado por cad-catalog-package/_build_reconstruction.py y valida
 * con _overlay_from_recon.py. Esta UI lo consume como geometría experimental;
 * no se copian coordenadas manualmente en componentes.
 *
 * Unidades: mm. Marco local por pieza: X_local longitudinal, Y_local transversal,
 * Z_local altura. Origen local = centro de P1.
 *
 * Estado:
 *   - "VALIDADO": todas las V1..V6 PASS y procedencia concuerda con mediciones.
 *   - "VALIDADO (bocas y marco); CURVA PROVISIONAL": las bocas y el marco
 *     aprobaron V1..V6, pero el recorrido/arcos de la curva son provisionales.
 */

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Mat3 = readonly [Vec3, Vec3, Vec3];

export interface MarcoLocal {
  readonly origen_dxf: Vec2;
  readonly rotacion_z_rad: number;
  readonly rotacion_z_deg: number;
  readonly R_3x3: Mat3;
  readonly mapping_doc: string;
}

export interface Boca {
  readonly center_dxf: Vec2;
  readonly center_local: Vec3;
  readonly normal_saliente_dxf: Vec2 | Vec3;
  readonly normal_saliente_local: Vec3;
  readonly ancho_medido_mm?: number;
  readonly ancho_outer_outer_mm?: number;
  readonly ancho_nominal_mm?: number;
  readonly nombre_catalogo?: string;
}

export interface Validaciones {
  readonly V1: boolean;
  readonly V2: boolean;
  readonly V3: boolean;
  readonly V4: boolean;
  readonly V5: boolean;
  readonly V6: boolean;
}

export interface EnvelopeDxf {
  readonly xmin: number;
  readonly xmax: number;
  readonly ymin: number;
  readonly ymax: number;
}

export interface BasePieza {
  readonly producto_id: string;
  readonly tipo: 'recto' | 'curva' | 'te' | 'reduccion';
  readonly fuentes_dxf: readonly string[];
  readonly catalogo: Record<string, unknown>;
  readonly mediciones_fuente: Record<string, unknown>;
  readonly marco_local: MarcoLocal;
  readonly envelope_dxf: EnvelopeDxf;
  readonly validaciones: Validaciones;
  readonly estado: string;
}

export interface PiezaRecto extends BasePieza {
  readonly tipo: 'recto';
  readonly bocas: { readonly P1: Boca; readonly P2: Boca };
  readonly recorrido_central_local: readonly Vec3[];
  readonly normalizacion_geometrica: {
    readonly desplazamiento_lateral_mm: number;
    readonly tolerancia_plegado_mm: number;
    readonly nota: string;
  };
  readonly cotas_derivadas_local: {
    readonly P1_a_P2_recta_local_mm: number;
    readonly P1_a_P2_axial_X_local_mm: number;
    readonly lateral_offset_Y_local_mm: number;
  };
  readonly catalogo: {
    readonly ancho_nominal_mm: number;
    readonly altura_nominal_mm: number;
    readonly longitud_comercial_mm: number;
    readonly longitud_fuente: string;
  };
}

export interface PiezaReduccion extends BasePieza {
  readonly tipo: 'reduccion';
  readonly bocas: { readonly P1: Boca; readonly P2: Boca };
  readonly recorrido_central_local: readonly Vec3[];
  readonly cotas_derivadas_local: {
    readonly P1_a_P2_recta_local_mm: number;
    readonly P1_a_P2_axial_X_local_mm: number;
    readonly lateral_offset_Y_local_mm: number;
    readonly transicion_ancho_mm: number;
  };
  readonly catalogo: {
    readonly ancho_mayor_nominal_mm: number;
    readonly ancho_menor_nominal_mm: number;
    readonly altura_nominal_mm: number;
  };
}

export interface PiezaTe extends BasePieza {
  readonly tipo: 'te';
  readonly bocas: { readonly P1: Boca; readonly P2: Boca; readonly P3: Boca };
  readonly cruce_local: Vec3;
  readonly recorrido_central_local: {
    readonly tronco: readonly Vec3[];
    readonly ramal: readonly Vec3[];
  };
  readonly cotas_derivadas_local: {
    readonly envolvente_dx_mm: number;
    readonly envolvente_dy_mm: number;
    readonly cruce_a_P1_mm: number;
    readonly cruce_a_P2_mm: number;
    readonly cruce_a_P3_mm: number;
    readonly P1_a_P2_tronco_mm: number;
    readonly asimetria_tronco_mm: number;
  };
  readonly catalogo: {
    readonly ancho_nominal_mm: number;
    readonly altura_nominal_mm: number;
  };
}

export interface ContornoFacetadoEvidencia {
  readonly n_segmentos: number;
  readonly segmentos_muestra_primeras_5: ReadonlyArray<readonly [Vec2, Vec2]>;
  readonly nota: string;
}

export interface CurvaProvisional {
  readonly estado: string;
  readonly nota: string;
  readonly parametros_configurables: {
    readonly centro_outer_dxf: Vec2;
    readonly radio_outer_mm: number;
    readonly centro_inner_dxf: Vec2;
    readonly radio_inner_mm: number;
  };
  readonly residuo_vs_contorno_facetado: {
    readonly metodo: string;
    readonly outer_tight_5mm: {
      readonly n_points: number;
      readonly mean_mm: number;
      readonly max_mm: number;
    };
    readonly outer_loose_20mm: {
      readonly n_points: number;
      readonly mean_mm: number;
      readonly max_mm: number;
    };
    readonly inner_tight_5mm: {
      readonly n_points: number;
      readonly mean_mm: number;
      readonly max_mm: number;
    };
    readonly inner_loose_20mm: {
      readonly n_points: number;
      readonly mean_mm: number;
      readonly max_mm: number;
    };
  };
  readonly advertencia: string;
}

export interface PiezaCurva extends BasePieza {
  readonly tipo: 'curva';
  readonly bocas: { readonly P1: Boca; readonly P2: Boca };
  readonly contorno_facetado_dxf_evidencia: ContornoFacetadoEvidencia;
  readonly geometria_curva_provisional: CurvaProvisional;
  readonly recorrido_central_local: {
    readonly estado: string;
    readonly puntos: readonly Vec3[];
    readonly kink_local: Vec3;
  };
  readonly cotas_derivadas_local: {
    readonly ancho_boca_outer_outer_P1_mm: number;
    readonly ancho_boca_outer_outer_P2_mm: number;
    readonly distancia_entre_centros_P1_P2_local_mm: number;
    readonly inclinacion_P1_vs_perpendicular_eje_deg: number;
    readonly inclinacion_P2_vs_perpendicular_eje_deg: number;
  };
  readonly catalogo: {
    readonly ancho_nominal_mm: number;
    readonly altura_nominal_mm: number;
    readonly radio_declarado_mm: number;
    readonly referencia_radio_declarada: string;
    readonly angulo_declarado_deg: number;
  };
}

export type Pieza = PiezaRecto | PiezaReduccion | PiezaTe | PiezaCurva;
export type PiezaId = 'recto' | 'curva_90' | 'te' | 'reduccion';

export interface PilotReconstruction {
  readonly schema_version: '4';
  readonly generado_por: string;
  readonly entradas: Record<string, string>;
  readonly convenciones: Record<string, string>;
  readonly piezas: {
    readonly recto: PiezaRecto;
    readonly curva_90: PiezaCurva;
    readonly te: PiezaTe;
    readonly reduccion: PiezaReduccion;
  };
  readonly validaciones_resumen: Record<PiezaId, Validaciones>;
}

/** Procedencia de la geometría dibujada por el visor. */
export type Procedencia = 'medido' | 'nominal_instalacion' | 'provisional';
