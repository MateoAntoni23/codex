import { describe, it, expect } from 'vitest';
import { computeGuideSteps, type GuideInput } from '../workspaceGuide';

const BASE: GuideInput = {
  nPiezas: 0, nConexiones: 0, circuitos: [], nSoportes: 0,
  cableId: '', status: 'sin_calcular',
};

describe('computeGuideSteps', () => {
  // ─── Step 6: revisar ────────────────────────────────────────────────────────

  it('step 6 (revisar) is never done — requires human review', () => {
    const steps = computeGuideSteps({ ...BASE, status: 'vigente', estadoTrazado: 'CON_INCUMPLIMIENTOS' });
    expect(steps.find((s) => s.id === 'revisar')!.done).toBe(false);
  });

  it('step 6 is not done even with vigente status and no estado_trazado', () => {
    const steps = computeGuideSteps({ ...BASE, status: 'vigente' });
    expect(steps.find((s) => s.id === 'revisar')!.done).toBe(false);
  });

  it('step 6 hint shows actual estado_trazado string from Python unchanged', () => {
    for (const estado of ['CON_INCUMPLIMIENTOS', 'CON_BLOQUEOS', 'PRESELECCION_CONDICIONADA']) {
      const steps = computeGuideSteps({ ...BASE, status: 'vigente', estadoTrazado: estado });
      const hint = steps.find((s) => s.id === 'revisar')!.hint;
      expect(hint).toContain(estado.replace(/_/g, ' '));
    }
  });

  it('step 6 hint does not claim no pending issues without evidence', () => {
    for (const status of ['vigente', 'sin_calcular', 'desactualizado']) {
      const steps = computeGuideSteps({ ...BASE, status });
      const hint = steps.find((s) => s.id === 'revisar')!.hint.toLowerCase();
      expect(hint).not.toMatch(/sin pendientes/);
      expect(hint).not.toMatch(/aprobado/);
      // Does not assert the magic "LISTO" / "ADVERTENCIAS" that Python does not emit
      expect(hint).not.toMatch(/\blisto\b/);
      expect(hint).not.toMatch(/advertencias/);
    }
  });

  it('step 6 hint tells user to calculate first when status is not vigente', () => {
    const steps = computeGuideSteps({ ...BASE, status: 'sin_calcular' });
    const hint = steps.find((s) => s.id === 'revisar')!.hint.toLowerCase();
    expect(hint).toMatch(/calculá/);
  });

  // ─── Step 5: calcular ───────────────────────────────────────────────────────

  it('step 5 (calcular) completes only when status === vigente', () => {
    for (const status of ['sin_calcular', 'desactualizado', 'calculando', 'error']) {
      expect(computeGuideSteps({ ...BASE, status }).find((s) => s.id === 'calcular')!.done)
        .toBe(false);
    }
    expect(computeGuideSteps({ ...BASE, status: 'vigente' }).find((s) => s.id === 'calcular')!.done)
      .toBe(true);
  });

  // ─── Other steps ────────────────────────────────────────────────────────────

  it('step 1 (trazado) done when piezas > 0', () => {
    expect(computeGuideSteps({ ...BASE, nPiezas: 3 }).find((s) => s.id === 'trazado')!.done).toBe(true);
    expect(computeGuideSteps({ ...BASE, nPiezas: 0 }).find((s) => s.id === 'trazado')!.done).toBe(false);
  });

  it('step 2 (conexiones) done when conexiones > 0', () => {
    expect(computeGuideSteps({ ...BASE, nConexiones: 1 }).find((s) => s.id === 'conexiones')!.done).toBe(true);
    expect(computeGuideSteps({ ...BASE, nConexiones: 0 }).find((s) => s.id === 'conexiones')!.done).toBe(false);
  });

  it('step 3 (cables) done when at least one circuit has cable_id and recorrido', () => {
    const withCable = { ...BASE, circuitos: [{ cable_id: 'CAB-001', recorrido: ['R1', 'R2'] }] };
    const noCable   = { ...BASE, circuitos: [{ cable_id: '', recorrido: ['R1'] }] };
    const noRoute   = { ...BASE, circuitos: [{ cable_id: 'CAB-001', recorrido: [] }] };
    expect(computeGuideSteps(withCable).find((s) => s.id === 'cables')!.done).toBe(true);
    expect(computeGuideSteps(noCable).find(  (s) => s.id === 'cables')!.done).toBe(false);
    expect(computeGuideSteps(noRoute).find(  (s) => s.id === 'cables')!.done).toBe(false);
  });

  it('step 4 (soportes) done when soportes > 0 and cableId set', () => {
    expect(computeGuideSteps({ ...BASE, nSoportes: 1, cableId: 'PE-001' }).find((s) => s.id === 'soportes')!.done).toBe(true);
    expect(computeGuideSteps({ ...BASE, nSoportes: 1, cableId: '' }).find(    (s) => s.id === 'soportes')!.done).toBe(false);
    expect(computeGuideSteps({ ...BASE, nSoportes: 0, cableId: 'PE-001' }).find((s) => s.id === 'soportes')!.done).toBe(false);
  });

  it('always returns 6 steps in order', () => {
    const ids = computeGuideSteps(BASE).map((s) => s.id);
    expect(ids).toEqual(['trazado', 'conexiones', 'cables', 'soportes', 'calcular', 'revisar']);
  });
});
