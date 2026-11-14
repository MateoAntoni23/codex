/**
 * Lo que viaja al motor desde los datos del espacio de trabajo (etapa 3, parte A,
 * 2026-11-13). No cambia el motor ni su contrato (`trazado/1`).
 *
 * CIRCUITOS (`circuitosParaMotor`): cada circuito guardado de equipo a equipo se
 * traduce a un circuito del contrato —circuito_id, funcion, cable_id, cantidad,
 * separado, recorrido (las piezas de bandeja en orden; las bajadas no son bandeja
 * y no viajan)—. Viaja SÓLO si:
 *   - su función es potencia (el motor rechaza otra: D-11, mando y señal sin
 *     reglas). Maniobra e instrumentación se quedan con su motivo;
 *   - tiene cable (si no, está incompleto);
 *   - está vigente (uno desactualizado se recalcula antes; si no, el recorrido
 *     guardado podría nombrar piezas que ya no están);
 *   - su cable no es el del PE (el motor lo rechazaría: se contaría dos veces).
 * `separado` va en false para todos: confirmado por el operador (dentro de cada
 * grupo los cables van agrupados, en contacto — D-02). Con eso D-01, D-03 y D-07
 * no se activan y el motor admite secciones mezcladas.
 *
 * PE (`peDelTrazado`): el motor exige un PE real para evaluar cobertura y
 * equipotencialidad (sin PE su resumen da «cobertura del PE incompleta» y «PE sin
 * conexión al sistema de protección»). Se arma así, sin pedir nada nuevo:
 *   - sección: 16 mm², el requisito aprobado del usuario en las decisiones del
 *     motor (D-20, no se puede redefinir desde la entrada);
 *   - cable: el único del catálogo unipolar de 16 mm² con aislación verde/amarillo
 *     (D-21): PRY-SASTFLEX-CU-1x16 (Superastic Flex). Sale de la regla, no se elige;
 *   - recorrido: el requisito D-20 dice «recorriendo todos los tramos de bandeja,
 *     incluidos los ramales». Se cubre cada red de bandejas con conductores: uno
 *     principal desde un extremo y uno por cada ramal, que arranca en la pieza de
 *     la que deriva (una T) con un punto «derivacion_pe» ahí. Las derivaciones en
 *     un tramo (enganches) unen redes con un «derivacion_pe» sin pieza (la DCPS o el
 *     ramal no están unidos al tronco por una conexión del trazado). Cada red tiene
 *     un punto «sistema_proteccion» en el inicio de su conductor principal: su
 *     ubicación no se modela (el motor la informa NO_CONTRASTABLE).
 * Si el trazado trae un `pe` propio (no neutro) o puntos equipotenciales, se
 * respetan y no se generan.
 */
import type { Circuit, TrayInput } from '../../tray/model';
import type { EquipmentElement } from '../../types/domain-v2';
import { enganchesOf } from '../derivacion/enganche';
import { circuitosOf, estadoCircuito, faltaParaCalcular, MOTIVO_D11, type CircuitoGuardado } from '../recorridos/circuitosGuardados';

export const PE_SECCION_MM2 = 16;
export const PE_CABLE_ID = 'PRY-SASTFLEX-CU-1x16';
export const PE_ORIGEN =
  'Requisito aprobado del usuario: D-20 (16 mm²) y D-21 (verde/amarillo). Cable: el único del catálogo unipolar de 16 mm² con aislación verde/amarillo. Recorrido: todas las piezas de bandeja, incluidos los ramales (armado por la app desde el trazado).';
export const PROCEDENCIA_SEPARADO = 'separado = false para todos: confirmado por el operador (cables agrupados, en contacto, D-02).';

export interface NoEnviado {
  readonly id: string;
  readonly nombre: string;
  readonly motivo: string;
  /** Lo que se mide igual (aunque no se calcule). */
  readonly sumaMm: number;
  readonly completa: boolean;
}

