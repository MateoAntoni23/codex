/**
 * Aplica la migración (A-10) cuando el trazado tiene piezas sin colocación y el
 * catálogo ya está disponible. El resultado se escribe en memoria sin entrar al
 * historial de deshacer (no es una edición del operador); el aviso informa
 * cuántas piezas se resolvieron y cuántas quedaron sin resolver.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { useTrayStore } from '../../tray/store';
import { migrateTray, needsMigration, type MigrationReport } from './migration';
import type { Product } from '../../tray/model';

interface MigrationState {
  report: MigrationReport | null;
  dismiss: () => void;
}

export const useMigrationStore = create<MigrationState>((set) => ({
  report: null,
  dismiss: () => set({ report: null }),
}));

function merge(a: MigrationReport | null, b: MigrationReport): MigrationReport {
  if (!a) return b;
  return {
    total: a.total + b.total,
    resueltas: a.resueltas + b.resueltas,
    sinResolver: [...a.sinResolver, ...b.sinResolver],
    maxDesvioMm: Math.max(a.maxDesvioMm, b.maxDesvioMm),
    maxDesvioDeg: Math.max(a.maxDesvioDeg, b.maxDesvioDeg),
  };
}

export function runMigrationIfNeeded(): MigrationReport | null {
  const { entrada, context } = useTrayStore.getState();
  if (!context || !needsMigration(entrada)) return null;
  const products = new Map<string, Product>(context.productos.map((p) => [p.producto_id, p]));
  const { entrada: next, report } = migrateTray(entrada!, products);
  useTrayStore.getState().setEntradaRaw(next);
  useMigrationStore.setState((s) => ({ report: merge(s.report, report) }));
  return report;
}

export function useMigration(): void {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  useEffect(() => {
    runMigrationIfNeeded();
  }, [entrada, context]);
}
