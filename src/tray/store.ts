import { create } from 'zustand';
import { createManager, loadContext } from './client';
import { assertInput, readResult, type Context, type TrayInput } from './model';
const manager=createManager();
let callSequence=0;
interface State {
 context:Context|null; entrada:TrayInput|null; revision:number; selected:string|null; resultSelection:string|null;
 result:Record<string,unknown>|null; status:'sin_calcular'|'calculando'|'vigente'|'desactualizado'|'error';error:string|null;
 initialize:()=>Promise<void>; edit:(input:unknown)=>void; select:(id:string|null)=>void; calculate:()=>Promise<void>;
}
export const useTrayStore=create<State>((set,get)=>({
 context:null,entrada:null,revision:0,selected:null,resultSelection:null,result:null,status:'sin_calcular',error:null,
 initialize:async()=>{try{const context=await loadContext();const prev=get().context;if(prev&&prev.versions!==context.versions){manager.invalidar('trazado');set({revision:get().revision+1,status:'desactualizado',selected:null,resultSelection:null})}set({context,error:null});if(!get().entrada)get().edit(context.ejemplos.trazado_derivacion_pe)}catch(e){set({error:String(e),status:get().result?'desactualizado':'error',selected:null});manager.invalidar('trazado');set({revision:get().revision+1})}},
 edit:(input)=>{assertInput(input);manager.invalidar('trazado');set({entrada:structuredClone(input),revision:get().revision+1,status:get().result?'desactualizado':'sin_calcular',resultSelection:null,selected:get().selected&&input.piezas.some(p=>p.instancia_id===get().selected)?get().selected:null,error:null})},
 select:(selected)=>set({selected,resultSelection:get().status==='vigente'?selected:null}),
 calculate:async()=>{
  const call=++callSequence;
  const input=get().entrada;if(!input)return;
  assertInput(input);const revision=get().revision;set({status:'calculando',error:null,resultSelection:null});
  try{
   // Refresh versions before calculating; each successful result carries hashes from Python.
   const context=await loadContext();if(get().revision!==revision||call!==callSequence)return;
   if(get().context&&context.versions!==get().context!.versions){manager.invalidar('trazado');set({context,revision:revision+1,status:'desactualizado',selected:null,resultSelection:null,error:'Versiones cambiaron; recalcular con el nuevo contexto'});return;}
   const outcome=await manager.calcular('trazado','trazado',structuredClone(input));
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
