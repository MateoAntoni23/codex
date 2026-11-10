import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, Html, Line, OrbitControls } from '@react-three/drei';
import { useTrayStore } from './store';
import { assertInput, object, type Point, type TrayInput } from './model';
import { GestorSolicitudes } from '../../vendor/motor_bandejas/integracion/ts/gestorSolicitudes';
import { transport } from './client';
const view=(p:Point):Point=>[p[0]/1000,p[2]/1000,-p[1]/1000];
function Scene(){
 const {entrada,selected,select}=useTrayStore();if(!entrada)return null;
 return <><ambientLight intensity={1}/><Grid args={[30,30]} cellSize={1} sectionSize={5}/><OrbitControls makeDefault target={view(entrada.piezas.find(p=>p.instancia_id===selected)?.puertos.P1?.posicion_mm??[4500,1000,3000])}/>
 {entrada.piezas.map(p=>{
  const ports=Object.values(p.puertos);if(ports.length<2)return null;
  const start=view(ports[0].posicion_mm);const endpoints=ports.slice(1).map(q=>view(q.posicion_mm));
  return <group key={p.instancia_id}>{endpoints.map((end,i)=><Line key={i} points={[start,end]} color={selected===p.instancia_id?'#ffcf33':'#50b8de'} lineWidth={selected===p.instancia_id?12:7} onClick={e=>{e.stopPropagation();select(p.instancia_id)}}/>)}
   <Html position={start} style={{pointerEvents:'none',color:'#fff',fontSize:12}}>{p.instancia_id}</Html>
   {Object.entries(p.puertos).map(([id,port])=><mesh key={id} position={view(port.posicion_mm)} onClick={e=>{e.stopPropagation();select(p.instancia_id)}}><sphereGeometry args={[0.055,8,8]}/><meshBasicMaterial color="#e0b85b"/></mesh>)}
  </group>
 })}
 {entrada.soportes.map(s=>{const p=entrada.piezas.find(p=>p.instancia_id===s.instancia_id);if(!p?.puertos.P1||!p.puertos.P2)return null;const a=p.puertos.P1.posicion_mm,b=p.puertos.P2.posicion_mm;const length=Math.hypot(...a.map((n,i)=>b[i]-n));if(!length)return null;const q=a.map((n,i)=>n+(b[i]-n)*s.distancia_desde_P1_mm/length) as Point;return <mesh key={s.soporte_id} position={view(q)} onClick={e=>{e.stopPropagation();select(s.instancia_id)}}><boxGeometry args={[0.5,0.12,0.12]}/><meshBasicMaterial color="#bb77bb"/></mesh>})}
 {/* PE route coverage is schematic; no electrical contact is inferred. */}
 {entrada.pe.conductores.map((c,i)=>{const path=c.recorrido;if(!Array.isArray(path))return null;const points:Point[]=[];for(const step of path){const id=typeof step==='string'?step:object(step)?step.instancia:null;const p=entrada.piezas.find(p=>p.instancia_id===id);if(p)for(const port of Object.values(p.puertos).slice(0,2))points.push(view(port.posicion_mm))}return points.length>1?<Line key={i} points={points.map(p=>[p[0],p[1]+0.08,p[2]])} color="#b9e539" dashed dashSize={0.1} gapSize={0.08} lineWidth={2}/>:null})}
 </>;
}
function JsonBlock({value}:{value:unknown}){return <pre className="tray-json">{JSON.stringify(value,null,2)}</pre>}
function Results(){const {result,status,entrada,select}=useTrayStore();if(!result)return <p>Sin resultados. Calcular para consultar al motor Python.</p>;
 const selectFor=(id:string,value:unknown)=>{
  if(entrada?.piezas.some(p=>p.instancia_id===id)){select(id);return;}
  const connection=entrada?.conexiones.find(c=>c.conexion_id===id);if(connection){select(connection.a[0]);return;}
  if(object(value)&&typeof value.instancia_id==='string'){select(value.instancia_id);return;}
  const circuit=entrada?.circuitos.find(c=>c.circuito_id===id);if(circuit){select(circuit.recorrido[0]??null);return;}
  const support=entrada?.soportes.find(s=>s.soporte_id===id);if(support)select(support.instancia_id);
 };
 return <><strong>{status==='vigente'?'Resultado de preselección':'RESULTADO NO VIGENTE — recalcular'}</strong>
 <p>No verifica eléctricamente ni aprueba instalaciones.</p>
 {object(result.resumen)&&<p><b>{String(result.resumen.estado_trazado).split('_').join(' ')}</b></p>}
 <h4>Ocupación por pieza / boca</h4>
 {object(result.ocupacion)&&Object.entries(result.ocupacion).map(([id,p])=>object(p)&&object(p.secciones)?<section key={id}><button disabled={status!=='vigente'} onClick={()=>selectFor(id,p)}>Localizar {id}</button>{Object.entries(p.secciones).map(([mouth,v])=>object(v)?<p key={mouth}>{mouth}: ocupado {String(v.ancho_ocupado_mm)} mm / {String(v.ancho_referencia_mm)} mm ({String(v.base_ancho)}). Reserva libre: {object(v.reserva)?String(v.reserva.reserva_libre_pct):'?'} %. {String(v.estado).split('_').join(' ')}<br/>{Array.isArray(v.condiciones)?v.condiciones.join(' · '):''}</p>:null)}</section>:null)}
 <h4>PE y protección — verificaciones separadas</h4>
 {object(result.resumen)&&object(result.resumen.equipotencial)&&Object.entries(result.resumen.equipotencial).map(([k,v])=><p key={k}><b>{k.split('_').join(' ')}</b>: {Array.isArray(v)?v.join(', '):String(v).split('_').join(' ')}</p>)}
 <h4>Cómputo de materiales</h4>
 {object(result.computo)&&Array.isArray(result.computo.lineas)&&result.computo.lineas.map((v,i)=>object(v)?<p key={i}>{String(v.sku??v.producto_id??'Pendiente')}: {String(v.cantidad??'?')} {String(v.unidad??'')}<br/>{String(v.descripcion??'')}</p>:null)}
 <h4>Detalle trazable, condiciones y fuentes</h4>
 {Object.entries(result).filter(([k])=>k!=='entrada').map(([key,val])=><details key={key} open={key==='resumen'||key==='verificacion_electrica'}><summary>{key}</summary>
 {Array.isArray(val)?val.map((v,i)=><div key={i}><button disabled={status!=='vigente'} onClick={()=>selectFor(object(v)?String(v.soporte_id??v.instancia_id??v.corrida_id??i):String(i),v)}>Localizar referencia {i+1}</button><JsonBlock value={v}/></div>):object(val)?Object.entries(val).map(([id,v])=><div key={id}><button disabled={status!=='vigente'} onClick={()=>selectFor(id,v)}>{id} · localizar si tiene referencia</button><JsonBlock value={v}/></div>):<JsonBlock value={val}/>}</details>)}
 </>;
}
export function TrayWorkspace(){
 const state=useTrayStore();const {context,entrada,selected}=state;
 const sectorRequest=useRef(0);
 const [draft,setDraft]=useState('');const [error,setError]=useState<string|null>(null);const [sector,setSector]=useState<unknown>(null);
 useEffect(()=>{void state.initialize();const tick=setInterval(()=>void useTrayStore.getState().initialize(),30000);return()=>clearInterval(tick)},[]);
 useEffect(()=>{if(entrada)setDraft(JSON.stringify(entrada,null,2))},[entrada]);
 const edit=(fn:(x:TrayInput)=>void)=>{if(!entrada)return;try{const next=structuredClone(entrada);fn(next);state.edit(next);setError(null)}catch(e){setError(String(e))}};
 const piece=entrada?.piezas.find(p=>p.instancia_id===selected);
 const addRect=()=>{
  const raw=prompt('ID único del recto');if(!raw)return;
  const id=raw.trim();const product=context?.productos.find(p=>p.tipo_pieza==='recta');if(!product)return;
  edit(x=>{if(x.piezas.some(p=>p.instancia_id===id))throw Error('ID repetido');x.piezas.push({instancia_id:id,producto_id:product.producto_id,longitud_mm:3000,puertos:{P1:{posicion_mm:[0,0,3000],direccion:[-1,0,0]},P2:{posicion_mm:[3000,0,3000],direccion:[1,0,0]}}})});state.select(id);
 };
 const link=()=>{if(!entrada||entrada.piezas.length<2)return;const a=prompt('Extremo A: instancia,puerto (ejemplo R1,P2)');const b=prompt('Extremo B: instancia,puerto');if(!a||!b)return;edit(x=>{const aa=a.split(',').map(x=>x.trim()),bb=b.split(',').map(x=>x.trim());if(aa.length!==2||bb.length!==2||!x.piezas.find(p=>p.instancia_id===aa[0])?.puertos[aa[1]]||!x.piezas.find(p=>p.instancia_id===bb[0])?.puertos[bb[1]])throw Error('Puertos inexistentes');x.conexiones.push({conexion_id:crypto.randomUUID(),a:aa as [string,string],b:bb as [string,string]})})};
 const runSector=async(key:string)=>{if(!context)return;const request=++sectorRequest.current;const input=context.ejemplos[key];const manager=new GestorSolicitudes(transport,'sector');try{const outcome=await manager.calcular('sector',key,input);if(request===sectorRequest.current)setSector(outcome)}catch(e){if(request===sectorRequest.current)setSector({error:String(e)})}};
 return <div className="tray-workspace">
 <header><a href="?preview=v2">Equipos</a> · <a href="?legacy=v1">Editor inicial</a><h2>Bandejas · motor Python 0.2.2</h2><b>EXPERIMENTAL · SINTÉTICO · en memoria</b><p>Representación esquemática de ejes y bocas; curvas y T no acreditan dimensiones físicas. No guarda ni migra proyectos reales.</p>
 <button onClick={()=>void state.initialize()}>Reconectar / comprobar versiones</button><button disabled={!entrada||entrada.piezas.length===0||state.status==='calculando'} title={entrada&&entrada.piezas.length===0?'No hay piezas para calcular':undefined} onClick={()=>void state.calculate()}>Calcular trazado</button> <strong role="status">{state.status} · revisión {state.revision}</strong>
 {(state.error||error)&&<p role="alert">{state.error||error}</p>}</header>
 <aside><h3>Trazado</h3><button onClick={addRect} disabled={!context}>Agregar recto (editable)</button><button onClick={link}>Conectar puertos</button>
 <button onClick={()=>{if(context&&confirm('¿Reemplazar trazado experimental?'))state.edit(context.ejemplos.trazado_derivacion_pe)}}>Cargar ejemplo con derivación</button>
 {entrada?.piezas.map(p=><button className={selected===p.instancia_id?'active':''} key={p.instancia_id} onClick={()=>state.select(p.instancia_id)}>{p.instancia_id} · {p.producto_id}</button>)}
 {piece&&<section><h3>{piece.instancia_id}</h3><label>Producto de catálogo<select value={piece.producto_id} onChange={e=>edit(x=>{x.piezas.find(p=>p.instancia_id===selected)!.producto_id=e.target.value})}>{context?.productos.map(p=><option value={p.producto_id} key={p.producto_id}>{p.sku} · {p.tipo_pieza}</option>)}</select></label>
 <p>Longitud de pieza, nunca vano:</p><input aria-label="Longitud de pieza mm" type="number" value={piece.longitud_mm??piece.longitud_eje_mm??0} onChange={e=>edit(x=>{const p=x.piezas.find(p=>p.instancia_id===selected)!;if(p.longitud_mm!==undefined)p.longitud_mm=Number(e.target.value);else p.longitud_eje_mm=Number(e.target.value)})}/>
 {Object.entries(piece.puertos).map(([id,p])=><fieldset key={id}><legend>{id} · global mm</legend>{p.posicion_mm.map((v,i)=><label key={i}>{['X','Y','Z'][i]}<input type="number" value={v} onChange={e=>edit(x=>{x.piezas.find(p=>p.instancia_id===selected)!.puertos[id].posicion_mm[i]=Number(e.target.value)})}/></label>)}</fieldset>)}
 </section>}
 <h3>Circuitos</h3>{entrada?.circuitos.map((c,i)=><fieldset key={c.circuito_id}><legend>{c.circuito_id}</legend><select aria-label={`Cable ${c.circuito_id}`} value={c.cable_id} onChange={e=>edit(x=>{x.circuitos[i].cable_id=e.target.value})}>{context?.cables.map(id=><option key={id}>{id}</option>)}</select><label>Cantidad<input type="number" value={c.cantidad} onChange={e=>edit(x=>{x.circuitos[i].cantidad=Number(e.target.value)})}/></label><label>Recorrido (IDs separados por coma)<input value={c.recorrido.join(',')} onChange={e=>edit(x=>{x.circuitos[i].recorrido=e.target.value.split(',').map(s=>s.trim())})}/></label></fieldset>)}
 <h3>PE requerido: 16 mm² verde/amarillo</h3><p>Modelo candidato; admisibilidad y montaje pendientes. Contacto con ala ≠ conexión eléctrica.</p>
 {entrada&&<select aria-label="Modelo candidato PE" value={entrada.pe.cable_id} onChange={e=>edit(x=>{x.pe.cable_id=e.target.value})}>{context?.cables.map(id=><option key={id}>{id}</option>)}</select>}
 <h3>Soportes</h3>{entrada?.soportes.map((s,i)=><label key={s.soporte_id}>{s.soporte_id} sobre {s.instancia_id} · distancia desde P1 (mm)<input type="number" value={s.distancia_desde_P1_mm} onChange={e=>edit(x=>{x.soportes[i].distancia_desde_P1_mm=Number(e.target.value)})}/></label>)}
 <h3>Casos de cables del paquete</h3>{['caso1_4_separados','caso2_8_separados','caso3_8_contacto'].map(key=><button key={key} onClick={()=>void runSector(key)}>{key}</button>)}{sector!==null&&<JsonBlock value={sector}/>}
 </aside>
 <main><Canvas camera={{position:[12,12,12],fov:45}} onPointerMissed={()=>state.select(null)}><Scene/></Canvas><p>Ejes azules: piezas; puntos: puertos; violeta: soportes; verde discontinuo: PE esquemático. Selección amarilla. Coordenadas del motor en mm, Z vertical.</p>
 <details><summary>Editar contrato completo: conexiones, tapas, recorridos PE y equipotencialidad</summary><textarea aria-label="Contrato trazado JSON" value={draft} onChange={e=>setDraft(e.target.value)}/><button onClick={()=>{try{const x:unknown=JSON.parse(draft);assertInput(x);state.edit(x);setError(null)}catch(e){setError(String(e))}}}>Aplicar e invalidar</button></details>
 </main><article><h3>Resultados y diagnósticos</h3><Results/></article></div>;
}
