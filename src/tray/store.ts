import { create } from 'zustand';
import { createManager, fetchEngineCatalogIdentity, fetchEngineHealth } from './client';
import { assertInput, object, readResult, type Context, type TrayInput } from './model';
import { recipePortToCatalogPort } from '../workspace/catalogPortMapping';
import { loadStaticCatalog, seedStaticCatalog, staticContext } from '../catalog/staticCatalog';
import { emptyTrayInput, isNeutralPe } from '../project/emptyProject';
import { placedOf } from '../workspace/placement/definitions';
import { puertosFromWorld, worldPorts } from '../workspace/placement/placementCore';
import { circuitosParaMotor, peDelTrazado } from '../workspace/motor/paraMotor';
import type { EquipmentElement } from '../types/domain-v2';
const manager=createManager();
let callSequence=0;

/** Workspace-only fields that must not be sent to the Python motor (additionalProperties:false). */
const WS_ONLY: ReadonlySet<string> = new Set(['excepciones_conexion', 'definiciones_ws', 'uniones_ws', 'circuitos_ws', 'enganches_ws', 'bajadas_ws', 'bandas_ws']);

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
export function toMotorEntrada(
  trayInput: TrayInput,
  opts: { elements?: readonly EquipmentElement[]; idsCables?: readonly string[] } = {},
): Record<string,unknown> {
  const out: Record<string,unknown> = {};
  for (const [k,v] of Object.entries(trayInput)) {
    if (!WS_ONLY.has(k)) out[k] = v;
  }
  // Etapa 3: los circuitos guardados de potencia (vigentes, con cable) viajan al motor junto
  // con los del trazado; maniobra e instrumentación no (D-11). Ver `workspace/motor/paraMotor.ts`.
  out.circuitos = [...trayInput.circuitos, ...circuitosParaMotor(trayInput, opts.elements ?? [], opts.idsCables).enviados];
  // `pe` neutro (proyecto sin PE definido, ver emptyProject.ts): NUNCA se envía tal cual
  // (el motor falla con "Cable desconocido: ''"). Etapa 3: con piezas, se envía el PE del
  // trazado (D-20 16 mm², D-21 verde/amarillo, recorrido por todas las piezas) y sus puntos
  // equipotenciales; sin piezas, se omite. Un `pe` propio (no neutro) se respeta.
  if (isNeutralPe(trayInput.pe)) {
    const gen = peDelTrazado(trayInput);
    if (gen) {
      out.pe = gen.pe;
      const eq = trayInput.equipotencial as { puntos?: unknown[] } | undefined;
      if (!eq?.puntos?.length) out.equipotencial = gen.equipotencial;
    } else delete out.pe;
  }
  // Índice instancia_id → producto_id para traducir conexiones sin volver a
  // buscar la pieza en cada extremo.
  const productByInstance = new Map<string, string>();
  for (const pz of trayInput.piezas) productByInstance.set(pz.instancia_id, pz.producto_id);

  // Bocas sin calibración: `calculate()` no llega aquí (las reporta antes con
  // `findUncalibratedPorts`). Si un llamador directo pide el payload igual, la boca
  // conserva su nombre de receta y el motor la verá como desconocida: nunca se
  // presenta como traducida.
  const tr = (prod: string, port: string) => recipePortToCatalogPort(prod, port) ?? port;
  // A-11: el motor sigue recibiendo trazado/1. Las bocas P1..Pn se generan desde la
  // pose guardada (definición + mano + pose) y `colocacion` no viaja.
  out.piezas = trayInput.piezas.map((pz) => {
    const placed = placedOf(trayInput, pz);
    const source = placed
      ? puertosFromWorld(worldPorts(placed.def, placed.colocacion.mano, placed.colocacion.pose))
      : pz.puertos;
    const translated: Record<string, unknown> = {};
    for (const [portName, portDef] of Object.entries(source)) {
      translated[tr(pz.producto_id, portName)] = portDef;
    }
    const { colocacion: _c, ...rest } = pz;
    void _c;
    return { ...rest, puertos: translated };
  });

  out.conexiones = trayInput.conexiones.map((c) => {
    const prodA = productByInstance.get(c.a[0]) ?? '';
    const prodB = productByInstance.get(c.b[0]) ?? '';
    return {
      ...c,
      a: [c.a[0], tr(prodA, c.a[1])] as [string, string],
      b: [c.b[0], tr(prodB, c.b[1])] as [string, string],
    };
  });

  return out;
}

