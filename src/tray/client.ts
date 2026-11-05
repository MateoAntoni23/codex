import { GestorSolicitudes } from '../../vendor/motor_bandejas/integracion/ts/gestorSolicitudes';
import type { Solicitud } from '../../vendor/motor_bandejas/integracion/ts/contrato';
import { object, readResult, type Context, type Product, type CatalogPort, type CatalogCompatibility, type CatalogUnionComponent } from './model';
export async function getJson(path:string,init?:RequestInit):Promise<unknown>{
 const response=await fetch(`/api/motor/v1/${path}`,{...init,signal:init?.signal??AbortSignal.timeout(30000)});
 let data:unknown;try{data=await response.json()}catch{throw Error(`HTTP_${response.status}: respuesta no JSON`)}
 if(!response.ok){const e=object(data)&&object(data.error)?data.error:null;throw Error(`HTTP_${response.status} ${e?.codigo??''}: ${e?.mensaje??'Servicio no disponible'} ${e?.campo??''}`)}
 return data;
}
export async function transport(s:Solicitud):Promise<unknown>{
 if(s.version_contrato!=='1.0'||!object(s.entrada)||!Number.isInteger(s.revision_entrada))throw Error('SOLICITUD_INVALIDA');
 const data=await getJson('calcular',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});
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
 return {productos:products as Product[],cables:[...cables].sort(),puertos,compatibilidades,componentesUnion,ejemplos:examples.ejemplos as Context['ejemplos'],versions:JSON.stringify({health,decisiones_sha256:catalog.decisiones_sha256})};
}
export const createManager=()=>new GestorSolicitudes(transport,'cad-tray');
