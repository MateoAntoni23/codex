// @vitest-environment jsdom
/**
 * Biblioteca de conductores, parte A (encargo del 2026-11-15): ficha y validación,
 * orígenes, duplicado, persistencia local, guía de qué cargar con el Excel de ejemplo y
 * los declarados en el archivo de proyecto.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { construirCatalogoCables, idDeCable, type CableCatalogo } from '../../workspace/cables/catalogoCables';
import { parseWorkbook } from '../../import/parser';
import type { ImportedCatalog, TendidoImportado } from '../../import/types';
import {
  BORRADOR_VACIO, duplicarDeCatalogo, entradasBiblioteca, esCableDeclarado, noCalculable, validarBorrador,
  type BorradorDeclarado, type CableDeclarado,
} from '../biblioteca';
import { CLAVE_CONDUCTORES, PREFIJO_RESPALDO_CONDUCTORES, useConductoresStore } from '../store';
import { declaradosUsados, tendidosPorCable, tendidosSinCable } from '../guia';
import { describirDiferencia, diferenciaConductores, leerBloqueConductores } from '../bloqueArchivo';
import { useWorkspaceStore } from '../../workspace/useWorkspaceStore';
import { useTrayStore } from '../../tray/store';
import { useCatalogConfigStore } from '../../configurator/catalogConfigStore';
import { emptyTrayInput } from '../../project/emptyProject';
import { _resetBootForTests, buildProjectCopy, openProjectText, type LibraryChoice, type LibraryConflict } from '../../project/projectSession';
import { importWorkspace } from '../../workspace/workspaceFile';

const DS = ['prysmian_sintenax_valio_2020', 'prysmian_superastic_flex_2026'].map((f) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../vendor/motor_bandejas/datos/cables/${f}.json`), 'utf-8')));
const IDS = DS.flatMap((d) => d.tablas.flatMap((t: { filas: [string][] }) => t.filas.map((r) => idDeCable(d.dataset_id, t as never, r[0])!)));
const rc = construirCatalogoCables(DS, IDS);
if (!rc.ok) throw new Error(rc.motivo);
const CATALOGO: readonly CableCatalogo[] = rc.cables;

let EXCEL: ImportedCatalog;
let TENDIDOS: TendidoImportado[];
beforeAll(async () => {
  const buf = readFileSync(resolve(__dirname, '../../import/fixtures/ELS-IMP-EQCX_v1.0_Rev0.xlsx'));
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const r = await parseWorkbook(ab, 'ELS-IMP-EQCX_v1.0_Rev0.xlsx');
  if (!r.catalog) throw new Error('el Excel de ejemplo no se pudo leer');
  EXCEL = r.catalog;
  TENDIDOS = r.catalog.tendidos;
});

const borrador = (extra: Partial<BorradorDeclarado>): BorradorDeclarado => ({ ...BORRADOR_VACIO, designacion: 'X', n_conductores: '5', seccion_mm2: '6', ...extra });
let n = 0;
const declarado = (extra: Partial<CableDeclarado> = {}): CableDeclarado => ({
  cable_id: `OP-test-${++n}`, designacion: 'Sintenax 5 × 6', tipo: 'multipolar', material: 'cobre', n_conductores: 5, seccion_mm2: 6,
  diametro_exterior_mm: 17.5, masa_kg_km: 520, procedencia: { declaradoEl: '2026-11-15T00:00:00.000Z' }, ...extra,
});

beforeEach(() => {
  localStorage.clear();
  useConductoresStore.setState({ cables: [], errorLectura: null, hidratado: false });
});

describe('ficha de un cable declarado (A3)', () => {
  it('diámetro y masa pueden quedar vacíos; la ficha dice qué no se va a poder calcular', () => {
    const r = validarBorrador(borrador({ diametro_exterior_mm: '', masa_kg_km: '' }));
    if (!r.ok) throw new Error(r.errores.join('; '));
    expect(r.datos.diametro_exterior_mm).toBeNull();
    expect(r.datos.masa_kg_km).toBeNull();
    expect(noCalculable(r.datos)).toEqual([
      'sin diámetro exterior no hay ocupación de bandeja',
      'sin masa por km no hay carga por pieza ni vanos',
    ]);
    expect(noCalculable({ diametro_exterior_mm: 12, masa_kg_km: null })).toEqual(['sin masa por km no hay carga por pieza ni vanos']);
    expect(noCalculable({ diametro_exterior_mm: 12, masa_kg_km: 300 })).toEqual([]);
  });

  it('no se inventa nada: sin diámetro queda null, no una estimación desde la sección', () => {
    const r = validarBorrador(borrador({ seccion_mm2: '10', diametro_exterior_mm: '' }));
    expect(r.ok && r.datos.diametro_exterior_mm).toBeNull();
  });

  it('acepta coma decimal; rechaza lo que falta o no tiene sentido, con el motivo', () => {
    const ok = validarBorrador(borrador({ seccion_mm2: '1,5', diametro_exterior_mm: '9,2' }));
    expect(ok.ok && [ok.datos.seccion_mm2, ok.datos.diametro_exterior_mm]).toEqual([1.5, 9.2]);
    const mal = validarBorrador({ ...BORRADOR_VACIO, tipo: 'unipolar', n_conductores: '3', seccion_mm2: '-1', diametro_exterior_mm: '0' });
    expect(mal.ok).toBe(false);
    if (!mal.ok) {
      expect(mal.errores).toContain('falta la designación');
      expect(mal.errores).toContain('un unipolar tiene 1 conductor');
      expect(mal.errores).toContain('la sección tiene que ser un número mayor que 0');
      expect(mal.errores.some((e) => /diámetro exterior/.test(e))).toBe(true);
    }
    const multi1 = validarBorrador(borrador({ n_conductores: '1' }));
    expect(!multi1.ok && multi1.errores).toEqual(['un multipolar tiene 2 conductores o más']);
  });
});

describe('orígenes y duplicado (A2, A4)', () => {
  it('los 113 del catálogo del motor son «catálogo»; los declarados, «operador»', () => {
    expect(CATALOGO).toHaveLength(113);
    const e = entradasBiblioteca(CATALOGO, [declarado()]);
    expect(e.filter((c) => c.origen === 'catalogo')).toHaveLength(113);
    expect(e.filter((c) => c.origen === 'operador').map((c) => c.declarado?.designacion)).toEqual(['Sintenax 5 × 6']);
    expect(e.every((c) => (c.origen === 'operador') === c.cable_id.startsWith('OP-'))).toBe(true);
  });

  it('duplicar un cable del catálogo: nace declarado, dice de cuál salió, conserva sus datos publicados', () => {
    const fuente = CATALOGO.find((c) => c.cable_id === 'PRY-SVALIO-CU-4x10')!;
    const r = duplicarDeCatalogo(fuente, new Date('2026-11-15T12:00:00Z'));
    if (!r.ok) throw new Error(r.motivo);
    expect(r.cable.cable_id).toMatch(/^OP-/);
    expect(r.cable.cable_id).not.toBe(fuente.cable_id);
    expect(r.cable.procedencia).toEqual({
      declaradoEl: '2026-11-15T12:00:00.000Z',
      duplicadoDe: { cable_id: 'PRY-SVALIO-CU-4x10', texto: expect.stringContaining('4 × 10 mm²') },
    });
    expect([r.cable.n_conductores, r.cable.seccion_mm2, r.cable.material]).toEqual([4, 10, 'cobre']);
    expect([r.cable.diametro_exterior_mm, r.cable.masa_kg_km]).toEqual([fuente.diametro_exterior_mm, fuente.masa_kg_km]);
    expect(esCableDeclarado(r.cable)).toBe(true);
  });

  it('una formación con conductor reducido no se duplica (la ficha es de conductores iguales), con motivo', () => {
    const reducido = CATALOGO.find((c) => c.formacion.includes('/'))!;
    const r = duplicarDeCatalogo(reducido);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/conductor reducido/);
  });
});

describe('persistencia: la biblioteca es del operador (localStorage)', () => {
  it('cargar, editar y borrar quedan en localStorage; al hidratar de nuevo se encuentran', () => {
    const s = useConductoresStore.getState();
    s.hidratar();
    const c = declarado({ diametro_exterior_mm: null });
    expect(s.agregar(c)).toBeNull();
    expect(useConductoresStore.getState().actualizar({ ...c, diametro_exterior_mm: 18.2 })).toBeNull();
    useConductoresStore.setState({ cables: [], hidratado: false });
    useConductoresStore.getState().hidratar();
    expect(useConductoresStore.getState().cables).toEqual([{ ...c, diametro_exterior_mm: 18.2 }]);
    expect(useConductoresStore.getState().borrar(c.cable_id)).toBeNull();
    expect(JSON.parse(localStorage.getItem(CLAVE_CONDUCTORES)!).cables).toEqual([]);
  });

  it('si no se pudo escribir, el estado no cambia y se dice por qué', () => {
    useConductoresStore.getState().hidratar();
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('cuota'); });
    const err = useConductoresStore.getState().agregar(declarado());
    set.mockRestore();
    expect(err).toMatch(/no se pudo guardar.*cuota/);
    expect(useConductoresStore.getState().cables).toEqual([]);
  });

  it('una biblioteca local ilegible no se pisa: se informa y no se escribe', () => {
    localStorage.setItem(CLAVE_CONDUCTORES, '{roto');
    useConductoresStore.getState().hidratar();
    expect(useConductoresStore.getState().errorLectura).toMatch(/no es JSON válido/);
    expect(useConductoresStore.getState().agregar(declarado())).toMatch(/no se escribe encima/);
    expect(localStorage.getItem(CLAVE_CONDUCTORES)).toBe('{roto');
  });

  it('fusionar (adoptar los de un archivo) agrega y reemplaza por id; nunca borra', () => {
    const a = declarado(); const b = declarado();
    useConductoresStore.getState().hidratar();
    useConductoresStore.getState().agregar(a);
    useConductoresStore.getState().agregar(b);
    const b2 = { ...b, designacion: 'otra' }; const c = declarado();
    expect(useConductoresStore.getState().fusionar([b2, c])).toBeNull();
    expect(useConductoresStore.getState().cables.map((x) => x.designacion === 'otra' ? 'b2' : x.cable_id)).toEqual([a.cable_id, 'b2', c.cable_id]);
  });
});

describe('guía de qué cargar, con el Excel de ejemplo (A6)', () => {
  const resumen = (g: ReturnType<typeof tendidosSinCable>) =>
    Object.fromEntries(g.combinaciones.map((k) => [`${k.naturaleza} ${k.conductores}x${k.seccion_mm2}`, k.tendidoIds.length]));

  it('exactamente las siete combinaciones, con cuántos tendidos destraba cada una', () => {
    const g = tendidosSinCable(TENDIDOS, CATALOGO, []);
    expect(resumen(g)).toEqual({
      'CABLE_MULTIPOLAR 2x1': 87,
      'CABLE_MULTIPOLAR 3x1': 23,
      'CABLE_MULTIPOLAR 5x6': 7,
      'CABLE_MULTIPOLAR 4x1': 4,
      'CABLE_MULTIPOLAR 27x1': 2,
      'CABLE_MULTIPOLAR 5x10': 1,
      'CABLE_MULTIPOLAR 7x1': 1,
    });
    // 8 de potencia (5 conductores) + 117 de 1 mm² = 125.
    expect(g.combinaciones.reduce((s, k) => s + k.tendidoIds.length, 0)).toBe(125);
    // Datos y tubos no son un conductor que se pueda declarar: aparte, con el motivo.
    expect(Object.fromEntries(g.fuera.map((f) => [f.motivo, f.tendidoIds.length]))).toEqual({
      'cable de datos: el catálogo del motor no tiene cables de datos': 7,
      'tubo: no es un cable': 42,
    });
    expect(g.combinaciones.every((k) => k.cubiertaPor.length === 0)).toBe(true);
  });

  it('un declarado 5×6 casa con los 7 tendidos 5×6 (PE dentro de 6 mm²) y con ninguno de 5×10', () => {
    const d = declarado();
    const g = tendidosSinCable(TENDIDOS, CATALOGO, [d]);
    const k56 = g.combinaciones.find((k) => k.conductores === 5 && k.seccion_mm2 === 6)!;
    const k510 = g.combinaciones.find((k) => k.conductores === 5 && k.seccion_mm2 === 10)!;
    expect(k56.cubiertaPor).toEqual([{ cable_id: d.cable_id, designacion: d.designacion, tendidos: 7 }]);
    expect(k510.cubiertaPor).toEqual([]); // control negativo
    expect(tendidosPorCable(TENDIDOS, CATALOGO, [d]).get(d.cable_id)).toBe(7);
  });

  it('cuántos tendidos casan con cada cable del catálogo: misma regla que el casamiento de los tendidos', () => {
    const m = tendidosPorCable(TENDIDOS, CATALOGO, []);
    const total = TENDIDOS.length;
    expect([...m.values()].every((v) => v > 0 && v <= total)).toBe(true);
    expect(m.get('PRY-SVALIO-CU-5x6')).toBeUndefined(); // no existe en el catálogo
    // Un 2×1 declarado destraba los 87.
    const d21 = declarado({ n_conductores: 2, seccion_mm2: 1 });
    expect(tendidosPorCable(TENDIDOS, CATALOGO, [d21]).get(d21.cable_id)).toBe(87);
  });

  it('el proyecto usa los declarados que casan con algún tendido de su Excel', () => {
    const usa = declarado(); const no = declarado({ n_conductores: 9, seccion_mm2: 95 });
    expect(declaradosUsados([usa, no], TENDIDOS).map((c) => c.cable_id)).toEqual([usa.cable_id]);
  });
});

describe('declarados en el archivo de proyecto (A5)', () => {
  const choose = (c: LibraryChoice) => vi.fn(async (_x: LibraryConflict) => c);
  const resetProyecto = () => {
    useCatalogConfigStore.setState({ overrides: {}, approvals: {}, aporteOverrides: {}, hydrated: true });
    useWorkspaceStore.getState().reset();
    useTrayStore.getState().importEdit(emptyTrayInput());
    _resetBootForTests();
  };
  const copiaCon = (cables: CableDeclarado[]) => {
    resetProyecto();
    useWorkspaceStore.setState({ importedCatalog: EXCEL });
    useConductoresStore.setState({ cables, hidratado: true, errorLectura: null });
    return buildProjectCopy().json;
  };

  it('la copia lleva solo los declarados que el proyecto usa; abrirla devuelve los mismos', () => {
    const usa = declarado(); const no = declarado({ n_conductores: 9, seccion_mm2: 95 });
    const json = copiaCon([usa, no]);
    const f = JSON.parse(json);
    expect(f.conductoresDeclarados).toEqual({ version: 'codex:conductores/1', cables: [usa] });
    expect(f.fileVersion).toBe(3); // campo opcional: la versión del archivo no cambia
    expect(importWorkspace(json).conductoresDeclarados).toEqual([usa]);
  });

  it('sin declarados usados, el archivo no lleva el bloque y abrirlo no toca la biblioteca local', async () => {
    const json = copiaCon([]);
    expect(JSON.parse(json).conductoresDeclarados).toBeUndefined();
    const local = declarado();
    useConductoresStore.setState({ cables: [local] });
    const ch = choose('adopt');
    expect(await openProjectText(json, 'p.json', ch)).toMatchObject({ status: 'opened', conductoresAdoptados: false });
    expect(ch).not.toHaveBeenCalled();
    expect(useConductoresStore.getState().cables).toEqual([local]);
  });

  it('otra máquina sin esos cables: se pregunta; adoptar los agrega (con copia de la local) y no borra nada', async () => {
    const usa = declarado();
    const json = copiaCon([usa]);
    // «Otra máquina»: biblioteca local con un cable propio y sin el del archivo.
    localStorage.clear();
    const propio = declarado({ n_conductores: 3, seccion_mm2: 1, designacion: 'propio' });
    useConductoresStore.setState({ cables: [], hidratado: false, errorLectura: null });
    useConductoresStore.getState().hidratar();
    useConductoresStore.getState().agregar(propio);
    const ch = choose('adopt');
    const r = await openProjectText(json, 'p.json', ch);
    expect(r).toMatchObject({ status: 'opened', conductoresAdoptados: true });
    expect(ch).toHaveBeenCalledTimes(1);
    const conflicto = ch.mock.calls[0][0];
    expect(conflicto.kind).toBe('conductores');
    expect(conflicto.differences).toEqual([`Cable declarado que no está en este equipo: ${usa.designacion} (${usa.cable_id})`]);
    expect(useConductoresStore.getState().cables.map((c) => c.cable_id)).toEqual([propio.cable_id, usa.cable_id]);
    const respaldo = Object.keys(localStorage).find((k) => k.startsWith(PREFIJO_RESPALDO_CONDUCTORES))!;
    expect(JSON.parse(localStorage.getItem(respaldo)!).cables).toEqual([propio]);
  });

  it('seguir con la local no la cambia; cancelar no abre nada', async () => {
    const usa = declarado();
    const json = copiaCon([usa]);
    useConductoresStore.setState({ cables: [] });
    expect(await openProjectText(json, 'p.json', choose('local'))).toMatchObject({ status: 'opened', conductoresAdoptados: false });
    expect(useConductoresStore.getState().cables).toEqual([]);
    resetProyecto();
    expect(await openProjectText(json, 'p.json', choose('cancel'))).toEqual({ status: 'cancelled' });
    expect(useWorkspaceStore.getState().importedCatalog).toBeNull();
    expect(useConductoresStore.getState().cables).toEqual([]);
  });

  it('mismo id con otros datos: se informa como diferencia', () => {
    const a = declarado();
    const d = diferenciaConductores([a], [{ ...a, diametro_exterior_mm: 99 }]);
    expect(d.distintos).toHaveLength(1);
    expect(describirDiferencia(d)[0]).toMatch(/con otros datos/);
    expect(diferenciaConductores([a], [a])).toEqual({ faltanLocal: [], distintos: [] });
  });

  it('un bloque mal formado no se abre a medias: error', () => {
    expect(leerBloqueConductores(undefined)).toBeNull();
    expect(() => leerBloqueConductores({ version: 'codex:conductores/9', cables: [] })).toThrow(/versión no soportada/);
    expect(() => leerBloqueConductores({ version: 'codex:conductores/1', cables: [{ cable_id: 'PRY-SVALIO-CU-3x50' }] })).toThrow(/inválidos/);
    const a = declarado();
    expect(() => leerBloqueConductores({ version: 'codex:conductores/1', cables: [a, a] })).toThrow(/repetidos/);
  });
});
