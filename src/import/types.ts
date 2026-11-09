// Tipos del formato externo ELS-IMP-EQCX v1.0 (ver docs/import/CONTRATO-DE-IMPORTACION-v1.0.md).
// Se mantienen deliberadamente separados del dominio interno v2 (EquipmentElement) porque:
//   - El contrato define 22 categorías de equipo y 15 tipos de componente; el dominio v2
//     cubre 13 categorías orientadas a la escena 3D. Forzarlos a convivir rompería la
//     fidelidad del origen o perdería información (precepto del contrato §1, §13.1).
//   - Los atributos técnicos llegan como filas (clave, valor, unidad, estado, vigente)
//     que deben preservarse incluidas las alternativas en CONFLICTO (A11). No son campos
//     tipados en una tabla fija.
//   - Reimportar no puede sobreescribir en silencio ubicación/orientación/recorrido del
//     proyecto (§9). Separar el catálogo importado del dominio con ubicación facilita
//     mantener esa invariante.
// La vinculación con la escena (ubicar un equipo importado) se resuelve en una capa
// posterior; este módulo sólo describe lo que trae el libro.

export type EstadoAlcance =
  | 'EXISTENTE'
  | 'NUEVO'
  | 'REEMPLAZO'
  | 'REUBICADO'
  | 'MODIFICADO'
  | 'RETIRADO'
  | 'A_DEFINIR';

export type OrigenValor =
  | 'PLACA'
  | 'HOJA_DATOS'
  | 'DECLARADO'
  | 'ESTIMADO'
  | 'CALCULADO';

export type EstadoDato =
  | 'CONFIRMADO'
  | 'A_CONFIRMAR'
  | 'A_RELEVAR'
  | 'CANDIDATO'
  | 'CONFLICTO'
  | 'PENDIENTE';

export type Severidad = 'ERROR' | 'ADVERTENCIA' | 'INFO';

export type ServicioConexion =
  | 'POTENCIA'
  | 'CONTROL'
  | 'INSTRUMENTACION'
  | 'COMUNICACION'
  | 'EQUIPOTENCIALIDAD'
  | 'PUESTA_A_TIERRA'
  | 'NEUMATICA';

export type NaturalezaTendido =
  | 'CABLE_MULTIPOLAR'
  | 'CONDUCTOR_UNIPOLAR'
  | 'CABLE_DATOS'
  | 'TUBO';

export type FuncionTendido =
  | 'FASES'
  | 'NEUTRO'
  | 'PE'
  | '3F+PE'
  | '3F+N+PE'
  | 'F+N+PE'
  | 'SENAL_CONTROL'
  | 'SENAL_INSTRUMENTACION'
  | 'DATOS'
  | 'EQUIPOTENCIAL'
  | 'AIRE_COMPRIMIDO';

export type IncluyePe = 'SI' | 'NO' | 'NO_APLICA' | 'DESCONOCIDO';
export type Apantallado = 'SI' | 'NO' | 'NO_INDICADO';
export type SiNo = 'SI' | 'NO';
export type TipoAlias = 'TAG_ANTERIOR' | 'NOMBRE_EN_ORIGEN' | 'TAG_CIRCUITO' | 'ORDEN_ASOCIADA';
export type TipoDatoAtributo = 'NUMERO' | 'TEXTO';
export type TipoPendiente =
  | 'CONFLICTO_DATO'
  | 'REFERENCIA_NO_RESUELTA'
  | 'REFERENCIA_RESUELTA_CON_EVIDENCIA'
  | 'DATO_FALTANTE'
  | 'AMBIGUEDAD_PE'
  | 'CODIGO_SIN_TRADUCIR'
  | 'CLASIFICACION_DUDOSA'
  | 'INCONSISTENCIA_ORIGEN';