/**
 * Bocas del trazado sin correspondencia con el catálogo ("sin calibración de
 * bocas"), agrupadas por producto. Vacío si todo está resuelto.
 */
export function findUncalibratedPorts(trayInput: TrayInput): Array<{ producto_id: string; bocas: string[] }> {
  const byProduct = new Map<string, Set<string>>();
  for (const pz of trayInput.piezas) {
    for (const portName of Object.keys(pz.puertos)) {
      if (recipePortToCatalogPort(pz.producto_id, portName) === null) {
        (byProduct.get(pz.producto_id) ?? byProduct.set(pz.producto_id, new Set()).get(pz.producto_id)!).add(portName);
      }
    }
  }
  return [...byProduct].map(([producto_id, bocas]) => ({ producto_id, bocas: [...bocas].sort() }));
}

const MAX_HIST = 20;

/**
 * Estado del motor Python. El catálogo ya no depende de él (es estático, ver
 * `catalog/staticCatalog.ts`): el motor sólo hace falta para calcular.
 *  - desconocido: aún no se consultó.
 *  - conectado: responde, versiones soportadas y catálogo idéntico al empaquetado.
 *  - apagado: no responde (se puede diseñar y guardar igualmente).
 *  - incompatible: responde, pero versión o catálogo no coinciden → NO se calcula.
 */
export type EngineState='desconocido'|'conectado'|'apagado'|'incompatible';
export interface EngineInfo{state:EngineState;detail:string|null}
const ENGINE_OFF_DETAIL='Motor Python apagado o inaccesible: se puede diseñar y guardar; el cálculo requiere el motor.';
let verifiedHealthKey:string|null=null;

