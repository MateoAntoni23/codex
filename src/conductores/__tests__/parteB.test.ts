/**
 * Biblioteca de conductores, parte B: los declarados en el cálculo.
 *   B1 casan con la misma regla y se ve que son declarados;
 *   B2 no viajan al motor; las bandejas que los llevan las calcula la app;
 *   B3 bandeja mixta: manda la app, y dice por qué, nombrando los declarados;
 *   B4 declarado sin diámetro: la bandeja queda sin ocupación calculable, nombrando cuál;
 *   B5 «tendidos de potencia sin cable» cuenta sólo los que tampoco tienen declarado.
 * Controles negativos: un declarado que viaje al motor falla; una bandeja con declarado
 * cuya ocupación quede como del motor falla.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedStaticCatalog } from '../../catalog/staticCatalog';
import { clearCatalogPortIndex, clearPortMappingOverrides, clearProductCatalogIndex, setMasterResolver } from '../../workspace/catalogPortMapping';
import { definicionEfectiva, withDefinition } from '../../workspace/placement/definitions';
import { placeDefinition, puertosFromWorld } from '../../workspace/placement/placementCore';
import { crearBajada } from '../../workspace/equipos/bajada';
import { guardarCircuito } from '../../workspace/recorridos/circuitosGuardados';
import { construirCatalogoCables } from '../../workspace/cables/catalogoCables';
import { toMotorEntrada } from '../../tray/store';
import { colocarBanda, ocupacionSegregada } from '../../workspace/segregacion/bandaDivisoria';
import { asegurarSinDeclarados, circuitosParaMotor, PE_CABLE_ID } from '../../workspace/motor/paraMotor';
import { declaradoOf, elegirCable, vincular } from '../../conexiones/declarado';
import { cableDeTendido, cablesDelCircuito, faltaConExcel } from '../../conexiones/tendidos';
import { porBandeja } from '../../conexiones/porBandeja';
import { ocupacionConDeclarados, ocupacionDeLaApp } from '../ocupacionApp';
import { declaradosUsados } from '../guia';
import type { CableDeclarado } from '../biblioteca';
import type { ConexionImportada, ImportedCatalog, TendidoImportado } from '../../import/types';
import type { CatalogCompatibility, Product, TrayInput } from '../../tray/model';
import type { EquipmentElement } from '../../types/domain-v2';

const VENDOR = resolve(__dirname, '../../../vendor/motor_bandejas');
const snapshot = JSON.parse(readFileSync(resolve(VENDOR, 'datos/catalogo/catalogo_bandejas_snapshot.json'), 'utf8')) as { PRODUCTOS: Product[]; COMPATIBILIDADES: CatalogCompatibility[] };
const productos = new Map(snapshot.PRODUCTOS.map((p) => [p.producto_id, p]));
const datasets = readdirSync(resolve(VENDOR, 'datos/cables')).sort().map((f) => JSON.parse(readFileSync(resolve(VENDOR, 'datos/cables', f), 'utf8')));
const idsMotor = (JSON.parse(readFileSync(resolve(__dirname, '../../workspace/cables/__tests__/fixtures/cable_ids_motor.json'), 'utf8')) as { cable_ids: string[] }).cable_ids;
const rc = construirCatalogoCables(datasets, idsMotor);
if (!rc.ok) throw new Error(rc.motivo);
const CABLES = rc.cables;
const D = new Map(CABLES.map((c) => [c.cable_id, c.diametro_exterior_mm]));
const dCat = (id: string) => D.get(id)!;

beforeAll(async () => {
  clearPortMappingOverrides();
  await seedStaticCatalog();
});
afterAll(() => {
  clearPortMappingOverrides();
  clearCatalogPortIndex();
  clearProductCatalogIndex();
  setMasterResolver(null);
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

let n = 0;
const declarado = (extra: Partial<CableDeclarado> = {}): CableDeclarado => ({
  cable_id: `OP-b-${++n}`, designacion: 'Sintenax 5 × 6 (declarado)', tipo: 'multipolar', material: 'cobre', n_conductores: 5, seccion_mm2: 6,
  diametro_exterior_mm: 17.5, masa_kg_km: 520, procedencia: { declaradoEl: '2026-11-16T00:00:00.000Z' }, ...extra,
});
const D5x6 = declarado();
const D2x1 = declarado({ designacion: 'Control 2 × 1 (declarado)', n_conductores: 2, seccion_mm2: 1, diametro_exterior_mm: 7.2, masa_kg_km: 60 });

const td = (id: string, conexionId: string, extra: Partial<TendidoImportado>): TendidoImportado => ({
  tendidoId: id, conexionId, naturaleza: 'CABLE_MULTIPOLAR', funcion: '3F+N+PE', cantidadUnidades: 1,
  incluyePe: 'NO_APLICA', apantallado: 'NO_INDICADO', estadoAlcance: 'NUEVO', fuenteHoja: 'CONDUCTORES', ...extra,
});
const cx = (id: string, servicio: ConexionImportada['servicio']): ConexionImportada => ({
  conexionId: id, servicio, descripcion: 'x', origenTextoOriginal: 'A', destinoTextoOriginal: 'B', proyecto: 'P', estadoAlcance: 'NUEVO',
  origenEquipoId: 'A', destinoEquipoId: 'B',
});
const CX_POT = cx('CX-P', 'POTENCIA');
const CX_CTL = cx('CX-C', 'CONTROL');
const T_5x6 = td('CB-5x6', 'CX-P', { conductoresPorUnidad: 5, seccionMm2: 6, cantidadUnidades: 1 });
const T_2x1 = td('CB-2x1', 'CX-C', { funcion: 'SENAL_CONTROL', conductoresPorUnidad: 2, seccionMm2: 1, cantidadUnidades: 3 });
const catalogo = (conexiones: ConexionImportada[], tendidos: TendidoImportado[]): ImportedCatalog => ({
  meta: { formatoId: 'ELS-IMP-EQCX', formatoVersion: '1.0', nombreArchivo: 'x', fileHash: 'h', importedAt: '' },
  equipos: [], componentes: [], atributos: [], conexiones, tendidos, alias: [], pendientes: [], trazabilidad: [], catalogoAtributos: [], listas: {},
});
const CAT = catalogo([CX_POT, CX_CTL], [T_5x6, T_2x1]);

const eq = (id: string, pos: number[]) => ({
  id, name: id, tag: null, category: 'pump', parentId: null, placementStatus: 'placed',
  transform: { positionMm: { x: pos[0], y: pos[1], z: pos[2] }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
}) as unknown as EquipmentElement;
const ELS = [eq('A', [0, 1000, 0]), eq('B', [3000, 1000, 0])];

/**
 * Un tramo recto R1 (escalera 300 ala 90) entre A y B, con: «Fuerza» a mano (2 × Sintenax 3×50,
 * catálogo, potencia), «CX-P» ligado al Excel (1 × 5×6 de potencia: sin cable de catálogo) y
 * «CX-C» ligado (3 × 2×1 de control: debajo del piso del catálogo).
 */
