/**
 * cupsTestChain — regresión del escenario aditivo #224.
 *
 * Qué defiende:
 *   - `addCupsTestChains` es ADITIVA: nada del input entrante se reescribe.
 *   - Es IDEMPOTENTE: segunda invocación es no-op.
 *   - El output pasa `assertInput` (incluyendo perpendicularidad y unitariedad).
 *   - Expone piezas BASE (300) y VARIANTE (450) con los IDs declarados.
 *   - Cada CUPS persiste orientacion_seccion_ws en sus dos bocas, consumible
 *     por `getFreePorts` sin fallback heurístico.
 */
import { describe, expect, it } from 'vitest';
import { addCupsTestChains, hasCupsScenario, CUPS_SCENARIO_IDS } from '../cupsTestChain';
import { assertInput } from '../../tray/model';
import { getFreePorts } from '../routingRules';
import type { TrayInput } from '../../tray/model';

function emptyInput(): TrayInput {
  return {
    version_contrato: 'trazado/1',
    piezas: [],
    conexiones: [],
    circuitos: [],
    soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  };
}

describe('addCupsTestChains — escenario aditivo #224', () => {
  it('agrega 6 piezas y 4 conexiones a un input vacío', () => {
    const result = addCupsTestChains(emptyInput());
    expect(result.piezas).toHaveLength(6);
    expect(result.conexiones).toHaveLength(4);
    const ids = result.piezas.map((p) => p.instancia_id).sort();
    expect(ids).toContain(CUPS_SCENARIO_IDS.base.trps1);
    expect(ids).toContain(CUPS_SCENARIO_IDS.base.cups);
    expect(ids).toContain(CUPS_SCENARIO_IDS.base.trps2);
    expect(ids).toContain(CUPS_SCENARIO_IDS.variant.trps1);
    expect(ids).toContain(CUPS_SCENARIO_IDS.variant.cups);
    expect(ids).toContain(CUPS_SCENARIO_IDS.variant.trps2);
  });

  it('es aditiva: no muta las piezas existentes del input entrante', () => {
    const preExisting: TrayInput = {
      ...emptyInput(),
      piezas: [
        {
          instancia_id: 'user-piece-1',
          producto_id: 'SAM_TRPS-300-22-Z',
          longitud_mm: 2500,
          puertos: {
            P1: { posicion_mm: [10, 20, 30], direccion: [-1, 0, 0], orientacion_seccion_ws: [0, 0, 1] },
            P2: { posicion_mm: [2510, 20, 30], direccion: [1, 0, 0], orientacion_seccion_ws: [0, 0, 1] },
          },
        },
      ],
    };
    const preExistingCopy = structuredClone(preExisting);
    const result = addCupsTestChains(preExisting);
    // La pieza original sigue ahí y sin tocar.
    expect(result.piezas[0]).toEqual(preExistingCopy.piezas[0]);
    // Y se agregaron las seis piezas del escenario.
    expect(result.piezas).toHaveLength(7);
    // El input original no se mutó (identidad).
    expect(preExisting.piezas).toHaveLength(1);
    expect(preExisting.piezas[0]).toEqual(preExistingCopy.piezas[0]);
  });

  it('es idempotente: dos invocaciones consecutivas no duplican', () => {
    const first = addCupsTestChains(emptyInput());
    const second = addCupsTestChains(first);
    expect(second).toBe(first); // retorna el mismo objeto (no-op real)
    expect(second.piezas).toHaveLength(6);
  });

  it('el resultado pasa assertInput (unitariedad + perpendicularidad)', () => {
    const result = addCupsTestChains(emptyInput());
    expect(() => assertInput(result)).not.toThrow();
  });

  it('cada CUPS persiste orientacion_seccion_ws en P1_horizontal y P2_vertical', () => {
    const result = addCupsTestChains(emptyInput());
    for (const cupsId of [CUPS_SCENARIO_IDS.base.cups, CUPS_SCENARIO_IDS.variant.cups]) {
      const cups = result.piezas.find((p) => p.instancia_id === cupsId)!;
      expect(cups.puertos.P1_horizontal.orientacion_seccion_ws, `${cupsId}.P1_horizontal`).toBeDefined();
      expect(cups.puertos.P2_vertical.orientacion_seccion_ws, `${cupsId}.P2_vertical`).toBeDefined();
    }
  });

  it('getFreePorts expone las bocas P2 libres de los TRPS2 (final de cada cadena)', () => {
    const result = addCupsTestChains(emptyInput());
    const free = getFreePorts(result.piezas, result.conexiones);
    const freeIds = free.map((f) => `${f.pieceId}/${f.portName}`);
    expect(freeIds).toContain(`${CUPS_SCENARIO_IDS.base.trps2}/P2`);
    expect(freeIds).toContain(`${CUPS_SCENARIO_IDS.variant.trps2}/P2`);
  });

  it('hasCupsScenario devuelve true tras cargar y false en un input virgen', () => {
    const empty = emptyInput();
    expect(hasCupsScenario(empty)).toBe(false);
    const loaded = addCupsTestChains(empty);
    expect(hasCupsScenario(loaded)).toBe(true);
  });

  it('preserva campos no-piezas del input (circuitos, soportes, pe)', () => {
    const input: TrayInput = {
      ...emptyInput(),
      circuitos: [
        { circuito_id: 'C1', funcion: 'fuerza', cable_id: 'CAB', cantidad: 1, separado: false, recorrido: [] },
      ],
      pe: { seccion_requerida_mm2: 16, cable_id: 'PE-16', origen_requisito: 'user', conductores: [] },
    };
    const result = addCupsTestChains(input);
    expect(result.circuitos).toEqual(input.circuitos);
    expect(result.pe).toEqual(input.pe);
  });
});
