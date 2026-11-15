/**
 * Etapa 4 — qué pasa por cada bandeja: los circuitos guardados que atraviesan una pieza y
 * sus cables (los tendidos, si el circuito está ligado al Excel), con función, cable y
 * cantidad, y la suma de diámetros por grupo (potencia / el resto: mando, señal,
 * comunicación — los mismos grupos de la segregación). Cálculo de la app, a la vista.
 *
 * La suma es Σ diámetro exterior de catálogo × cantidad. Fuera de la suma, y dicho:
 * los ítems sin cable de catálogo (no hay diámetro) y los circuitos desactualizados (su
 * recorrido guardado puede no ser el de hoy). El PE del trazado (D-20) no es un circuito:
 * lo cuenta el motor.
 */
import type { TrayInput } from '../tray/model';
import type { EquipmentElement } from '../types/domain-v2';
import type { ImportedCatalog } from '../import/types';
import type { CableCatalogo } from '../workspace/cables/catalogoCables';
import { circuitosOf, estadoCircuito, type CircuitoGuardado } from '../workspace/recorridos/circuitosGuardados';
import { cablesDelCircuito, type CableEnCircuito } from './tendidos';

export type Grupo = 'potencia' | 'resto';
export const TEXTO_GRUPO: Readonly<Record<Grupo, string>> = { potencia: 'Potencia', resto: 'Mando, señal y comunicación' };

export interface ItemEnBandeja extends CableEnCircuito {
  readonly cable: CableCatalogo | null;
  readonly grupo: Grupo | null;
  /** Σ de este ítem (diámetro × cantidad), o null si no entra en la suma. */
  readonly sumaMm: number | null;
  readonly fueraDeLaSuma: string | null;
}

export interface CircuitoEnBandeja {
  readonly circuito: CircuitoGuardado;
  readonly vigente: boolean;
  readonly items: readonly ItemEnBandeja[];
}

export interface PorBandeja {
  readonly circuitos: readonly CircuitoEnBandeja[];
  readonly sumas: Readonly<Record<Grupo, { readonly diametrosMm: number; readonly cables: number }>>;
  readonly fueraDeLaSuma: number;
}

export function porBandeja(entrada: TrayInput, elements: readonly EquipmentElement[], catalog: ImportedCatalog | null, cables: readonly CableCatalogo[], pieza: string): PorBandeja {
  const sumas = { potencia: { diametrosMm: 0, cables: 0 }, resto: { diametrosMm: 0, cables: 0 } };
  let fuera = 0;
  const lista: CircuitoEnBandeja[] = [];
  for (const c of circuitosOf(entrada)) {
    if (!c.cruces.some((x) => x.pieza === pieza)) continue;
    const vigente = estadoCircuito(entrada, elements, c).vigente;
    const items = cablesDelCircuito(entrada, catalog, cables, c).map((k): ItemEnBandeja => {
      const cable = k.cable_id ? cables.find((x) => x.cable_id === k.cable_id) ?? null : null;
      const grupo: Grupo | null = k.funcion ? (k.funcion === 'potencia' ? 'potencia' : 'resto') : null;
      const motivo = !vigente ? 'circuito desactualizado: recalculalo'
        : !cable ? `${k.motivoSinCable?.startsWith('sin cable de catálogo') ? k.motivoSinCable : `sin cable de catálogo (${k.motivoSinCable ?? 'sin cable'})`} — no hay diámetro`
        : !grupo ? 'sin función' : !k.cantidad ? 'sin cantidad' : null;
      const suma = motivo ? null : cable!.diametro_exterior_mm * k.cantidad!;
      if (suma === null) fuera++;
      else { sumas[grupo!].diametrosMm += suma; sumas[grupo!].cables += k.cantidad!; }
      return { ...k, cable, grupo, sumaMm: suma, fueraDeLaSuma: motivo };
    });
    lista.push({ circuito: c, vigente, items });
  }
  return { circuitos: lista, sumas, fueraDeLaSuma: fuera };
}