function proyecto(conFuerza = true): TrayInput {
  const d = definicionEfectiva(productos.get('SAM_TRES-300-090-18-Z')!, { longitud_mm: 3000 });
  if (!d.ok) throw new Error(d.motivo);
  const pl = placeDefinition({ def: d.def, huella: d.huella, mano: 'nativa', entryPortName: 'P1', startPos: [0, 0, 0], entryDir: [1, 0, 0], sectionUp: [0, 0, 1] });
  const t0 = {
    version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [], reserva_solicitada_pct: 20,
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  } as unknown as TrayInput;
  let t: TrayInput = { ...withDefinition(t0, d.huella, d.def), piezas: [{ instancia_id: 'R1', producto_id: 'SAM_TRES-300-090-18-Z', longitud_mm: 3000, puertos: puertosFromWorld(pl.ports), colocacion: pl.colocacion }] } as TrayInput;
  for (const [e, desde] of [['A', 'P1'], ['B', 'P2']] as const) {
    const b = crearBajada(t, productos, ELS, { equipo: e, tronco: 'R1', desde_boca: desde, distancia_mm: 100, lado: 'izquierda' });
    if (!b.ok) throw new Error(b.motivo);
    t = b.entrada;
  }
  if (conFuerza) {
    const g = guardarCircuito(t, ELS, 'Fuerza', { equipo: 'A' }, { equipo: 'B' }, { cable_id: 'PRY-SVALIO-CU-3x50', cantidad: 2, separado: false, funcion: 'potencia' });
    if (!g.ok) throw new Error(g.motivo);
    t = g.entrada;
  }
  for (const c of [CX_POT, CX_CTL]) {
    const g = guardarCircuito(t, ELS, c.conexionId, { equipo: 'A' }, { equipo: 'B' }, undefined, undefined, `CIR-${c.conexionId}`);
    if (!g.ok) throw new Error(g.motivo);
    t = vincular(g.entrada, `CIR-${c.conexionId}`, c, CAT.tendidos.filter((x) => x.conexionId === c.conexionId));
  }
  return t;
}
const excel = (declarados: readonly CableDeclarado[]) => ({ catalog: CAT, cables: CABLES, declarados });
const nPeEnR1 = (t: TrayInput) => {
  const o = ocupacionConDeclarados(t, ELS, productos, D, 'R1', excel([D5x6]));
  return o && o.calculada ? o.grupo.cables.find((k) => k.origen === 'PE')?.cantidad ?? 0 : 0;
};