export type EstadoPendiente = 'ABIERTO' | 'RESUELTO';
export type AccionTraza =
  | 'TRASLADADO'
  | 'FUSIONADO'
  | 'CONVERTIDO_ATRIBUTO'
  | 'CONVERTIDO_COMPONENTE'
  | 'CONVERTIDO_ALIAS'
  | 'EXCLUIDO_TITULO'
  | 'EXCLUIDO_SIMBOLICO'
  | 'EXCLUIDO_RETIRADO'
  | 'EXCLUIDO_NO_INSTALA'
  | 'DESCARTADO_AMBIGUO';

/**
 * Metadatos del libro (hoja LEEME + control de archivo).
 */
export interface LibroMeta {
  formatoId: string;         // 'ELS-IMP-EQCX'
  formatoVersion: string;    // 'MAYOR.MENOR'
  libroRevision?: string;
  fechaGeneracion?: string;
  proyecto?: string;
  fuenteArchivo?: string;
  fuenteRevision?: string;
  contrato?: string;
  nombreArchivo: string;     // nombre del .xlsx importado
  fileHash: string;          // SHA-256 del contenido binario — para dedup de reimportación (§9.5)
  importedAt: string;        // ISO date del momento de confirmación
}

export interface EquipoImportado {
  equipoId: string;          // EQ-NNNN
  tag: string;
  categoria: string;         // LISTAS:categoria_equipo (ver contrato §4.1)
  tipoOrigen?: string;
  descripcion: string;
  proyecto: string;          // LISTAS:proyecto
  planta?: string;
  sector?: string;
  subsector?: string;
  ubicacionDescriptiva?: string;
  nivel?: string;
  ubicacionRefPendiente?: string;
  tableroOrigenId?: string;
  contenedorId?: string;
  estadoAlcance: EstadoAlcance;
  estadoAlcanceConfirmado: SiNo;
  fuenteHoja: string;
  fuenteFila?: number;
  observaciones?: string;
}

export interface ComponenteImportado {
  componenteId: string;      // CMP-NNNN
  tag?: string;
  tipoComponente: string;    // LISTAS:tipo_componente
  descripcion: string;
  contenedorEquipoId: string;
  equipoAsociadoId?: string;
  codigoReferencia?: string;
  marca?: string;
  cantidad: number;
  estadoAlcance: EstadoAlcance;
  origenSeleccion: OrigenValor;
  estadoDato: EstadoDato;
  proyecto?: string;
  fuenteHoja: string;
  fuenteFila?: number;
  observaciones?: string;
}

export interface AtributoImportado {
  atributoId: string;        // AT-NNNNN
  equipoId: string;
  componenteId?: string;
  atributo: string;          // CATALOGO_ATRIBUTOS.atributo
  valorNumero?: number;
  valorTexto?: string;
  unidad?: string;
  origenValor: OrigenValor;
  estadoDato: EstadoDato;
  vigente: SiNo;
  fuenteHoja: string;
  fuenteFila?: number;
  fuenteColumna?: string;
  observaciones?: string;
}

export interface ConexionImportada {
  conexionId: string;        // CX-NNNN
  circuitoTag?: string;
  servicio: ServicioConexion;
  grupoOrigen?: string;
  descripcion: string;
  origenEquipoId?: string;
  origenComponenteId?: string;
  origenTextoOriginal: string;
  destinoEquipoId?: string;
  destinoComponenteId?: string;
  destinoTextoOriginal: string;
  sistema?: string;
  tensionV?: number;
  proyecto: string;
  alcanceComercial?: string;
  estadoAlcance: EstadoAlcance;
  refIngCorrienteDisenoA?: number;
  refIngLongitudM?: number;
  refIngLongitudOrigen?: string;
  refIngLongHerramientaV53M?: number;
  observaciones?: string;
}