export function circuitosParaMotor(
  entrada: TrayInput,
  elements: readonly EquipmentElement[],
  idsCables?: readonly string[],
): { enviados: Circuit[]; noEnviados: NoEnviado[] } {
  const enviados: Circuit[] = [];
  const noEnviados: NoEnviado[] = [];
  const ocupados = new Set(entrada.circuitos.map((c) => c.circuito_id));
  const no = (c: CircuitoGuardado, motivo: string) => noEnviados.push({ id: c.id, nombre: c.nombre, motivo, sumaMm: c.sumaMm, completa: c.completa });
  for (const c of circuitosOf(entrada)) {
    if (c.cable && c.cable.funcion !== 'potencia') { no(c, `No va al motor — ${MOTIVO_D11}`); continue; }
    const falta = faltaParaCalcular(c, idsCables);
    if (falta.length) { no(c, `Incompleto: ${falta.join('; ')}`); continue; }
    const est = estadoCircuito(entrada, elements, c);
    if (!est.vigente) { no(c, `Desactualizado (recalculalo antes de calcular): ${est.motivos.join('; ')}`); continue; }
    if (c.cable!.cable_id === PE_CABLE_ID) { no(c, `Su cable (${PE_CABLE_ID}) es el del PE: el motor lo contaría dos veces`); continue; }
    if (ocupados.has(c.id)) { no(c, `Otro circuito del trazado ya se llama ${c.id}`); continue; }
    const recorrido: string[] = [];
    for (const cr of c.cruces) if (!recorrido.includes(cr.pieza)) recorrido.push(cr.pieza);
    enviados.push({ circuito_id: c.id, funcion: 'potencia', cable_id: c.cable!.cable_id, cantidad: c.cable!.cantidad, separado: false, recorrido });
  }
  return { enviados, noEnviados };
}

// ─── PE del trazado ──────────────────────────────────────────────────────────

type Tramo = string;
interface Conductor { conductor_id: string; recorrido: Tramo[]; inicio: string | null; fin: null }
interface Punto { punto_id: string; tipo: 'sistema_proteccion' | 'derivacion_pe'; conductores: string[]; instancias: string[]; descripcion: string }