// ─── B1 ──────────────────────────────────────────────────────────────────────

describe('B1 — un tendido casa con un declarado con la misma regla, y se ve que es declarado', () => {
  const VACIO = declaradoOf(null);
  it('sin declarados no casa; con uno de 5 × 6 mm², es su único candidato', () => {
    expect(cableDeTendido(T_5x6, CABLES, VACIO).cableDeclarado).toBeNull();
    const k = cableDeTendido(T_5x6, CABLES, VACIO, [D5x6, D2x1]);
    expect(k).toMatchObject({ cable: null, procedencia: 'unico-candidato', motivoSinCable: null });
    expect(k.cableDeclarado?.cable_id).toBe(D5x6.cable_id);
    expect(cableDeTendido(T_2x1, CABLES, VACIO, [D5x6, D2x1]).cableDeclarado?.cable_id).toBe(D2x1.cable_id);
  });

  it('la regla es la misma: otra sección o conductores no casan', () => {
    const otro = declarado({ seccion_mm2: 10 });
    expect(cableDeTendido(T_5x6, CABLES, VACIO, [otro]).cableDeclarado).toBeNull();
    expect(cableDeTendido(T_5x6, CABLES, VACIO, [declarado({ n_conductores: 4 })]).cableDeclarado).toBeNull();
  });

  it('un declarado que compite con uno del catálogo: varios candidatos, elige el operador (sin regla del cobre)', () => {
    const t = td('CB-3x50', 'CX-P', { conductoresPorUnidad: 3, seccionMm2: 50 });
    const VAC = declaradoOf(null);
    const solo = cableDeTendido(t, CABLES, VAC);
    const copia = declarado({ designacion: 'Copia 3 × 50', n_conductores: 3, seccion_mm2: 50, diametro_exterior_mm: 30 });
    const k = cableDeTendido(t, CABLES, VAC, [copia]);
    expect(k.cable).toBeNull();
    expect(k.cableDeclarado).toBeNull();
    expect(k.candidatosDeclarados.map((x) => x.cable_id)).toEqual([copia.cable_id]);
    expect(k.candidatos.length).toBe(solo.candidatos.length);
    expect(k.motivoSinCable).toMatch(/declarado\(s\) por el operador\): elegí uno/);
    const e = elegirCable({} as TrayInput, 'CB-3x50', copia.cable_id);
    expect(cableDeTendido(t, CABLES, declaradoOf(e), [copia])).toMatchObject({ procedencia: 'operador', cable: null, cableDeclarado: copia });
  });

  it('elegido un declarado que ya no está en la biblioteca de este equipo: sin cable, con el motivo', () => {
    const e = elegirCable({} as TrayInput, T_5x6.tendidoId, 'OP-no-existe');
    const k = cableDeTendido(T_5x6, CABLES, declaradoOf(e), [D5x6]);
    expect(k.cableDeclarado).toBeNull();
    expect(k.motivoSinCable).toMatch(/OP-no-existe.*no está en la biblioteca de conductores/);
  });

  it('el circuito ligado lleva el declarado, marcado como tal', () => {
    const t = proyecto();
    const items = cablesDelCircuito(t, CAT, CABLES, { ...((t as Record<string, unknown>).circuitos_ws as { id: string }[]).find((c) => c.id === 'CIR-CX-P') } as never, [D5x6]);
    expect(items).toEqual([expect.objectContaining({ tendidoId: 'CB-5x6', cable_id: D5x6.cable_id, declarado: D5x6 })]);
  });
});