export interface TendidoImportado {
  tendidoId: string;         // CB-NNN o TUB-NNNN
  conexionId: string;
  naturaleza: NaturalezaTendido;
  funcion: FuncionTendido;
  composicionOrigen?: string;
  cantidadUnidades: number;
  conductoresPorUnidad?: number;
  incluyePe: IncluyePe;
  seccionMm2?: number;
  seccionPeMm2?: number;
  apantallado: Apantallado;
  diametroExteriorMm?: number;
  diametroInteriorMm?: number;
  diametroSinTipificarMm?: number;
  designacion?: string;
  tipoDesignacionCompra?: string;
  marcaModelo?: string;
  estadoAlcance: EstadoAlcance;
  cantidadUnidadesExistentes?: number;
  refIngIzA?: number;
  refIngCaidaTensionPct?: number;
  refIngVerificacion?: string;
  refIngMetrajeCompraM?: number;
  fuenteHoja: string;
  fuenteFila?: number;
  observaciones?: string;
}

export interface AliasImportado {
  aliasId: string;
  alias: string;
  equipoId: string;
  tipoAlias: TipoAlias;
  fuente: string;
}

export interface PendienteImportado {
  pendienteId: string;
  severidad: Severidad;
  tipo: TipoPendiente;
  tabla: string;
  registroId: string;
  campo?: string;
  descripcion: string;
  valorOrigen?: string;
  fuente: string;
  accionSugerida?: string;
  estado: EstadoPendiente;
}

export interface TrazaImportada {
  trazaId: string;
  hojaOrigen: string;
  filaOrigen?: number;
  idOrigen?: string;
  accion: AccionTraza;
  tablaDestino?: string;
  idDestino?: string;
  observacion?: string;
}

export interface CatalogoAtributo {
  atributo: string;
  nombre: string;
  tipoDato: TipoDatoAtributo;
  unidad?: string;
  multivalor: SiNo;
  grupo: string;
  descripcion?: string;
}

/** Catálogo importado completo — unidad de persistencia y de reimportación. */
export interface ImportedCatalog {
  meta: LibroMeta;
  equipos: EquipoImportado[];
  componentes: ComponenteImportado[];
  atributos: AtributoImportado[];
  conexiones: ConexionImportada[];
  tendidos: TendidoImportado[];
  alias: AliasImportado[];
  pendientes: PendienteImportado[];
  trazabilidad: TrazaImportada[];
  catalogoAtributos: CatalogoAtributo[];
  listas: Record<string, string[]>;
}

export interface ValidationIssue {
  code: string;              // V-01..V-26
  severity: Severidad;
  sheet: string;
  recordId?: string;         // ID del registro afectado
  tag?: string;
  column?: string;
  message: string;
}

/** Resultado del parseo+validación; previo a la confirmación del operador. */
export interface ImportResult {
  catalog: ImportedCatalog | null;  // null si V-01/V-02 rechazó el libro
  issues: ValidationIssue[];
  counts: ImportCounts;
}

export interface ImportCounts {
  equipos: number;
  equiposActivos: number;
  equiposRetirados: number;
  componentes: number;
  atributos: number;
  conexiones: number;
  conexionesPorServicio: Record<string, number>;
  tendidos: number;
  tendidosPorNaturaleza: Record<string, number>;
  alias: number;
  pendientes: number;
  pendientesPorSeveridad: Record<Severidad, number>;
}

/**
 * Diff de reimportación (§9.3). "huérfano" = ID en proyecto pero ausente del libro.
 * Nunca se aplica automáticamente; la vista previa lo muestra y el usuario decide.
 */
export interface ReimportDiff {
  sinCambios: number;
  nuevos: Array<{ kind: EntityKind; id: string; tag?: string }>;
  modificados: Array<{ kind: EntityKind; id: string; tag?: string; campos: Array<{ campo: string; antes: unknown; nuevo: unknown }> }>;
  huerfanos: Array<{ kind: EntityKind; id: string; tag?: string }>;
  renombresProbables: Array<{ kind: EntityKind; idNuevo: string; tagNuevo: string; idHuerfano: string }>;
  pasaronARetirado: Array<{ kind: EntityKind; id: string; tag?: string }>;
  mismoHash: boolean;        // el archivo es idéntico a uno ya importado
}

export type EntityKind = 'equipo' | 'componente' | 'atributo' | 'conexion' | 'tendido' | 'alias';
