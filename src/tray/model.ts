/** Global domain coordinates are millimetres, Z up. No viewer coordinates cross HTTP. */
export type Point = [number, number, number];
export interface TrayPort { posicion_mm: Point; direccion: Point }
export interface Piece { instancia_id: string; producto_id: string; longitud_mm?: number; longitud_eje_mm?: number; puertos: Record<string, TrayPort> }
export interface Circuit { circuito_id: string; funcion: string; cable_id: string; cantidad: number; separado: boolean; recorrido: string[] }
export interface Support { soporte_id: string; instancia_id: string; producto_id: string; sistema_soporte_id: string; distancia_desde_P1_mm: number }
export interface TrayInput extends Record<string, unknown> {
 version_contrato: 'trazado/1'; piezas: Piece[];
 conexiones: {conexion_id:string; a:[string,string]; b:[string,string]}[];
 circuitos: Circuit[]; soportes: Support[];
 pe: { seccion_requerida_mm2:number; cable_id:string; origen_requisito:string; conductores:Record<string,unknown>[] };
}
export interface Product extends Record<string,unknown> {producto_id:string; descripcion_original:string; tipo_pieza:string; ancho_nominal_mm:number|null; sku:string}

export interface CatalogPort {
  puerto_id: string;
  producto_id: string;
  nombre_puerto: string;
  ancho_nominal_mm: number | null;
  ala_nominal_mm: number | null;
  interfaz_conexion: string | null;
}

export interface CatalogCompatibility {
  compatibilidad_id: string;
  producto_a_id: string;
  puerto_a_id: string | null;
  puerto_b_id: string | null;
  producto_b_id: string;
  tipo_conexion: string;
  estado_compatibilidad: string;
  estado_evidencia?: string;
}

export interface CatalogUnionComponent {
  compatibilidad_id: string;
  producto_requerido_id: string;
  cantidad: number;
}

export interface CatalogFamily {
  familia_id: string;
  nombre_familia: string;
  acabado_normalizado: string | null;
  material: string | null;
  fabricante: string | null;
}

export interface Context {
  productos: Product[];
  cables: string[];
  puertos: CatalogPort[];
  compatibilidades: CatalogCompatibility[];
  componentesUnion: CatalogUnionComponent[];
  familias: CatalogFamily[];
  ejemplos: Record<string, Record<string, unknown>>;
  versions: string;
}
export const object = (x:unknown): x is Record<string,unknown> => !!x && typeof x==='object' && !Array.isArray(x);
export function assertInput(raw:unknown): asserts raw is TrayInput {
 if(!object(raw)||raw.version_contrato!=='trazado/1'||!Array.isArray(raw.piezas)||!Array.isArray(raw.conexiones)||!Array.isArray(raw.circuitos)||!Array.isArray(raw.soportes)||!object(raw.pe)) throw Error('ENTRADA_INVALIDA: se requiere trazado/1 con piezas, conexiones, circuitos, soportes y PE');
 const ids=new Set<string>();
 for(const p of raw.piezas){
  if(!object(p)||typeof p.instancia_id!=='string'||!p.instancia_id||ids.has(p.instancia_id)||typeof p.producto_id!=='string'||!object(p.puertos))throw Error('ENTRADA_INVALIDA: pieza/ID/puertos');
  ids.add(p.instancia_id);
  for(const port of Object.values(p.puertos)){
   if(!object(port)||!Array.isArray(port.posicion_mm)||port.posicion_mm.length!==3||!port.posicion_mm.every(x=>typeof x==='number'&&Number.isFinite(x))||!Array.isArray(port.direccion)||port.direccion.length!==3||!port.direccion.every(x=>typeof x==='number'&&Number.isFinite(x))||Math.abs(Math.hypot(...port.direccion as number[])-1)>1e-6)throw Error('ENTRADA_INVALIDA: puertos globales mm y dirección unitaria requeridos');
  }
 }
 // Full engineering validation remains in Python; reject non-finite numbers before JSON serialization.
 const walk=(v:unknown):void=>{if(typeof v==='number'&&!Number.isFinite(v))throw Error('ENTRADA_INVALIDA: número no finito');if(Array.isArray(v))v.forEach(walk);else if(object(v))Object.values(v).forEach(walk)};walk(raw);
}
export function readResult(raw:unknown,kind:'sector'|'trazado'):Record<string,unknown>{
 if(!object(raw)||typeof raw.huella!=='string'||raw.vigencia!=='VIGENTE'||!object(raw.verificacion_electrica)||raw.verificacion_electrica.estado!=='NO_REALIZADA')throw Error('RESPUESTA_INCOMPATIBLE: huella, vigencia o verificación eléctrica');
 const required=kind==='trazado'?['resumen','ocupacion','conexiones','pe','equipotencial','computo','cargas_por_pieza','geometria_piezas','datos','decisiones']:['masa_lineal','disposicion','datos','decisiones'];
 for(const k of required)if(!object(raw[k]))throw Error(`RESPUESTA_INCOMPLETA: ${k}`);
 if(kind==='trazado'&&(!Array.isArray(raw.soportes)||!Array.isArray(raw.corridas)||!object(raw.resumen)||typeof raw.resumen.estado_trazado!=='string'))throw Error('RESPUESTA_INCOMPLETA: soportes/corridas/resumen');
 if(kind==='sector'&&!Array.isArray(raw.candidatos))throw Error('RESPUESTA_INCOMPLETA: candidatos');
 return raw;
}
