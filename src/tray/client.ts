import { GestorSolicitudes } from '../../vendor/motor_bandejas/integracion/ts/gestorSolicitudes';
import type { Solicitud } from '../../vendor/motor_bandejas/integracion/ts/contrato';
import { catalogFingerprint } from '../catalog/staticCatalog';
import { object, readResult, type Context, type Product, type CatalogPort, type CatalogCompatibility, type CatalogUnionComponent, type CatalogFamily } from './model';
export async function getJson(path:string,init?:RequestInit):Promise<unknown>{
 const response=await fetch(`/api/motor/v1/${path}`,{...init,signal:init?.signal??AbortSignal.timeout(30000)});
 let data:unknown;try{data=await response.json()}catch{throw Error(`HTTP_${response.status}: respuesta no JSON`)}
 if(!response.ok){const e=object(data)&&object(data.error)?data.error:null;throw Error(`HTTP_${response.status} ${e?.codigo??''}: ${e?.mensaje??'Servicio no disponible'} ${e?.campo??''}`)}
 return data;
}
/**
 * Serializa una Solicitud para el motor, eliminando claves que el contrato
 * `trazado/1` no acepta en puertos (p. ej. `orientacion_seccion_ws`, agregada
 * por el frontend para D7 y NO reconocida por `trazado_entrada.py`). El motor
 * rechaza con `claves desconocidas` cualquier campo fuera de `{posicion_mm,
 * direccion}`; por eso traducimos aquí en lugar de en el modelo.
 */
function stripMotorUnknownFields(s:Solicitud):Solicitud{
 const entrada=s.entrada as Record<string,unknown>;
 if(!Array.isArray(entrada.piezas))return s;
 const piezas=(entrada.piezas as Array<Record<string,unknown>>).map(p=>{
  const puertos=p.puertos as Record<string,Record<string,unknown>>|undefined;
  if(!puertos)return p;
  const cleanPuertos:Record<string,Record<string,unknown>>={};
  for(const [name,port] of Object.entries(puertos)){
   const {orientacion_seccion_ws:_omit,...rest}=port;
   void _omit;
   cleanPuertos[name]=rest;
  }
  return {...p,puertos:cleanPuertos};
 });
 return {...s,entrada:{...entrada,piezas}};
}

export async function transport(s:Solicitud):Promise<unknown>{
 if(s.version_contrato!=='1.0'||!object(s.entrada)||!Number.isInteger(s.revision_entrada))throw Error('SOLICITUD_INVALIDA');
 const serializable=stripMotorUnknownFields(s);
 const data=await getJson('calcular',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(serializable)});
 if(object(data)&&data.estado==='ok'){
  if(data.version_motor!=='0.2.2')throw Error('VERSION_MOTOR_INCOMPATIBLE');
  readResult(data.resultado,s.tipo);
 }
 return data;
}
export async function loadContext():Promise<Context>{
 const [health,catalog,examples]=await Promise.all([getJson('salud'),getJson('catalogos'),getJson('ejemplos')]);
 if(!object(health)||health.version_motor!=='0.2.2'||health.version_contrato!=='1.0'||!object(catalog)||catalog.version_api!=='cad/1'||!object(catalog.catalogo)||!Array.isArray(catalog.catalogo.PRODUCTOS)||!Array.isArray(catalog.datasets_cables)||!object(examples)||examples.version_api!=='cad/1'||!object(examples.ejemplos))throw Error('CONTEXTO_INCOMPATIBLE');
 const cables=new Set<string>();
 if(!Array.isArray(catalog.cable_ids)||!catalog.cable_ids.every(x=>typeof x==='string'))throw Error('CATALOGO_CABLES_INVALIDO');
 for(const id of catalog.cable_ids)cables.add(id as string);
 const walk=(v:unknown)=>{if(Array.isArray(v))v.forEach(walk);else if(object(v)){if(typeof v.cable_id==='string')cables.add(v.cable_id);Object.values(v).forEach(walk)}};walk(catalog.datasets_cables);
 const products=catalog.catalogo.PRODUCTOS;
 if(products.some(p=>!object(p)||typeof p.producto_id!=='string'||typeof p.tipo_pieza!=='string'))throw Error('CATALOGO_INVALIDO');
 const rawCat = catalog.catalogo as Record<string, unknown>;
 const puertos: CatalogPort[] = Array.isArray(rawCat.PUERTOS_PRODUCTO)
   ? (rawCat.PUERTOS_PRODUCTO as unknown[]).filter(
       (p): p is CatalogPort =>
         !!p && typeof (p as CatalogPort).puerto_id === 'string'
     )
   : [];
 const compatibilidades: CatalogCompatibility[] = Array.isArray(rawCat.COMPATIBILIDADES)
   ? (rawCat.COMPATIBILIDADES as unknown[]).filter(
       (c): c is CatalogCompatibility =>
         !!c && typeof (c as CatalogCompatibility).compatibilidad_id === 'string'
     )
   : [];
 const componentesUnion: CatalogUnionComponent[] = Array.isArray(rawCat.COMPONENTES_UNION)
   ? (rawCat.COMPONENTES_UNION as unknown[]).filter(
       (u): u is CatalogUnionComponent =>
         !!u && typeof (u as CatalogUnionComponent).compatibilidad_id === 'string'
     )
   : [];
 const familias: CatalogFamily[] = Array.isArray(rawCat.FAMILIAS)
   ? (rawCat.FAMILIAS as unknown[]).filter(
       (f): f is CatalogFamily =>
         !!f && typeof (f as CatalogFamily).familia_id === 'string'
     )
   : [];
 return {productos:products as Product[],cables:[...cables].sort(),puertos,compatibilidades,componentesUnion,familias,ejemplos:examples.ejemplos as Context['ejemplos'],versions:JSON.stringify({health,decisiones_sha256:catalog.decisiones_sha256})};
}
/** Estado de salud del motor (`GET /v1/salud`). Lanza si el motor no responde. */
export async function fetchEngineHealth():Promise<unknown>{return getJson('salud')}
/**
 * Identidad del catálogo que sirve el motor: SHA-256 de decisiones_producto.json y
 * huella estructural del catálogo + cables (misma función que el catálogo
 * empaquetado). Se compara contra `loadStaticCatalog()` antes de calcular.
 */
export async function fetchEngineCatalogIdentity():Promise<{decisionesSha256:string;fingerprint:string}>{
 const catalog=await getJson('catalogos');
 if(!object(catalog)||catalog.version_api!=='cad/1'||!object(catalog.catalogo)||!Array.isArray(catalog.cable_ids)||!catalog.cable_ids.every(x=>typeof x==='string')||typeof catalog.decisiones_sha256!=='string')throw Error('CONTEXTO_INCOMPATIBLE');
 return {decisionesSha256:catalog.decisiones_sha256,fingerprint:catalogFingerprint(catalog.catalogo,catalog.cable_ids as string[])};
}
export const createManager=()=>new GestorSolicitudes(transport,'cad-tray');
