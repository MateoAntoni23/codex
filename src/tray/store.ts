import { create } from 'zustand';
import { createManager, loadContext } from './client';
import { assertInput, readResult, type Context, type TrayInput } from './model';
import {
  recipePortToCatalogPort,
  setMasterResolver,
  setProductCatalogIndex,
} from '../workspace/catalogPortMapping';
import { findMasterForProduct } from '../configurator/masterModels';
const manager=createManager();
let callSequence=0;

/** Workspace-only fields that must not be sent to the Python motor (additionalProperties:false). */
const WS_ONLY: ReadonlySet<string> = new Set(['excepciones_conexion']);

/**
 * Strips workspace-only fields from TrayInput before submitting to the motor AND
 * traduce los nombres de bocas de recetas paramétricas al nombre que publica el
 * catálogo SAMET.
 *
 * Por qué: las recetas usan nombres semánticos (`tronco_P1`, `tronco_P2`,
 * `boca_derivacion` en TPS; `P1_x_neg`..`P4_z_pos` en XPS; `P1_horizontal`/
 * `P2_vertical` en CUPS) para que el UI y el inspector sean legibles. El motor
 * Python, en cambio, construye `${producto_id}-${nombre_puerto}` para
 * `IndiceCompat.evaluar(...)` y busca en `cat.puertos_por_id` — que sólo tiene
 * `P1/P2/P3/P4`. Sin esta traducción, cualquier TPS/XPS/CUPS cae en
 * compatibilidad PENDIENTE aunque el catálogo sí la liste.
 *
 * La traducción cubre dos superficies:
 *  - `piezas[*].puertos`: las claves del objeto se renombran de receta → catálogo
 *    para que `piezas[i]["puertos"].get(pa)` dentro de `encaje_conexion` acierte.
 *  - `conexiones[*].a[1]` y `conexiones[*].b[1]`: el segundo elemento de cada
 *    extremo pasa a ser el nombre de catálogo para que la clave compuesta
 *    `${producto_id}-${port_name}` coincida con el índice de compat.
 *
 * Productos sin mapping declarado (TRPS, CPS-45, CPS-90) usan identidad P1/P2
 * y no cambian. Es side-effect free y conserva el `TrayInput` original
 * intacto (copia profunda de las secciones afectadas).
 */
export function toMotorEntrada(trayInput: TrayInput): Record<string,unknown> {
  const out: Record<string,unknown> = {};
  for (const [k,v] of Object.entries(trayInput)) {
    if (!WS_ONLY.has(k)) out[k] = v;
  }
  // Índice instancia_id → producto_id para traducir conexiones sin volver a
  // buscar la pieza en cada extremo.
  const productByInstance = new Map<string, string>();
  for (const pz of trayInput.piezas) productByInstance.set(pz.instancia_id, pz.producto_id);

  out.piezas = trayInput.piezas.map((pz) => {
    const translated: Record<string, unknown> = {};
    for (const [portName, portDef] of Object.entries(pz.puertos)) {
      translated[recipePortToCatalogPort(pz.producto_id, portName)] = portDef;
    }
    return { ...pz, puertos: translated };
  });

  out.conexiones = trayInput.conexiones.map((c) => {
    const prodA = productByInstance.get(c.a[0]) ?? '';
    const prodB = productByInstance.get(c.b[0]) ?? '';
    return {
      ...c,
      a: [c.a[0], recipePortToCatalogPort(prodA, c.a[1])] as [string, string],
      b: [c.b[0], recipePortToCatalogPort(prodB, c.b[1])] as [string, string],
    };
  });

  return out;
}

const MAX_HIST = 20;