// ─── B2 / negativos: nada declarado viaja al motor ───────────────────────────

describe('B2 — ningún declarado viaja al motor', () => {
  it('el tendido con declarado no se envía, con el motivo; el resto sí', () => {
    const t = proyecto();
    const r = circuitosParaMotor(t, ELS, idsMotor, excel([D5x6, D2x1]));
    expect(r.enviados.map((c) => c.cable_id)).toEqual(['PRY-SVALIO-CU-3x50']);
    const nd = r.noEnviados.find((x) => x.tendidoId === 'CB-5x6')!;
    expect(nd.declarado?.cable_id).toBe(D5x6.cable_id);
    expect(nd.motivo).toMatch(/declarado por el operador: no viaja al motor/);
    // Lo que sale de verdad hacia el motor: ningún OP-.
    const out = toMotorEntrada(t, { elements: ELS, idsCables: idsMotor, excel: excel([D5x6, D2x1]) });
    expect(JSON.stringify(out)).not.toMatch(/OP-/);
  });

  it('control negativo: si un declarado llegara a lo que se envía, falla en voz alta', () => {
    expect(() => asegurarSinDeclarados([{ circuito_id: 'X', cable_id: D5x6.cable_id }])).toThrow(/no puede viajar al motor/);
    const t = proyecto();
    const colado = { ...t, circuitos: [{ circuito_id: 'COLADO', funcion: 'potencia', cable_id: D5x6.cable_id, cantidad: 1, separado: false, recorrido: ['R1'] }] } as TrayInput;
    expect(() => toMotorEntrada(colado, { elements: ELS, idsCables: idsMotor, excel: excel([D5x6]) })).toThrow(/COLADO/);
  });

  it('un circuito a mano con un id declarado tampoco viaja', () => {
    let t = proyecto(false);
    const g = guardarCircuito(t, ELS, 'Mano', { equipo: 'A' }, { equipo: 'B' }, { cable_id: D5x6.cable_id, cantidad: 1, separado: false, funcion: 'potencia' });
    if (!g.ok) throw new Error(g.motivo);
    t = g.entrada;
    const r = circuitosParaMotor(t, ELS, undefined, excel([D5x6]));
    expect(r.enviados).toEqual([]);
  });
});

// ─── B2 / B3: la ocupación de la app ─────────────────────────────────────────

