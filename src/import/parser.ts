import ExcelJS from 'exceljs';
import type {
  ImportResult,
  ValidationIssue,
  ImportedCatalog,
  LibroMeta,
  EquipoImportado,
  ComponenteImportado,
  AtributoImportado,
  ConexionImportada,
  TendidoImportado,
  AliasImportado,
  PendienteImportado,
  TrazaImportada,
  CatalogoAtributo,
  EstadoAlcance,
  OrigenValor,
  EstadoDato,
  SiNo,
  ServicioConexion,
  NaturalezaTendido,
  FuncionTendido,
  IncluyePe,
  Apantallado,
  TipoAlias,
  Severidad,
  TipoPendiente,
  EstadoPendiente,
  AccionTraza,
  TipoDatoAtributo,
  ImportCounts,
} from './types';
import { validateCatalog } from './validator';

const SOPORTE_FORMATO_ID = 'ELS-IMP-EQCX';
const SOPORTE_FORMATO_MAJOR = 1;

const HOJAS_OBLIGATORIAS = [
  'LEEME',
  'EQUIPOS',
  'CONEXIONES',
  'TENDIDOS',
  'LISTAS',
  'CATALOGO_ATRIBUTOS',
] as const;

const COLUMNAS_OBLIGATORIAS: Record<string, string[]> = {
  LEEME: ['clave', 'valor'],
  EQUIPOS: [
    'equipo_id', 'tag', 'categoria', 'descripcion', 'proyecto',
    'estado_alcance', 'estado_alcance_confirmado', 'fuente_hoja',
  ],
  COMPONENTES: [
    'componente_id', 'tipo_componente', 'descripcion', 'contenedor_equipo_id',
    'cantidad', 'estado_alcance', 'origen_seleccion', 'estado_dato', 'fuente_hoja',
  ],
  ATRIBUTOS_TECNICOS: [
    'atributo_id', 'equipo_id', 'atributo', 'origen_valor', 'estado_dato',
    'vigente', 'fuente_hoja',
  ],
  CONEXIONES: [
    'conexion_id', 'servicio', 'descripcion', 'origen_texto_original',
    'destino_texto_original', 'proyecto', 'estado_alcance',
  ],
  TENDIDOS: [
    'tendido_id', 'conexion_id', 'naturaleza', 'funcion', 'cantidad_unidades',
    'incluye_pe', 'apantallado', 'estado_alcance', 'fuente_hoja',
  ],
  ALIAS: ['alias_id', 'alias', 'equipo_id', 'tipo_alias', 'fuente'],
  PENDIENTES: ['pendiente_id', 'severidad', 'tipo', 'tabla', 'registro_id', 'descripcion', 'fuente', 'estado'],
  TRAZABILIDAD: ['traza_id', 'hoja_origen', 'accion'],
  LISTAS: ['lista', 'valor'],
  CATALOGO_ATRIBUTOS: ['atributo', 'nombre', 'tipo_dato', 'multivalor', 'grupo'],
};

/** Normaliza una celda a texto plano, preservando null/undefined para "vacío". */
function cellToText(v: ExcelJS.CellValue | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Formulas, rich text, hyperlinks
  if (typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) {
      // Caller debe detectar que es fórmula y reportar V-26.
      return typeof (v as { result?: unknown }).result === 'string'
        ? (v as { result: string }).result.trim() || undefined
        : undefined;
    }
    if ('text' in v && typeof (v as { text: unknown }).text === 'string') {
      const t = ((v as { text: string }).text).trim();
      return t || undefined;
    }
    if ('richText' in v) {
      const parts = (v as { richText: Array<{ text: string }> }).richText.map((p) => p.text).join('');
      return parts.trim() || undefined;
    }
    if ('hyperlink' in v && typeof (v as { text?: unknown }).text === 'string') {
      return ((v as { text: string }).text).trim() || undefined;
    }
  }
  return undefined;
}

function cellToNumber(v: ExcelJS.CellValue | undefined): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed === '') return undefined;
    const n = Number(trimmed.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v === 'object' && v !== null && 'result' in v) {
    return cellToNumber((v as { result?: ExcelJS.CellValue }).result);
  }
  return undefined;
}

function isFormula(v: ExcelJS.CellValue | undefined): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    ('formula' in v || 'sharedFormula' in v)
  );
}

