/**
 * orientacionSeccionWsContract — contrato del campo D7 en dos bordes del sistema.
 *
 * El campo `orientacion_seccion_ws` (v_dir mundial de la boca) es un invariante
 * del frontend: `routingRules.getFreePorts` lo consume directamente y la
 * heurística `computePortSectionUp` lo usa como fallback cuando no está
 * persistido (ver docs §D7). Este contrato se defiende en dos bordes:
 *
 *   #219. `assertInput` (borde de validación interna) exige que el vector sea
 *         (a) unitario y (b) perpendicular a `direccion`. Si falla, es una
 *         regresión introducida por quien construyó la pieza — no un dato
 *         válido degradado.
 *
 *   #222. `transport` (borde HTTP al motor) NO debe emitir el campo: el
 *         contrato `trazado/1` valida `_dict({"posicion_mm","direccion"})` y
 *         rechaza con "claves desconocidas". El stripper intermedio debe
 *         eliminarlo antes de serializar, preservando el resto.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { assertInput } from '../model';
import type { TrayInput } from '../model';
import { transport } from '../client';

function baseInput(): TrayInput {
  return {
    version_contrato: 'trazado/1',
    piezas: [
      {
        instancia_id: 'R1',
        producto_id: 'SAM_TRPS-300-22-Z',
        longitud_mm: 3000,
        puertos: {
          P1: { posicion_mm: [0, 0, 25], direccion: [-1, 0, 0], orientacion_seccion_ws: [0, 0, 1] },
          P2: { posicion_mm: [3000, 0, 25], direccion: [1, 0, 0], orientacion_seccion_ws: [0, 0, 1] },
        },
      },
    ],
    conexiones: [],
    circuitos: [],
    soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  };
}

describe('#219 assertInput valida orientacion_seccion_ws perpendicular y unitario', () => {
  it('acepta vector unitario perpendicular a direccion', () => {
    const input = baseInput();
    expect(() => assertInput(input)).not.toThrow();
  });

  it('rechaza vector no unitario', () => {
    const input = baseInput();
    input.piezas[0].puertos.P1.orientacion_seccion_ws = [0, 0, 2];
    expect(() => assertInput(input)).toThrow(/unitario/i);
  });

  it('rechaza vector paralelo a direccion (no perpendicular)', () => {
    const input = baseInput();
    // direccion = [-1,0,0]; vDir = [-1,0,0] viola perpendicularidad (dot=1).
    input.piezas[0].puertos.P1.orientacion_seccion_ws = [-1, 0, 0];
    expect(() => assertInput(input)).toThrow(/perpendicular/i);
  });

  it('rechaza vector oblicuo a direccion (dot ≠ 0 pero unitario)', () => {
    const input = baseInput();
    // direccion = [-1,0,0]; vDir normalizado con componente X significativa.
    const a = 0.5, b = 0, c = Math.sqrt(1 - a * a);
    input.piezas[0].puertos.P1.orientacion_seccion_ws = [a, b, c];
    expect(() => assertInput(input)).toThrow(/perpendicular/i);
  });

  it('acepta puertos sin orientacion_seccion_ws (campo opcional)', () => {
    const input = baseInput();
    delete input.piezas[0].puertos.P1.orientacion_seccion_ws;
    delete input.piezas[0].puertos.P2.orientacion_seccion_ws;
    expect(() => assertInput(input)).not.toThrow();
  });
});

describe('#222 transport() elimina orientacion_seccion_ws antes de postear al motor', () => {
  const originalFetch = globalThis.fetch;
  let lastBody: string | null = null;

  beforeEach(() => {
    lastBody = null;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      lastBody = typeof init?.body === 'string' ? init.body : null;
      return new Response(
        JSON.stringify({ estado: 'ok', version_motor: '0.2.2', resultado: {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('el payload serializado no contiene orientacion_seccion_ws en ningún puerto', async () => {
    const input = baseInput();
    const solicitud = {
      version_contrato: '1.0' as const,
      revision_entrada: 1,
      tipo: 'trazado' as const,
      entrada: input,
    };
    await transport(solicitud as unknown as Parameters<typeof transport>[0]).catch(() => {});

    expect(lastBody).not.toBeNull();
    expect(lastBody!).not.toContain('orientacion_seccion_ws');
    // Pero sí debe preservar posicion_mm y direccion.
    expect(lastBody!).toContain('posicion_mm');
    expect(lastBody!).toContain('direccion');
  });

  it('el stripper es puro: no mutea la Solicitud original', async () => {
    const input = baseInput();
    const solicitud = {
      version_contrato: '1.0' as const,
      revision_entrada: 1,
      tipo: 'trazado' as const,
      entrada: input,
    };
    await transport(solicitud as unknown as Parameters<typeof transport>[0]).catch(() => {});

    // El input original todavía tiene el campo (sólo se eliminó en la copia serializada).
    expect(input.piezas[0].puertos.P1.orientacion_seccion_ws).toEqual([0, 0, 1]);
    expect(input.piezas[0].puertos.P2.orientacion_seccion_ws).toEqual([0, 0, 1]);
  });
});