describe('B2/B3 — bandeja sin banda con declarados: la ocupación la calcula la app', () => {
  it('bandeja mixta: manda la app, dice por qué y nombra los declarados; cuenta lo del motor + los declarados de potencia', () => {
    const t = proyecto();
    const r = ocupacionDeLaApp(t, ELS, productos, D, 'R1', excel([D5x6, D2x1]));
    expect(r?.tipo).toBe('declarados'); // control negativo: si fuera null, la bandeja quedaría con la ocupación del motor
    const o = r!.o as Extract<NonNullable<ReturnType<typeof ocupacionConDeclarados>>, { calculada: true }>;
    expect(o.calculada).toBe(true);
    expect(o.mixta).toBe(true);
    expect(o.porque).toMatch(/Bandeja mixta.*manda el cálculo de la app/);
    expect(o.porque).toContain(`${D5x6.designacion} (${D5x6.cable_id})`);
    expect(o.porque).toContain(`${D2x1.designacion} (${D2x1.cable_id})`);
    const nPe = nPeEnR1(t);
    expect(nPe).toBeGreaterThan(0);
    const esperado = 2 * dCat('PRY-SVALIO-CU-3x50') + 1 * 17.5 + nPe * dCat(PE_CABLE_ID);
    expect(o.grupo.ancho_ocupado_mm).toBeCloseTo(esperado, 3);
    expect(o.grupo.cables.filter((k) => k.declarado).map((k) => k.cable_id)).toEqual([D5x6.cable_id]);
    // El control (2×1 declarado) no entra: D-11, como en el motor.
    expect(o.excluidos.some((x) => /CB-2x1/.test(x.nombre) && /D-11/.test(x.motivo))).toBe(true);
    expect(o.ancho_util_mm).toBeGreaterThan(0);
    expect(o.grupo.estado).toBe('CUMPLE');
  });

  it('sin declarados en la bandeja: null, manda el motor', () => {
    const t = proyecto();
    expect(ocupacionDeLaApp(t, ELS, productos, D, 'R1', excel([]))).toBeNull();
    // Un declarado que no casa con nada de lo que pasa tampoco cambia la bandeja.
    expect(ocupacionDeLaApp(t, ELS, productos, D, 'R1', excel([declarado({ n_conductores: 9, seccion_mm2: 95 })]))).toBeNull();
  });

  it('sólo declarados (sin catálogo): no es mixta, lo dice igual', () => {
    const t = proyecto(false);
    const o = ocupacionConDeclarados(t, ELS, productos, D, 'R1', excel([D5x6]))!;
    expect(o.calculada && o.mixta).toBe(false);
    expect(o.porque).toMatch(/^Manda el cálculo de la app/);
  });
});

// ─── B4 ──────────────────────────────────────────────────────────────────────

describe('B4 — declarado sin diámetro: sin ocupación calculable, y se dice cuál falta', () => {
  it('bandeja sin banda: el de potencia sin diámetro la deja sin ocupación', () => {
    const sinD = { ...D5x6, diametro_exterior_mm: null };
    const o = ocupacionConDeclarados(proyecto(), ELS, productos, D, 'R1', excel([sinD, D2x1]))!;
    expect(o.calculada).toBe(false);
    if (o.calculada) return;
    expect(o.faltan.map((d) => d.cable_id)).toEqual([sinD.cable_id]);
    expect(o.motivo).toMatch(/sin ocupación calculable/);
    expect(o.motivo).toContain(`${sinD.designacion} (${sinD.cable_id})`);
  });

  it('uno de mando sin diámetro en una bandeja sin banda no entra en la suma (D-11): no la bloquea, y se dice', () => {
    const sinD = { ...D2x1, diametro_exterior_mm: null };
    const o = ocupacionConDeclarados(proyecto(), ELS, productos, D, 'R1', excel([D5x6, sinD]))!;
    expect(o.calculada).toBe(true);
    if (!o.calculada) return;
    expect(o.excluidos.find((x) => /CB-2x1/.test(x.nombre))?.motivo).toMatch(/D-11.*no tiene diámetro exterior/);
  });

  it('el circuito lo lista como lo que le falta', () => {
    const t = proyecto();
    const c = ((t as Record<string, unknown>).circuitos_ws as { id: string }[]).find((x) => x.id === 'CIR-CX-P') as never;
    expect(faltaConExcel(t, CAT, CABLES, c, undefined, [{ ...D5x6, diametro_exterior_mm: null }])).toEqual([expect.stringMatching(/CB-5x6 lleva un cable declarado sin diámetro exterior/)]);
    expect(faltaConExcel(t, CAT, CABLES, c, undefined, [D5x6])).toEqual([]);
  });
});

// ─── Bandeja segregada con declarados ────────────────────────────────────────

