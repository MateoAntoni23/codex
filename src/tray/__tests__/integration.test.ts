import {beforeEach,describe,it,expect,vi} from 'vitest';
import {assertInput,readResult} from '../model';
import sample from '../../../vendor/motor_bandejas/ejemplos/trazado_derivacion_pe.json';
const mocks=vi.hoisted(()=>({load:vi.fn(),transport:vi.fn()}));
vi.mock('../client',async()=>{
 const {GestorSolicitudes}=await import('../../../vendor/motor_bandejas/integracion/ts/gestorSolicitudes');
 return {loadContext:mocks.load,createManager:()=>new GestorSolicitudes(mocks.transport)};
});
import {useTrayStore} from '../store';
const context={productos:[],cables:[],ejemplos:{trazado_derivacion_pe:sample},versions:'test'};
beforeEach(()=>{mocks.load.mockReset().mockResolvedValue(context);mocks.transport.mockReset();useTrayStore.setState({context:null,entrada:null,result:null,status:'sin_calcular',revision:0,error:null,selected:null,resultSelection:null})});
describe('CAD adapter',()=>{
 it('accepts global example and rejects nonunit ports',()=>{expect(()=>assertInput(sample)).not.toThrow();const p=structuredClone(sample);p.piezas[0].puertos.P1.direccion=[4,0,0];expect(()=>assertInput(p)).toThrow(/unitaria/)});
 it('rejects incomplete result',()=>{expect(()=>readResult({huella:'x',vigencia:'VIGENTE',verificacion_electrica:{estado:'NO_REALIZADA'}},'trazado')).toThrow(/INCOMPLETA/)});
 it('invalidates result and selected item after edit',async()=>{await useTrayStore.getState().initialize();useTrayStore.setState({result:{huella:'old'},status:'vigente',selected:'R1',resultSelection:'R1'});useTrayStore.getState().edit(sample);expect(useTrayStore.getState()).toMatchObject({status:'desactualizado',resultSelection:null})});
 it('old transport error cannot overwrite newer edit',async()=>{
  await useTrayStore.getState().initialize();let reject!:(e:Error)=>void;mocks.transport.mockImplementation(()=>new Promise((_,r)=>reject=r));
  const running=useTrayStore.getState().calculate();await vi.waitFor(()=>expect(mocks.transport).toHaveBeenCalled());
  useTrayStore.getState().edit(sample);reject(new Error('late'));await running;expect(useTrayStore.getState().error).toBeNull();
 });
 it('old calculation error cannot overwrite a newer request on same revision',async()=>{
  await useTrayStore.getState().initialize();const rejects:((e:Error)=>void)[]=[];mocks.transport.mockImplementation(()=>new Promise((_,r)=>rejects.push(r)));
  const a=useTrayStore.getState().calculate();await vi.waitFor(()=>expect(rejects).toHaveLength(1));const b=useTrayStore.getState().calculate();await vi.waitFor(()=>expect(rejects).toHaveLength(2));
  rejects[1](new Error('new'));await b;rejects[0](new Error('old'));await a;expect(useTrayStore.getState().error).toContain('new');
 });
 it('changing server versions invalidates previous result',async()=>{await useTrayStore.getState().initialize();useTrayStore.setState({result:{huella:'x'},status:'vigente',selected:'R1',resultSelection:'R1'});mocks.load.mockResolvedValue({...context,versions:'changed'});await useTrayStore.getState().initialize();expect(useTrayStore.getState()).toMatchObject({status:'desactualizado',resultSelection:null})});
});