interface State {
  engine:EngineInfo;
  /** Consulta la salud del motor y verifica que su catálogo coincide con el empaquetado. */
  checkEngine:(force?:boolean)=>Promise<void>;
  context:Context|null; entrada:TrayInput|null; revision:number; selected:string|null; resultSelection:string|null;
  result:Record<string,unknown>|null; status:'sin_calcular'|'calculando'|'vigente'|'desactualizado'|'error'; error:string|null;
  /** Undo stack: past TrayInput states, oldest first. Capped at MAX_HIST. */
  history:TrayInput[];
  /** Redo stack: future TrayInput states, most-recent first. Capped at MAX_HIST. */
  future:TrayInput[];
  initialize:()=>Promise<void>; edit:(input:unknown)=>void;
  /** Replaces tray state on project import — clears history/future so undo never crosses project boundaries. */
  importEdit:(input:unknown)=>void;
  /**
   * Replaces `entrada` sin tocar history/future. Pensado para drags de UI:
   * el componente guarda un snapshot propio al iniciar el arrastre y emite
   * ráfagas de setEntradaRaw durante el drag; al soltar, decide si:
   *  (a) descartar (restaura con otro setEntradaRaw), o
   *  (b) confirmar (restaura temporal y luego `edit(final)` para que history
   *      quede con UNA sola entrada que abarca move + eventual desconexión).
   * Why: distinguir "agitar la vista" de "cambios atómicos en history".
   */
  setEntradaRaw:(input:unknown)=>void;
  undo:()=>void; redo:()=>void;
  select:(id:string|null)=>void; calculate:()=>Promise<void>;
}
export const useTrayStore=create<State>((set,get)=>({
 engine:{state:'desconocido',detail:null},
 context:null,entrada:emptyTrayInput(),revision:0,selected:null,resultSelection:null,result:null,status:'sin_calcular',error:null,
 history:[],future:[],
 initialize:async()=>{
  // 1) Catálogo estático (no depende del motor): índice de productos + resolvedor de maestros.
  try{const ctx=staticContext(await seedStaticCatalog());if(get().context?.versions!==ctx.versions)set({context:ctx})}
  catch(e){set({error:`CATALOGO_ESTATICO: ${String(e)}`})}
  // 2) Estado del motor (sólo informativo hasta que se pide calcular).
  await get().checkEngine();
 },
 checkEngine:async(force=false)=>{
  const mark=(engine:EngineInfo)=>{
   const wasVerified=verifiedHealthKey!==null;
   if(engine.state!=='conectado'){
    if(wasVerified){manager.invalidar('trazado');set({revision:get().revision+1,status:get().result?'desactualizado':get().status,selected:null,resultSelection:null})}
    verifiedHealthKey=null;
   }
   set({engine});
  };
  let health:unknown;
  try{health=await fetchEngineHealth()}catch{mark({state:'apagado',detail:ENGINE_OFF_DETAIL});return}
  if(!object(health)||health.version_motor!=='0.2.2'||health.version_contrato!=='1.0'){mark({state:'incompatible',detail:'Versión del motor no soportada por este frontend: no se calcula.'});return}
  const key=JSON.stringify(health);
  if(!force&&key===verifiedHealthKey&&get().engine.state==='conectado')return;
  try{
   const [identity,packaged]=await Promise.all([fetchEngineCatalogIdentity(),loadStaticCatalog()]);
   if(identity.decisionesSha256!==packaged.decisionesSha256||identity.fingerprint!==packaged.fingerprint){mark({state:'incompatible',detail:'El catálogo del motor conectado no coincide con el empaquetado en la aplicación: no se calcula.'});return}
  }catch(e){
   const m=String(e);
   mark(m.includes('CONTEXTO_INCOMPATIBLE')?{state:'incompatible',detail:'El motor devolvió un catálogo con formato no soportado: no se calcula.'}:{state:'apagado',detail:ENGINE_OFF_DETAIL});
   return;
  }
  const changed=verifiedHealthKey!==null&&verifiedHealthKey!==key;
  verifiedHealthKey=key;
  if(changed){manager.invalidar('trazado');set({revision:get().revision+1,status:get().result?'desactualizado':get().status,selected:null,resultSelection:null})}
  set({engine:{state:'conectado',detail:null}});
 },
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
 setEntradaRaw:(input)=>{
  assertInput(input);
  manager.invalidar('trazado');
  set({entrada:structuredClone(input),revision:get().revision+1,
       status:get().result?'desactualizado':'sin_calcular',resultSelection:null,error:null});
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
  assertInput(input);
  if(input.piezas.length===0){set({error:'No hay piezas para calcular.'});return}
  const uncal=findUncalibratedPorts(input);
  if(uncal.length){set({status:'error',error:`Sin calibración de bocas: ${uncal.map(u=>`${get().context?.productos.find(p=>p.producto_id===u.producto_id)?.sku??u.producto_id} (${u.bocas.join(', ')})`).join('; ')}. Modelo no resuelto: no se calcula.`});return}
  const revision=get().revision;set({status:'calculando',error:null,resultSelection:null});
  try{
   await get().checkEngine(true);if(get().revision!==revision||call!==callSequence)return;
   const engine=get().engine;
   if(engine.state!=='conectado'){set({status:'error',error:engine.detail??'Motor no disponible'});return}
   // Equipos (para la vigencia de los circuitos guardados) y cables del catálogo; import dinámico: evita el ciclo de módulos.
   const {useWorkspaceStore}=await import('../workspace/useWorkspaceStore');
   const cat=get().context?.catalogoCables;
   const outcome=await manager.calcular('trazado','trazado',toMotorEntrada(input,{elements:useWorkspaceStore.getState().elements,idsCables:cat?.ok?cat.cables.map(c=>c.cable_id):undefined}));
   if(get().revision!==revision||call!==callSequence)return;
   if(outcome.tipo==='descartada')return;
   if(outcome.tipo==='aplicada'){
    if(outcome.respuesta.estado==='error'){const e=outcome.respuesta.error;set({status:'error',error:`${e.codigo}: ${e.mensaje} ${e.campo??''} ${e.decision_id??''}`});return;}
    set({result:readResult(outcome.respuesta.resultado,'trazado'),status:'vigente'});
   }else if(outcome.tipo==='rechazada')set({status:'error',error:`${outcome.motivo}: ${outcome.detalle}`});
   else set({status:'error',error:outcome.detalle});
  }catch(e){if(get().revision===revision&&call===callSequence)set({status:'error',error:String(e)})}
 }
}));
