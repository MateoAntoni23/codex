import {beforeEach,describe,it,expect,vi} from 'vitest';
import {assertInput,readResult} from '../model';
import sample from '../../../vendor/motor_bandejas/ejemplos/trazado_derivacion_pe.json';
import {emptyTrayInput} from '../../project/emptyProject';
import {loadStaticCatalog} from '../../catalog/staticCatalog';
const mocks=vi.hoisted(()=>({health:vi.fn(),identity:vi.fn(),transport:vi.fn()}));
vi.mock('../client',async()=>{
 const {GestorSolicitudes}=await import('../../../vendor/motor_bandejas/integracion/ts/gestorSolicitudes');
 return {fetchEngineHealth:mocks.health,fetchEngineCatalogIdentity:mocks.identity,createManager:()=>new GestorSolicitudes(mocks.transport)};
});
import {useTrayStore,toMotorEntrada} from '../store';
const HEALTH={version_motor:'0.2.2',version_contrato:'1.0',n:1};
beforeEach(async()=>{
 const packaged=await loadStaticCatalog();
 // Motor "bueno": responde y su catálogo coincide con el empaquetado.
 mocks.health.mockReset().mockResolvedValue(HEALTH);
 mocks.identity.mockReset().mockResolvedValue({decisionesSha256:packaged.decisionesSha256,fingerprint:packaged.fingerprint});
 mocks.transport.mockReset();
 useTrayStore.setState({context:null,entrada:structuredClone(sample) as never,result:null,status:'sin_calcular',revision:0,error:null,selected:null,resultSelection:null,engine:{state:'desconocido',detail:null}});
});
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
 // Antes: "changing server versions" comparaba `context.versions` del motor. Ahora el
 // catálogo es estático; lo que invalida un resultado es que el motor cambie (salud distinta).
 it('a changed engine health invalidates previous result',async()=>{await useTrayStore.getState().initialize();useTrayStore.setState({result:{huella:'x'},status:'vigente',selected:'R1',resultSelection:'R1'});mocks.health.mockResolvedValue({...HEALTH,n:2});await useTrayStore.getState().initialize();expect(useTrayStore.getState()).toMatchObject({status:'desactualizado',resultSelection:null})});
});
describe('Catálogo estático y motor opcional (hito 1)',()=>{
 it('initialize siembra el catálogo con el motor APAGADO y no marca error',async()=>{
  mocks.health.mockRejectedValue(new Error('HTTP_500'));
  await useTrayStore.getState().initialize();
  const s=useTrayStore.getState();
  expect(s.engine.state).toBe('apagado');
  expect(s.error).toBeNull();
  expect(s.context?.productos.length).toBeGreaterThan(800);
  expect(s.context?.cables.length).toBe(113);
  expect(s.context?.puertos.length).toBeGreaterThan(1000);
 });
 it('motor apagado: calcular informa el motivo y no llama al transporte',async()=>{
  mocks.health.mockRejectedValue(new Error('HTTP_500'));
  await useTrayStore.getState().initialize();
  await useTrayStore.getState().calculate();
  expect(mocks.transport).not.toHaveBeenCalled();
  expect(useTrayStore.getState()).toMatchObject({status:'error'});
  expect(useTrayStore.getState().error).toMatch(/apagado/i);
 });
 it('catálogo del motor distinto del empaquetado: incompatible y NO calcula',async()=>{
  mocks.identity.mockResolvedValue({decisionesSha256:'0'.repeat(64),fingerprint:'otra'});
  await useTrayStore.getState().initialize();
  expect(useTrayStore.getState().engine.state).toBe('incompatible');
  await useTrayStore.getState().calculate();
  expect(mocks.transport).not.toHaveBeenCalled();
  expect(useTrayStore.getState().error).toMatch(/no coincide/i);
 });
 it('versión de motor no soportada: incompatible',async()=>{
  mocks.health.mockResolvedValue({version_motor:'9.9.9',version_contrato:'1.0'});
  await useTrayStore.getState().initialize();
  expect(useTrayStore.getState().engine.state).toBe('incompatible');
 });
 it('proyecto vacío: calcular avisa que no hay piezas',async()=>{
  useTrayStore.setState({entrada:emptyTrayInput()});
  await useTrayStore.getState().initialize();
  await useTrayStore.getState().calculate();
  expect(mocks.transport).not.toHaveBeenCalled();
  expect(useTrayStore.getState().error).toMatch(/No hay piezas/);
 });
 it('toMotorEntrada omite el pe neutro en un proyecto con un tramo (el motor rechaza cable_id vacío)',()=>{
  const t=emptyTrayInput();
  t.piezas.push({instancia_id:'R1',producto_id:'SAM_TRPS-300-22-Z',longitud_mm:3000,puertos:{P1:{posicion_mm:[0,0,0],direccion:[-1,0,0]},P2:{posicion_mm:[3000,0,0],direccion:[1,0,0]}}});
  const out=toMotorEntrada(t);
  expect('pe' in out).toBe(false);
  expect((out.piezas as unknown[]).length).toBe(1);
  // Con un PE definido sí viaja completo.
  t.pe={...t.pe,cable_id:'PRY-SASTFLEX-CU-1x16',seccion_requerida_mm2:16,conductores:[{conductor_id:'PE1',recorrido:['R1'],inicio:null,fin:null}]};
  expect('pe' in toMotorEntrada(t)).toBe(true);
 });
 it('toMotorEntrada omite el bloque pe neutro y conserva uno definido',()=>{
  const empty=toMotorEntrada(emptyTrayInput());
  expect('pe' in empty).toBe(false);
  const withPe=toMotorEntrada(structuredClone(sample) as never);
  expect('pe' in withPe).toBe(true);
 });
});