export function peDelTrazado(entrada: TrayInput): { pe: TrayInput['pe']; equipotencial: { puntos: Punto[] } } | null {
  const ids = entrada.piezas.map((p) => p.instancia_id);
  if (!ids.length) return null;
  const orden = new Map(ids.map((id, i) => [id, i]));
  const vecinos = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const k of entrada.conexiones) {
    const [a, b] = [k.a[0], k.b[0]];
    if (!vecinos.has(a) || !vecinos.has(b) || a === b) continue;
    if (!vecinos.get(a)!.includes(b)) vecinos.get(a)!.push(b);
    if (!vecinos.get(b)!.includes(a)) vecinos.get(b)!.push(a);
  }
  for (const v of vecinos.values()) v.sort((x, y) => orden.get(x)! - orden.get(y)!);
  // Derivaciones en un tramo: el ramal (DCPS o lo continuado) no está unido al tronco por una conexión.
  const ramales = enganchesOf(entrada)
    .map((e) => ({ id: e.id, tronco: e.tronco, salida: e.salida[0] }))
    .filter((e) => vecinos.has(e.tronco) && vecinos.has(e.salida));

  const conductores: Conductor[] = [];
  const puntos: Punto[] = [];
  const duenio = new Map<string, string>(); // pieza → conductor que la recorre entera (el primero)
  const visitadas = new Set<string>();
  let nPe = 0;
  let nD = 0;
  let nSp = 0;

  const camino = (desde: string): string[] => {
    const out: string[] = [];
    for (let cur: string | undefined = desde; cur; ) {
      out.push(cur);
      visitadas.add(cur);
      cur = vecinos.get(cur)!.find((n) => !visitadas.has(n));
    }
    return out;
  };
  const nuevoConductor = (recorrido: string[], inicio: string | null) => {
    const c: Conductor = { conductor_id: `PE-${++nPe}`, recorrido, inicio, fin: null };
    conductores.push(c);
    for (const p of recorrido) if (!duenio.has(p)) duenio.set(p, c.conductor_id);
    return c;
  };
  /** Cubre la parte de la red a la que se llega desde `raiz`; devuelve el conductor principal. */
  const cubrir = (raiz: string, inicio: string | null) => {
    const principal = nuevoConductor(camino(raiz), inicio);
    // Ramales: desde cada pieza ya recorrida con un vecino sin recorrer (en el orden en que se recorren).
    for (let i = 0; i < conductores.length; i++) {
      for (const p of conductores[i].recorrido) {
        for (let n = vecinos.get(p)!.find((x) => !visitadas.has(x)); n; n = vecinos.get(p)!.find((x) => !visitadas.has(x))) {
          const d = `DPE-${++nD}`;
          const rama = nuevoConductor([p, ...camino(n)], d);
          puntos.push({ punto_id: d, tipo: 'derivacion_pe', conductores: [duenio.get(p)!, rama.conductor_id], instancias: [p],
            descripcion: 'Derivación del PE en la pieza de la que sale el ramal (armado por la app)' });
        }
      }
    }
    return principal;
  };
  const extremo = (id: string) => {
    // Raíz de una red: una pieza con un solo vecino (un extremo), en el orden del trazado.
    const comp: string[] = [];
    const vistos = new Set([id]);
    for (const pila = [id]; pila.length; ) {
      const x = pila.pop()!;
      comp.push(x);
      for (const n of vecinos.get(x)!) if (!vistos.has(n)) { vistos.add(n); pila.push(n); }
    }
    comp.sort((x, y) => orden.get(x)! - orden.get(y)!);
    return comp.find((x) => vecinos.get(x)!.length <= 1) ?? comp[0];
  };

  const salidas = new Set(ramales.map((r) => r.salida));
  const pendientes = (desdeTronco: Set<string>) => ramales.filter((r) => desdeTronco.has(r.tronco) && !visitadas.has(r.salida));
  for (const id of ids) {
    if (visitadas.has(id) || salidas.has(id)) continue;
    // Una red: desde un extremo, con su conexión al sistema de protección.
    const sp = `SP-${++nSp}`;
    const principal = cubrir(extremo(id), sp);
    puntos.push({ punto_id: sp, tipo: 'sistema_proteccion', conductores: [principal.conductor_id], instancias: [],
      descripcion: 'Conexión del PE al sistema de protección (barra PE del tablero de origen); ubicación no modelada' });
    // Ramales por derivación en un tramo, encadenados.
    for (let r = pendientes(visitadas)[0]; r; r = pendientes(visitadas)[0]) {
      const rama = cubrir(r.salida, null);
      puntos.push({ punto_id: `DPE-${++nD}`, tipo: 'derivacion_pe', conductores: [duenio.get(r.tronco)!, rama.conductor_id], instancias: [],
        descripcion: `Derivación del PE en la derivación en tramo ${r.id} (el ramal no está unido al tronco por una conexión del trazado)` });
    }
  }
  // Lo que quede (un ramal de enganche cuyo tronco no se recorrió): red propia.
  for (const id of ids) {
    if (visitadas.has(id)) continue;
    const sp = `SP-${++nSp}`;
    const principal = cubrir(extremo(id), sp);
    puntos.push({ punto_id: sp, tipo: 'sistema_proteccion', conductores: [principal.conductor_id], instancias: [],
      descripcion: 'Conexión del PE al sistema de protección; ubicación no modelada' });
  }

  return {
    pe: { seccion_requerida_mm2: PE_SECCION_MM2, cable_id: PE_CABLE_ID, origen_requisito: PE_ORIGEN, conductores: conductores as unknown as Record<string, unknown>[] },
    equipotencial: { puntos },
  };
}