interface State {
  context:Context|null; entrada:TrayInput|null; revision:number; selected:string|null; resultSelection:string|null;
  result:Record<string,unknown>|null; status:'sin_calcular'|'calculando'|'vigente'|'desactualizado'|'error'; error:string|null;
  /** Undo stack: past TrayInput states, oldest first. Capped at MAX_HIST. */
  history:TrayInput[];
  /** Redo stack: future TrayInput states, most-recent first. Capped at MAX_HIST. */
  future:TrayInput[];
  initialize:()=>Promise<void>; edit:(input:unknown)=>void;
  /** Replaces tray state on project import — clears history/future so undo never crosses project boundaries. */
  importEdit:(input:unknown)=>void;
  undo:()=>void; redo:()=>void;
  select:(id:string|null)=>void; calculate:()=>Promise<void>;
}
export const useTrayStore=create<State>((set,get)=>({
 context:null,entrada:null,revision:0,selected:null,resultSelection:null,result:null,status:'sin_calcular',error:null,
 history:[],future:[],
 initialize:async()=>{try{const context=await loadContext();const prev=get().context;if(prev&&prev.versions!==context.versions){manager.invalidar('trazado');set({revision:get().revision+1,status:'desactualizado',selected:null,resultSelection:null})}set({context,error:null});setProductCatalogIndex(context.productos);setMasterResolver((p)=>findMasterForProduct(p as Record<string,unknown>));if(!get().entrada)get().edit(context.ejemplos.trazado_derivacion_pe)}catch(e){set({error:String(e),status:get().result?'desactualizado':'error',selected:null});manager.invalidar('trazado');set({revision:get().revision+1})}},
 edit:(input)=>{
  assertInput(input);
  manager.invalidar('trazado');
  const {entrada,history}=get();
  const newHist=entrada?[...history.slice(-(MAX_HIST-1)),entrada]:history;
  set({history:newHist,future:[],entrada:structuredClone(input),revision:get().revision+1,
       status:get().result?'desactualizado':'sin_calcular',resultSelection:null,
       selected:get().selected&&input.piezas.some(p=>p.instancia_id===get().selected)?get().selected:null,error:null});
 },
 importEdit:(input)=>{
  assertInput(input);
  manager.invalidar('trazado');
  set({history:[],future:[],entrada:structuredClone(input),revision:get().revision+1,
       status:'sin_calcular',result:null,resultSelection:null,selected:null,error:null});
 },
 undo:()=>{
  const {entrada,history,future,selected}=get();
  if(!history.length||!entrada)return;
  const prev=history[history.length-1];
  manager.invalidar('trazado');
  set({history:history.slice(0,-1),future:[entrada,...future].slice(0,MAX_HIST),
       entrada:structuredClone(prev),revision:get().revision+1,result:null,status:'sin_calcular',
       resultSelection:null,selected:selected&&prev.piezas.some(p=>p.instancia_id===selected)?selected:null,error:null});
 },
 redo:()=>{
  const {entrada,history,future,selected}=get();
  if(!future.length||!entrada)return;
  const next=future[0];
  manager.invalidar('trazado');
  set({history:[...history.slice(-(MAX_HIST-1)),entrada],future:future.slice(1),
       entrada:structuredClone(next),revision:get().revision+1,result:null,status:'sin_calcular',
       resultSelection:null,selected:selected&&next.piezas.some(p=>p.instancia_id===selected)?selected:null,error:null});
 },
 select:(selected)=>set({selected,resultSelection:get().status==='vigente'?selected:null}),
 calculate:async()=>{
  const call=++callSequence;
  const input=get().entrada;if(!input)return;
  assertInput(input);const revision=get().revision;set({status:'calculando',error:null,resultSelection:null});
  try{
   const context=await loadContext();if(get().revision!==revision||call!==callSequence)return;
   if(get().context&&context.versions!==get().context!.versions){manager.invalidar('trazado');set({context,revision:revision+1,status:'desactualizado',selected:null,resultSelection:null,error:'Versiones cambiaron; recalcular con el nuevo contexto'});return;}
   const outcome=await manager.calcular('trazado','trazado',toMotorEntrada(input));
   if(get().revision!==revision||call!==callSequence)return;
   if(outcome.tipo==='descartada')return;
   if(outcome.tipo==='aplicada'){
    if(outcome.respuesta.estado==='error'){const e=outcome.respuesta.error;set({status:'error',error:`${e.codigo}: ${e.mensaje} ${e.campo??''} ${e.decision_id??''}`});return;}
    set({result:readResult(outcome.respuesta.resultado,'trazado'),status:'vigente',context});
   }else if(outcome.tipo==='rechazada')set({status:'error',error:`${outcome.motivo}: ${outcome.detalle}`});
   else set({status:'error',error:outcome.detalle});
  }catch(e){if(get().revision===revision&&call===callSequence)set({status:'error',error:String(e)})}
 }
}));
