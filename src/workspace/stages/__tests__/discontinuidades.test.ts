/**
 * «Recorridos discontinuos» explicado: derivaciones en tramo que el motor no
 * modela como conexión (2026-11-14). El resultado del motor no se modifica.
 */
import { describe, expect, it } from 'vitest';
import { explicarDiscontinuos, saltosDelResultado } from '../discontinuidades';
import { summarizeResult } from '../resultPresentation';
import type { TrayInput } from '../../../tray/model';

const entrada = {
  version_contrato: 'trazado/1', piezas: [], conexiones: [], circuitos: [], soportes: [],
  pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  enganches_ws: [
    { id: 'ENG-1', tronco: 'T', salida: ['DER-1', 'apoyo'] },
    { id: 'ENG-2', tronco: 'T2', salida: ['RAM', 'P1'] },
  ],
} as unknown as TrayInput;

function resultado(saltos: Array<[string, string]>, curvatura: unknown[] = []) {
  return {
    resumen: { estado_trazado: 'CON_INCUMPLIMIENTOS', incumplimientos: ['recorridos discontinuos'], decisiones_que_bloquean: [], verificaciones_bloqueadas: [] },
    circuitos: { 'CIR-1': { recorrido: { estado: 'DISCONTINUO', saltos_sin_conexion: saltos }, curvatura } },
    pe: { conductores: [] },
  };
}

describe('recorridos discontinuos explicados', () => {
  it('todas por derivación en tramo: se dice en el propio incumplimiento; sin curvatura sin evaluar → no afecta tampoco la curvatura', () => {
    const r = resultado([['T', 'DER-1'], ['T2', 'RAM']]);
    expect(explicarDiscontinuos(r, entrada)).toBe(
      'recorridos discontinuos: las 2 discontinuidades corresponden a derivaciones en tramo; el motor no las modela como conexión (no afecta ocupación, reserva ni curvatura)',
    );
    expect(saltosDelResultado(r, entrada).map((s) => s.enganche)).toEqual(['ENG-1', 'ENG-2']);
  });

  it('si el motor dejó la curvatura sin evaluar en la pieza del salto (p. ej. la DCPS, una «T» para él), se nombra: no se afirma de más', () => {
    const r = resultado([['T', 'DER-1']], [{ instancia: 'DER-1', estado: 'NO_EVALUADO_EXTREMO_DE_RECORRIDO' }]);
    expect(explicarDiscontinuos(r, entrada, (p) => `pieza ${p}`)).toBe(
      'recorridos discontinuos: la discontinuidad corresponde a una derivación en tramo; el motor no la modela como conexión (no afecta ocupación ni reserva; el motor no evaluó la curvatura en pieza DER-1)',
    );
  });

  it('si alguna no es derivación, queda como incumplimiento y se nombra cuál', () => {
    const r = resultado([['T', 'DER-1'], ['R1', 'R2']]);
    expect(explicarDiscontinuos(r, entrada, (p) => p, (id) => `circuito ${id}`)).toBe(
      'recorridos discontinuos: 1 de 2 no corresponde a una derivación en tramo: circuito CIR-1 entre R1 y R2',
    );
  });

  it('control negativo: una discontinuidad que NO es derivación nunca sale explicada como derivación', () => {
    for (const salto of [['R1', 'R2'], ['T', 'R9'], ['DER-1', 'RAM'], ['T', 'T']] as Array<[string, string]>) {
      const texto = explicarDiscontinuos(resultado([salto]), entrada)!;
      expect(texto).not.toContain('corresponden a derivaciones en tramo');
      expect(texto).not.toContain('corresponde a una derivación en tramo; el motor no la modela');
      expect(texto).toContain('no corresponde a una derivación en tramo');
    }
    // Un enganche que la app no conoce (sin enganches en el proyecto) tampoco.
    const sinEnganches = { ...entrada, enganches_ws: [] } as unknown as TrayInput;
    expect(explicarDiscontinuos(resultado([['T', 'DER-1']]), sinEnganches)).toContain('1 de 1 no corresponde');
  });

  it('el resultado del motor no se modifica, y el estado sigue siendo el del motor (con incumplimientos)', () => {
    const r = resultado([['T', 'DER-1']]);
    const antes = structuredClone(r);
    const texto = explicarDiscontinuos(r, entrada);
    const v = summarizeResult(r, new Set(), texto)!;
    expect(r).toEqual(antes);
    expect(v.headline).toBe('Con incumplimientos');
    expect(v.designIssues).toEqual([texto]);
    expect(explicarDiscontinuos({ ...r, resumen: { ...r.resumen, incumplimientos: [] } }, entrada)).toBeNull();
  });
});