interface SheetTable {
  name: string;
  headers: string[];
  headerIndex: Record<string, number>;
  rows: Array<{ values: ExcelJS.CellValue[]; rowNumber: number }>;
}

function readSheet(ws: ExcelJS.Worksheet): SheetTable {
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  const headerIndex: Record<string, number> = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const name = cellToText(cell.value);
    if (name) {
      headers.push(name);
      headerIndex[name] = col;
    }
  });
  const rows: SheetTable['rows'] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    // Values from exceljs are 1-indexed; .values[0] is undefined.
    const values = row.values as ExcelJS.CellValue[];
    const allEmpty = values.slice(1).every((v) => cellToText(v) === undefined && cellToNumber(v) === undefined);
    if (allEmpty) return;
    rows.push({ values, rowNumber });
  });
  return { name: ws.name, headers, headerIndex, rows };
}

function field(table: SheetTable, row: SheetTable['rows'][number], col: string): ExcelJS.CellValue | undefined {
  const idx = table.headerIndex[col];
  if (!idx) return undefined;
  return row.values[idx];
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function emptyCounts(): ImportCounts {
  return {
    equipos: 0,
    equiposActivos: 0,
    equiposRetirados: 0,
    componentes: 0,
    atributos: 0,
    conexiones: 0,
    conexionesPorServicio: {},
    tendidos: 0,
    tendidosPorNaturaleza: {},
    alias: 0,
    pendientes: 0,
    pendientesPorSeveridad: { ERROR: 0, ADVERTENCIA: 0, INFO: 0 },
  };
}

function countCatalog(cat: ImportedCatalog, issues: ValidationIssue[]): ImportCounts {
  const c = emptyCounts();
  c.equipos = cat.equipos.length;
  c.equiposActivos = cat.equipos.filter((e) => e.estadoAlcance !== 'RETIRADO').length;
  c.equiposRetirados = cat.equipos.filter((e) => e.estadoAlcance === 'RETIRADO').length;
  c.componentes = cat.componentes.length;
  c.atributos = cat.atributos.length;
  c.conexiones = cat.conexiones.length;
  for (const cx of cat.conexiones) {
    c.conexionesPorServicio[cx.servicio] = (c.conexionesPorServicio[cx.servicio] ?? 0) + 1;
  }
  c.tendidos = cat.tendidos.length;
  for (const t of cat.tendidos) {
    c.tendidosPorNaturaleza[t.naturaleza] = (c.tendidosPorNaturaleza[t.naturaleza] ?? 0) + 1;
  }
  c.alias = cat.alias.length;
  c.pendientes = cat.pendientes.length;
  for (const p of cat.pendientes) {
    c.pendientesPorSeveridad[p.severidad] = (c.pendientesPorSeveridad[p.severidad] ?? 0) + 1;
  }
  // issues no cuentan para equipos/comp — se muestran aparte.
  for (const i of issues) {
    if (i.severity === 'INFO') c.pendientesPorSeveridad.INFO++;
  }
  return c;
}

/**
 * Lee un .xlsx del formato ELS-IMP-EQCX y devuelve el catálogo + los problemas.
 * No muta nada del proyecto. El resultado es puro (determinista salvo por importedAt).
 */
export async function parseWorkbook(data: ArrayBuffer, fileName: string): Promise<ImportResult> {
  const issues: ValidationIssue[] = [];

  // Hash para dedup de reimportación (§9.5). Se calcula antes de parsear para que
  // un archivo corrupto todavía permita detectar "ya lo importaste exactamente así".
  const fileHash = await sha256Hex(data);

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch (err) {
    issues.push({
      code: 'V-01',
      severity: 'ERROR',
      sheet: '(libro)',
      message: `No se pudo leer el archivo como .xlsx: ${(err as Error).message}`,
    });
    return { catalog: null, issues, counts: emptyCounts() };
  }

  const sheets: Record<string, SheetTable> = {};
  for (const ws of wb.worksheets) sheets[ws.name] = readSheet(ws);

  for (const req of HOJAS_OBLIGATORIAS) {
    if (!sheets[req]) {
      issues.push({
        code: 'V-01',
        severity: 'ERROR',
        sheet: '(libro)',
        message: `Falta la hoja ${req}. El archivo no es un libro ELS-IMP-EQCX completo.`,
      });
    }
  }

  // Validar columnas obligatorias y detectar extras.
  for (const [sheetName, cols] of Object.entries(COLUMNAS_OBLIGATORIAS)) {
    const tbl = sheets[sheetName];
    if (!tbl) continue;
    for (const col of cols) {
      if (!tbl.headerIndex[col]) {
        issues.push({
          code: 'V-03',
          severity: 'ERROR',
          sheet: sheetName,
          column: col,
          message: `La hoja ${sheetName} no tiene la columna ${col}.`,
        });
      }
    }
  }

  // Si falta algo crítico, abortamos — no tiene sentido parsear registros con esquema roto.
  if (issues.some((i) => i.severity === 'ERROR' && (i.code === 'V-01' || i.code === 'V-03'))) {
    return { catalog: null, issues, counts: emptyCounts() };
  }

  // LEEME — valida formato_id y formato_version antes de traer nada.
  const leeme = readLeeme(sheets.LEEME, issues);
  if (!leeme) return { catalog: null, issues, counts: emptyCounts() };
  if (leeme.formatoId !== SOPORTE_FORMATO_ID) {
    issues.push({
      code: 'V-02',
      severity: 'ERROR',
      sheet: 'LEEME',
      message: `Formato ${leeme.formatoId} v${leeme.formatoVersion} no compatible con este importador (espera ELS-IMP-EQCX v1.x).`,
    });
    return { catalog: null, issues, counts: emptyCounts() };
  }
  const majorStr = leeme.formatoVersion.split('.')[0];
  const major = parseInt(majorStr, 10);
  if (!Number.isFinite(major) || major !== SOPORTE_FORMATO_MAJOR) {
    issues.push({
      code: 'V-02',
      severity: 'ERROR',
      sheet: 'LEEME',
      message: `Formato ${leeme.formatoId} v${leeme.formatoVersion} no compatible con este importador (espera ELS-IMP-EQCX v1.x).`,
    });
    return { catalog: null, issues, counts: emptyCounts() };
  }

  const meta: LibroMeta = {
    formatoId: leeme.formatoId,
    formatoVersion: leeme.formatoVersion,
    libroRevision: leeme.libroRevision,
    fechaGeneracion: leeme.fechaGeneracion,
    proyecto: leeme.proyecto,
    fuenteArchivo: leeme.fuenteArchivo,
    fuenteRevision: leeme.fuenteRevision,
    contrato: leeme.contrato,
    nombreArchivo: fileName,
    fileHash,
    importedAt: new Date().toISOString(),
  };

  const listas = readListas(sheets.LISTAS);
  const catalogoAtributos = readCatalogoAtributos(sheets.CATALOGO_ATRIBUTOS, issues);

  const equipos = readEquipos(sheets.EQUIPOS, issues);
  const componentes = sheets.COMPONENTES ? readComponentes(sheets.COMPONENTES, issues) : [];
  const atributos = sheets.ATRIBUTOS_TECNICOS ? readAtributos(sheets.ATRIBUTOS_TECNICOS, issues) : [];
  const conexiones = readConexiones(sheets.CONEXIONES, issues);
  const tendidos = readTendidos(sheets.TENDIDOS, issues);
  const alias = sheets.ALIAS ? readAlias(sheets.ALIAS, issues) : [];
  const pendientes = sheets.PENDIENTES ? readPendientes(sheets.PENDIENTES, issues) : [];
  const trazabilidad = sheets.TRAZABILIDAD ? readTrazabilidad(sheets.TRAZABILIDAD, issues) : [];

  const catalog: ImportedCatalog = {
    meta,
    equipos,
    componentes,
    atributos,
    conexiones,
    tendidos,
    alias,
    pendientes,
    trazabilidad,
    catalogoAtributos,
    listas,
  };

  // Validación de reglas entre registros (V-05..V-25).
  validateCatalog(catalog, issues);

  return { catalog, issues, counts: countCatalog(catalog, issues) };
}

function readLeeme(table: SheetTable, issues: ValidationIssue[]): {
  formatoId: string;
  formatoVersion: string;
  libroRevision?: string;
  fechaGeneracion?: string;
  proyecto?: string;
  fuenteArchivo?: string;
  fuenteRevision?: string;
  contrato?: string;
} | null {
  const kv: Record<string, string> = {};
  for (const row of table.rows) {
    if (isFormula(field(table, row, 'clave')) || isFormula(field(table, row, 'valor'))) {
      issues.push({
        code: 'V-26',
        severity: 'ERROR',
        sheet: 'LEEME',
        message: `LEEME fila ${row.rowNumber} contiene una fórmula: se esperan valores.`,
      });
      continue;
    }
    const k = cellToText(field(table, row, 'clave'));
    const v = cellToText(field(table, row, 'valor'));
    if (k && v) kv[k] = v;
  }
  if (!kv.formato_id || !kv.formato_version) {
    issues.push({
      code: 'V-02',
      severity: 'ERROR',
      sheet: 'LEEME',
      message: 'LEEME no declara formato_id o formato_version.',
    });
    return null;
  }
  return {
    formatoId: kv.formato_id,
    formatoVersion: kv.formato_version,
    libroRevision: kv.libro_revision,
    fechaGeneracion: kv.fecha_generacion,
    proyecto: kv.proyecto,
    fuenteArchivo: kv.fuente_archivo,
    fuenteRevision: kv.fuente_revision,
    contrato: kv.contrato,
  };
}

function readListas(table: SheetTable): Record<string, string[]> {
  const listas: Record<string, string[]> = {};
  for (const row of table.rows) {
    const lista = cellToText(field(table, row, 'lista'));
    const valor = cellToText(field(table, row, 'valor'));
    if (lista && valor !== undefined) {
      if (!listas[lista]) listas[lista] = [];
      listas[lista].push(valor);
    }
  }
  return listas;
}

function readCatalogoAtributos(table: SheetTable, issues: ValidationIssue[]): CatalogoAtributo[] {
  const out: CatalogoAtributo[] = [];
  for (const row of table.rows) {
    const atributo = cellToText(field(table, row, 'atributo'));
    const nombre = cellToText(field(table, row, 'nombre'));
    const tipoDato = cellToText(field(table, row, 'tipo_dato')) as TipoDatoAtributo | undefined;
    const multivalor = cellToText(field(table, row, 'multivalor')) as SiNo | undefined;
    const grupo = cellToText(field(table, row, 'grupo'));
    if (!atributo || !nombre || !tipoDato || !multivalor || !grupo) {
      issues.push({
        code: 'V-06',
        severity: 'ERROR',
        sheet: 'CATALOGO_ATRIBUTOS',
        message: `CATALOGO_ATRIBUTOS fila ${row.rowNumber}: faltan columnas obligatorias.`,
      });
      continue;
    }
    out.push({
      atributo,
      nombre,
      tipoDato,
      unidad: cellToText(field(table, row, 'unidad')),
      multivalor,
      grupo,
      descripcion: cellToText(field(table, row, 'descripcion')),
    });
  }
  return out;
}

function readEquipos(table: SheetTable, issues: ValidationIssue[]): EquipoImportado[] {
  const out: EquipoImportado[] = [];
  for (const row of table.rows) {
    const id = cellToText(field(table, row, 'equipo_id'));
    if (!id) {
      issues.push({ code: 'V-05', severity: 'ERROR', sheet: 'EQUIPOS', message: `EQUIPOS fila ${row.rowNumber}: identificador vacío.` });
      continue;
    }
    const tag = cellToText(field(table, row, 'tag')) ?? '';
    const categoria = cellToText(field(table, row, 'categoria')) ?? '';
    const descripcion = cellToText(field(table, row, 'descripcion')) ?? '';
    const proyecto = cellToText(field(table, row, 'proyecto')) ?? '';
    const estadoAlcance = cellToText(field(table, row, 'estado_alcance')) as EstadoAlcance;
    const estadoAlcanceConfirmado = cellToText(field(table, row, 'estado_alcance_confirmado')) as SiNo;
    const fuenteHoja = cellToText(field(table, row, 'fuente_hoja')) ?? '';
    out.push({
      equipoId: id,
      tag,
      categoria,
      tipoOrigen: cellToText(field(table, row, 'tipo_origen')),
      descripcion,
      proyecto,
      planta: cellToText(field(table, row, 'planta')),
      sector: cellToText(field(table, row, 'sector')),
      subsector: cellToText(field(table, row, 'subsector')),
      ubicacionDescriptiva: cellToText(field(table, row, 'ubicacion_descriptiva')),
      nivel: cellToText(field(table, row, 'nivel')),
      ubicacionRefPendiente: cellToText(field(table, row, 'ubicacion_ref_pendiente')),
      tableroOrigenId: cellToText(field(table, row, 'tablero_origen_id')),
      contenedorId: cellToText(field(table, row, 'contenedor_id')),
      estadoAlcance,
      estadoAlcanceConfirmado,
      fuenteHoja,
      fuenteFila: cellToNumber(field(table, row, 'fuente_fila')),
      observaciones: cellToText(field(table, row, 'observaciones')),
    });
  }
  return out;
}

function readComponentes(table: SheetTable, issues: ValidationIssue[]): ComponenteImportado[] {
  const out: ComponenteImportado[] = [];
  for (const row of table.rows) {
    const id = cellToText(field(table, row, 'componente_id'));
    if (!id) {
      issues.push({ code: 'V-05', severity: 'ERROR', sheet: 'COMPONENTES', message: `COMPONENTES fila ${row.rowNumber}: identificador vacío.` });
      continue;
    }
    out.push({
      componenteId: id,
      tag: cellToText(field(table, row, 'tag')),
      tipoComponente: cellToText(field(table, row, 'tipo_componente')) ?? '',
      descripcion: cellToText(field(table, row, 'descripcion')) ?? '',
      contenedorEquipoId: cellToText(field(table, row, 'contenedor_equipo_id')) ?? '',
      equipoAsociadoId: cellToText(field(table, row, 'equipo_asociado_id')),
      codigoReferencia: cellToText(field(table, row, 'codigo_referencia')),
      marca: cellToText(field(table, row, 'marca')),
      cantidad: cellToNumber(field(table, row, 'cantidad')) ?? 1,
      estadoAlcance: cellToText(field(table, row, 'estado_alcance')) as EstadoAlcance,
      origenSeleccion: cellToText(field(table, row, 'origen_seleccion')) as OrigenValor,
      estadoDato: cellToText(field(table, row, 'estado_dato')) as EstadoDato,
      proyecto: cellToText(field(table, row, 'proyecto')),
      fuenteHoja: cellToText(field(table, row, 'fuente_hoja')) ?? '',
      fuenteFila: cellToNumber(field(table, row, 'fuente_fila')),
      observaciones: cellToText(field(table, row, 'observaciones')),
    });
  }
  return out;
}

function readAtributos(table: SheetTable, issues: ValidationIssue[]): AtributoImportado[] {
  const out: AtributoImportado[] = [];
  for (const row of table.rows) {
    const id = cellToText(field(table, row, 'atributo_id'));
    if (!id) {
      issues.push({ code: 'V-05', severity: 'ERROR', sheet: 'ATRIBUTOS_TECNICOS', message: `ATRIBUTOS_TECNICOS fila ${row.rowNumber}: identificador vacío.` });
      continue;
    }
    const valorCrudo = field(table, row, 'valor_numero');
    const valorTextoCrudo = field(table, row, 'valor_texto');
    // Si la celda numérica trae texto, V-08 (lo marca el validator). Aquí leemos lo mejor posible.
    if (valorCrudo !== undefined && valorCrudo !== null) {
      const asNum = cellToNumber(valorCrudo);
      const asTxt = cellToText(valorCrudo);
      if (asNum === undefined && asTxt !== undefined) {
        issues.push({
          code: 'V-08',
          severity: 'ERROR',
          sheet: 'ATRIBUTOS_TECNICOS',
          recordId: id,
          column: 'valor_numero',
          message: `ATRIBUTOS_TECNICOS ${id}: valor_numero debe ser un número (se leyó '${asTxt}').`,
        });
      }
    }
    out.push({
      atributoId: id,
      equipoId: cellToText(field(table, row, 'equipo_id')) ?? '',
      componenteId: cellToText(field(table, row, 'componente_id')),
      atributo: cellToText(field(table, row, 'atributo')) ?? '',
      valorNumero: cellToNumber(valorCrudo),
      valorTexto: cellToText(valorTextoCrudo),
      unidad: cellToText(field(table, row, 'unidad')),
      origenValor: cellToText(field(table, row, 'origen_valor')) as OrigenValor,
      estadoDato: cellToText(field(table, row, 'estado_dato')) as EstadoDato,
      vigente: cellToText(field(table, row, 'vigente')) as SiNo,
      fuenteHoja: cellToText(field(table, row, 'fuente_hoja')) ?? '',
      fuenteFila: cellToNumber(field(table, row, 'fuente_fila')),
      fuenteColumna: cellToText(field(table, row, 'fuente_columna')),
      observaciones: cellToText(field(table, row, 'observaciones')),
    });
  }
  return out;
}

function readConexiones(table: SheetTable, issues: ValidationIssue[]): ConexionImportada[] {
  const out: ConexionImportada[] = [];
  for (const row of table.rows) {
    const id = cellToText(field(table, row, 'conexion_id'));
    if (!id) {
      issues.push({ code: 'V-05', severity: 'ERROR', sheet: 'CONEXIONES', message: `CONEXIONES fila ${row.rowNumber}: identificador vacío.` });
      continue;
    }
    out.push({
      conexionId: id,
      circuitoTag: cellToText(field(table, row, 'circuito_tag')),
      servicio: cellToText(field(table, row, 'servicio')) as ServicioConexion,
      grupoOrigen: cellToText(field(table, row, 'grupo_origen')),
      descripcion: cellToText(field(table, row, 'descripcion')) ?? '',
      origenEquipoId: cellToText(field(table, row, 'origen_equipo_id')),
      origenComponenteId: cellToText(field(table, row, 'origen_componente_id')),
      origenTextoOriginal: cellToText(field(table, row, 'origen_texto_original')) ?? '',
      destinoEquipoId: cellToText(field(table, row, 'destino_equipo_id')),
      destinoComponenteId: cellToText(field(table, row, 'destino_componente_id')),
      destinoTextoOriginal: cellToText(field(table, row, 'destino_texto_original')) ?? '',
      sistema: cellToText(field(table, row, 'sistema')),
      tensionV: cellToNumber(field(table, row, 'tension_v')),
      proyecto: cellToText(field(table, row, 'proyecto')) ?? '',
      alcanceComercial: cellToText(field(table, row, 'alcance_comercial')),
      estadoAlcance: cellToText(field(table, row, 'estado_alcance')) as EstadoAlcance,
      refIngCorrienteDisenoA: cellToNumber(field(table, row, 'ref_ing_corriente_diseno_a')),
      refIngLongitudM: cellToNumber(field(table, row, 'ref_ing_longitud_m')),
      refIngLongitudOrigen: cellToText(field(table, row, 'ref_ing_longitud_origen')),
      refIngLongHerramientaV53M: cellToNumber(field(table, row, 'ref_ing_long_herramienta_v53_m')),
      observaciones: cellToText(field(table, row, 'observaciones')),
    });
  }
  return out;
}

function readTendidos(table: SheetTable, issues: ValidationIssue[]): TendidoImportado[] {
  const out: TendidoImportado[] = [];
  for (const row of table.rows) {
    const id = cellToText(field(table, row, 'tendido_id'));
    if (!id) {
      issues.push({ code: 'V-05', severity: 'ERROR', sheet: 'TENDIDOS', message: `TENDIDOS fila ${row.rowNumber}: identificador vacío.` });
      continue;
    }
    out.push({
      tendidoId: id,
      conexionId: cellToText(field(table, row, 'conexion_id')) ?? '',
      naturaleza: cellToText(field(table, row, 'naturaleza')) as NaturalezaTendido,
      funcion: cellToText(field(table, row, 'funcion')) as FuncionTendido,
      composicionOrigen: cellToText(field(table, row, 'composicion_origen')),
      cantidadUnidades: cellToNumber(field(table, row, 'cantidad_unidades')) ?? 0,
      conductoresPorUnidad: cellToNumber(field(table, row, 'conductores_por_unidad')),
      incluyePe: cellToText(field(table, row, 'incluye_pe')) as IncluyePe,
      seccionMm2: cellToNumber(field(table, row, 'seccion_mm2')),
      seccionPeMm2: cellToNumber(field(table, row, 'seccion_pe_mm2')),
      apantallado: cellToText(field(table, row, 'apantallado')) as Apantallado,
      diametroExteriorMm: cellToNumber(field(table, row, 'diametro_exterior_mm')),
      diametroInteriorMm: cellToNumber(field(table, row, 'diametro_interior_mm')),
      diametroSinTipificarMm: cellToNumber(field(table, row, 'diametro_sin_tipificar_mm')),
      designacion: cellToText(field(table, row, 'designacion')),
      tipoDesignacionCompra: cellToText(field(table, row, 'tipo_designacion_compra')),
      marcaModelo: cellToText(field(table, row, 'marca_modelo')),
      estadoAlcance: cellToText(field(table, row, 'estado_alcance')) as EstadoAlcance,
      cantidadUnidadesExistentes: cellToNumber(field(table, row, 'cantidad_unidades_existentes')),
      refIngIzA: cellToNumber(field(table, row, 'ref_ing_iz_a')),
      refIngCaidaTensionPct: cellToNumber(field(table, row, 'ref_ing_caida_tension_pct')),
      refIngVerificacion: cellToText(field(table, row, 'ref_ing_verificacion')),
      refIngMetrajeCompraM: cellToNumber(field(table, row, 'ref_ing_metraje_compra_m')),
      fuenteHoja: cellToText(field(table, row, 'fuente_hoja')) ?? '',
      fuenteFila: cellToNumber(field(table, row, 'fuente_fila')),
      observaciones: cellToText(field(table, row, 'observaciones')),
    });
  }
  return out;
}

function readAlias(table: SheetTable, issues: ValidationIssue[]): AliasImportado[] {
  const out: AliasImportado[] = [];
  for (const row of table.rows) {
    const id = cellToText(field(table, row, 'alias_id'));
    if (!id) {
      issues.push({ code: 'V-05', severity: 'ERROR', sheet: 'ALIAS', message: `ALIAS fila ${row.rowNumber}: identificador vacío.` });
      continue;
    }
    out.push({
      aliasId: id,
      alias: cellToText(field(table, row, 'alias')) ?? '',
      equipoId: cellToText(field(table, row, 'equipo_id')) ?? '',
      tipoAlias: cellToText(field(table, row, 'tipo_alias')) as TipoAlias,
      fuente: cellToText(field(table, row, 'fuente')) ?? '',
    });
  }
  return out;
}

function readPendientes(table: SheetTable, issues: ValidationIssue[]): PendienteImportado[] {
  const out: PendienteImportado[] = [];
  for (const row of table.rows) {
    const id = cellToText(field(table, row, 'pendiente_id'));
    if (!id) {
      issues.push({ code: 'V-05', severity: 'ERROR', sheet: 'PENDIENTES', message: `PENDIENTES fila ${row.rowNumber}: identificador vacío.` });
      continue;
    }
    out.push({
      pendienteId: id,
      severidad: cellToText(field(table, row, 'severidad')) as Severidad,
      tipo: cellToText(field(table, row, 'tipo')) as TipoPendiente,
      tabla: cellToText(field(table, row, 'tabla')) ?? '',
      registroId: cellToText(field(table, row, 'registro_id')) ?? '',
      campo: cellToText(field(table, row, 'campo')),
      descripcion: cellToText(field(table, row, 'descripcion')) ?? '',
      valorOrigen: cellToText(field(table, row, 'valor_origen')),
      fuente: cellToText(field(table, row, 'fuente')) ?? '',
      accionSugerida: cellToText(field(table, row, 'accion_sugerida')),
      estado: cellToText(field(table, row, 'estado')) as EstadoPendiente,
    });
  }
  return out;
}

function readTrazabilidad(table: SheetTable, issues: ValidationIssue[]): TrazaImportada[] {
  const out: TrazaImportada[] = [];
  for (const row of table.rows) {
    const id = cellToText(field(table, row, 'traza_id'));
    if (!id) {
      issues.push({ code: 'V-05', severity: 'ERROR', sheet: 'TRAZABILIDAD', message: `TRAZABILIDAD fila ${row.rowNumber}: identificador vacío.` });
      continue;
    }
    out.push({
      trazaId: id,
      hojaOrigen: cellToText(field(table, row, 'hoja_origen')) ?? '',
      filaOrigen: cellToNumber(field(table, row, 'fila_origen')),
      idOrigen: cellToText(field(table, row, 'id_origen')),
      accion: cellToText(field(table, row, 'accion')) as AccionTraza,
      tablaDestino: cellToText(field(table, row, 'tabla_destino')),
      idDestino: cellToText(field(table, row, 'id_destino')),
      observacion: cellToText(field(table, row, 'observacion')),
    });
  }
  return out;
}