describe('bandeja segregada: los declarados entran en su grupo, con su diámetro', () => {
  const conBanda = (t: TrayInput) => {
    const r = colocarBanda(t, 'R1', 'SAM_BDS090Z', snapshot.COMPATIBILIDADES, productos);
    if (!r.ok) throw new Error(r.motivo);
    return r.entrada;
  };
  it('el 2×1 declarado entra en mando; el 5×6, en potencia', () => {
    const o = ocupacionSegregada(conBanda(proyecto()), ELS, productos, D, 'R1', excel([D5x6, D2x1]))!;
    expect(o.calculada).toBe(true);
    if (!o.calculada) return;
    const ctl = o.grupos.find((g) => g.grupo === 'control')!;
    expect(ctl.n_cables).toBe(3);
    expect(ctl.ancho_ocupado_mm).toBeCloseTo(3 * 7.2, 3);
    expect(o.declarados.map((d) => d.cable_id).sort()).toEqual([D5x6.cable_id, D2x1.cable_id].sort());
    // La segregada la sigue calculando la app por la banda (no por «declarados»).
    expect(ocupacionDeLaApp(conBanda(proyecto()), ELS, productos, D, 'R1', excel([D5x6, D2x1]))?.tipo).toBe('segregada');
  });
  it('un declarado sin diámetro deja la segregada sin ocupación, nombrándolo', () => {
    const sinD = { ...D2x1, diametro_exterior_mm: null };
    const o = ocupacionSegregada(conBanda(proyecto()), ELS, productos, D, 'R1', excel([D5x6, sinD]))!;
    expect(o.calculada).toBe(false);
    if (o.calculada) return;
    expect(o.motivo).toContain(`${sinD.designacion} (${sinD.cable_id})`);
  });
});

// ─── B5 ──────────────────────────────────────────────────────────────────────

describe('B5 — «tendidos de potencia sin cable» cuenta sólo los que tampoco tienen declarado', () => {
  it('sin declarado cuenta; con declarado sale de esa cuenta y va aparte', () => {
    const t = proyecto();
    const sin = circuitosParaMotor(t, ELS, idsMotor, excel([])).noEnviados;
    expect(sin.filter((x) => x.potenciaSinCable).map((x) => x.tendidoId)).toEqual(['CB-5x6']);
    const con = circuitosParaMotor(t, ELS, idsMotor, excel([D5x6])).noEnviados;
    expect(con.filter((x) => x.potenciaSinCable)).toEqual([]);
    expect(con.filter((x) => x.declarado).map((x) => x.tendidoId)).toEqual(['CB-5x6']);
  });
});

// ─── Inspector de la pieza y copia del proyecto ──────────────────────────────

describe('por esta bandeja y copia del proyecto', () => {
  it('la Σ de diámetros usa el declarado; sin diámetro queda fuera, con el motivo', () => {
    const t = proyecto();
    const p = porBandeja(t, ELS, CAT, CABLES, 'R1', [D5x6, D2x1]);
    expect(p.sumas.potencia.diametrosMm).toBeCloseTo(2 * dCat('PRY-SVALIO-CU-3x50') + 17.5, 3);
    expect(p.sumas.resto.diametrosMm).toBeCloseTo(3 * 7.2, 3);
    const q = porBandeja(t, ELS, CAT, CABLES, 'R1', [{ ...D5x6, diametro_exterior_mm: null }]);
    const item = q.circuitos.flatMap((c) => c.items).find((k) => k.tendidoId === 'CB-5x6')!;
    expect(item.sumaMm).toBeNull();
    expect(item.fueraDeLaSuma).toMatch(/no tiene diámetro exterior/);
  });

  it('la copia lleva sólo los declarados que lleva algún tendido (elegidos o propuestos)', () => {
    const t3x50 = td('CB-3x50', 'CX-P', { conductoresPorUnidad: 3, seccionMm2: 50 });
    const copia = declarado({ designacion: 'Copia 3 × 50', n_conductores: 3, seccion_mm2: 50 });
    const ninguno = declarado({ n_conductores: 9, seccion_mm2: 95 });
    const tendidos = [T_5x6, t3x50];
    // 5×6: único candidato → usado. Copia 3×50: compite con el catálogo, sin elegir → no usado.
    expect(declaradosUsados([D5x6, copia, ninguno], tendidos, CABLES, declaradoOf(null)).map((d) => d.cable_id)).toEqual([D5x6.cable_id]);
    const e = elegirCable({} as TrayInput, 'CB-3x50', copia.cable_id);
    expect(declaradosUsados([D5x6, copia, ninguno], tendidos, CABLES, declaradoOf(e)).map((d) => d.cable_id)).toEqual([D5x6.cable_id, copia.cable_id]);
  });
});
