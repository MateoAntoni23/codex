// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { aEjesApp, cajaEnApp, decodificarMalla, matrizArchivo, validarParteCivil, VERSION_BLOQUE_CIVIL, type ArchivoCivil, type MallaCivil } from '../modelo';
import { useParteCivilStore } from '../parteCivilStore';
import { avisoDePeso, UMBRAL_TRIANGULOS_CIVIL } from '../peso';
import { DEFAULT_PROJECT_META, exportWorkspace, importWorkspace } from '../../workspace/workspaceFile';

const b64 = (a: Float32Array | Uint32Array) => Buffer.from(a.buffer).toString('base64');

/** Una columna de 300 × 300 × 6000 exportada con la altura en Y (como SolidWorks). */
function mallaYup(): MallaCivil {
  const p = new Float32Array([0, 0, 0, 300, 0, 0, 300, 6000, 0, 0, 6000, 0, 0, 0, -300, 300, 0, -300, 300, 6000, -300, 0, 6000, -300]);
  const i = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
  return {
    version: 'codex:civilMalla/1', unidades: { codigo: 'mm', texto: 'milímetro (SI_UNIT .MILLI. .METRE.)' }, solidos: 1, vertices: 8,
    triangulos: 4, tolerancia_mm: 2, caja_mm: { min: [0, 0, -300], max: [300, 6000, 0] }, posiciones: b64(p), indices: b64(i),
  };
}

const archivo = (over: Partial<ArchivoCivil> = {}): ArchivoCivil => ({
  id: 'c1', nombre: 'PB-columnas.stp', tipo: 'columna', nivel: { nombre: 'PB', cotaMm: 0 }, ejeVertical: 'Y',
  desplazamientoMm: [0, 0, 0], giroDeg: 0, malla: mallaYup(), importadoEn: '2026-11-15T00:00:00Z', version: 1, ...over,
});

describe('ejes declarados por el operador', () => {
  it('Y como altura: una columna exportada con la altura en Y queda parada (alto 6000)', () => {
    expect(cajaEnApp(mallaYup(), 'Y')).toMatchObject({ ancho: 300, fondo: 300, alto: 6000 });
    // Con Z (lo de la app) quedaría acostada: el alto sería 300. Es el control que ve el operador.
    expect(cajaEnApp(mallaYup(), 'Z').alto).toBe(300);
    expect(aEjesApp('Y', [1, 2, 3])).toEqual([1, -3, 2]);
    expect(aEjesApp('X', [1, 2, 3])).toEqual([2, 3, 1]);
    expect(aEjesApp('Z', [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('posición: ejes, giro en planta alrededor del origen y desplazamiento', () => {
    const m = matrizArchivo({ ejeVertical: 'Z', giroDeg: 90, desplazamientoMm: [1000, 2000, 300] });
    // Columna mayor: aplica a (1, 0, 0) → giro 90° → (0, 1, 0) + desplazamiento.
    const p = [1, 0, 0];
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    expect([x, y, z].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1000, 2001, 300]);
  });

  it('decodifica la malla (posiciones e índices)', () => {
    const d = decodificarMalla(mallaYup());
    expect(d.posiciones).toHaveLength(24);
    expect(Array.from(d.indices.slice(0, 3))).toEqual([0, 1, 2]);
  });
});

describe('importar, reemplazar y quitar', () => {
  beforeEach(() => useParteCivilStore.getState().cargar([]));

  it('no se confirma sin tipo, nivel y cota; con todo, se suma con las coordenadas del archivo', () => {
    const st = useParteCivilStore.getState();
    st.setPendiente({ modo: 'nuevo', nombreArchivo: 'PB-columnas.stp', malla: mallaYup(), tipo: null, nivel: { nombre: '', cotaMm: null }, ejeVertical: 'Z' });
    expect(useParteCivilStore.getState().confirmarPendiente()).toBeNull();
    st.editarPendiente({ tipo: 'columna', nivel: { nombre: 'PB' } });
    expect(useParteCivilStore.getState().confirmarPendiente()).toBeNull(); // falta la cota
    st.editarPendiente({ nivel: { cotaMm: 0 }, ejeVertical: 'Y' });
    const id = useParteCivilStore.getState().confirmarPendiente();
    expect(id).not.toBeNull();
    const a = useParteCivilStore.getState().archivos[0];
    expect(a).toMatchObject({ tipo: 'columna', nivel: { nombre: 'PB', cotaMm: 0 }, ejeVertical: 'Y', desplazamientoMm: [0, 0, 0], giroDeg: 0, version: 1 });
  });

  it('reemplazar conserva tipo, nivel, eje y posición; cambia sólo la geometría', () => {
    useParteCivilStore.getState().cargar([archivo({ desplazamientoMm: [500, 0, 0], giroDeg: 15 })]);
    const nueva = { ...mallaYup(), triangulos: 8, solidos: 2 };
    useParteCivilStore.getState().setPendiente({ modo: 'reemplazar', reemplazaId: 'c1', nombreArchivo: 'PB-columnas-v2.stp', malla: nueva, tipo: 'columna', nivel: { nombre: 'PB', cotaMm: 0 }, ejeVertical: 'Y' });
    expect(useParteCivilStore.getState().confirmarPendiente()).toBe('c1');
    const a = useParteCivilStore.getState().archivos[0];
    expect(a).toMatchObject({ id: 'c1', nombre: 'PB-columnas-v2.stp', tipo: 'columna', nivel: { nombre: 'PB', cotaMm: 0 }, ejeVertical: 'Y', desplazamientoMm: [500, 0, 0], giroDeg: 15, version: 2 });
    expect(a.malla.triangulos).toBe(8);
    useParteCivilStore.getState().quitar('c1');
    expect(useParteCivilStore.getState().archivos).toEqual([]);
  });
});

describe('archivo de proyecto (versión 4)', () => {
  const TRAY = { version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [], pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: 'test', conductores: [] } };

  it('la parte civil viaja en la copia y vuelve igual; fuera del trazado', () => {
    const json = exportWorkspace([], [], DEFAULT_PROJECT_META, TRAY as never, undefined, null, undefined, [archivo()]);
    const f = JSON.parse(json);
    expect(f.fileVersion).toBe(4);
    expect(f.parteCivil.version).toBe(VERSION_BLOQUE_CIVIL);
    expect(JSON.stringify(f.trayInput)).not.toMatch(/civil|PB-columnas/);
    const r = importWorkspace(json);
    expect(r.parteCivil?.archivos).toEqual([archivo()]);
  });

  it('un bloque dañado no se abre, con motivo', () => {
    expect(() => validarParteCivil({ version: VERSION_BLOQUE_CIVIL, archivos: [{ ...archivo(), tipo: 'escalera' }] })).toThrow(/tipo inválido/);
    expect(() => validarParteCivil({ version: 'otra', archivos: [] })).toThrow(/versión no soportada/);
    expect(validarParteCivil(undefined)).toBeNull();
  });
});

describe('aviso de peso (A5)', () => {
  it('por encima del umbral avisa con el número, el porqué y la sugerencia de simplificar', () => {
    expect(avisoDePeso(UMBRAL_TRIANGULOS_CIVIL - 100, 100)).toBeNull();
    const a = avisoDePeso(900_000, 300_000)!;
    expect(a).toMatch(/1\.200\.000 triángulos/);
    expect(a).toMatch(/este archivo: 300\.000/);
    expect(a).toMatch(/MB de archivo/);
    expect(a).toMatch(/simplificar el modelo/);
    expect(a).toMatch(/sin redondeos/);
  });
});
