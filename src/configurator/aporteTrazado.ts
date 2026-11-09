/**
 * aporteTrazado — "aporte al trazado" por producto (configuración persistente).
 *
 * Qué es:
 *   Longitud efectiva que un producto aporta cuando se usa en un trazado. Para
 *   un tramo recto es la longitud física; para un accesorio (curva, T, cruz)
 *   depende del ancho del patrón. El usuario necesita poder revisar y ajustar
 *   esa regla por producto antes de que el cómputo la use — por eso la guardamos
 *   antes de integrarla al pipeline.
 *
 * Qué NO es (por ahora):
 *   NO está integrada al cómputo real. El valor que devuelve `computeAporteMm`
 *   NO se consume todavía en el motor Python ni en la UI de totales — es
 *   configuración persistente que viaja con el proyecto y espera a ser
 *   "cableada" en un hito posterior. La UI del Configurador lo señala como
 *   "configuración · no integrada al cómputo aún" para que no se interprete
 *   como cómputo activo.
 *
 * Reglas default:
 *   - `tramo_recto`           → `kind: 'longitud'` (toma la longitud del segmento).
 *   - resto (curvas, T, cruz, reducción, curva vertical) →
 *       `kind: 'multiplo-ancho', multiplier: 2` (2 × ancho_mm del patrón).
 *
 * El default es una hipótesis de diseño basada en la práctica habitual del
 * usuario: un accesorio aporta aproximadamente lo mismo que dos anchos de la
 * bandeja en continuidad. Sobre un patrón concreto el usuario puede elegir:
 *   - `kind: 'longitud'`        — para piezas rectas o accesorios que marchan
 *                                 por longitud explícita.
 *   - `kind: 'multiplo-ancho'`  — accesorios proporcionales al ancho.
 *   - `kind: 'fijo-mm'`         — valor absoluto declarado por el usuario.
 *
 * Diseño puro: este módulo no persiste nada. `catalogConfigStore` guarda el
 * override por producto en el sub-dict `aporteOverrides`; el default se
 * computa desde el maestro cada vez que no hay override.
 */
import type { MasterModel } from './masterModels';

export type AporteRuleKind = 'longitud' | 'multiplo-ancho' | 'fijo-mm';

export interface AporteRule {
  readonly kind: AporteRuleKind;
  /** Usado cuando `kind === 'fijo-mm'`. */
  readonly valueMm?: number;
  /** Usado cuando `kind === 'multiplo-ancho'`. */
  readonly multiplier?: number;
}

/**
 * Dimensiones runtime del segmento o pieza. `longitud_mm` sólo aplica a rectos;
 * `ancho_mm` siempre proviene del maestro o de la variante dimensional activa.
 */
export interface AporteDimensions {
  readonly ancho_mm: number;
  readonly longitud_mm?: number;
}

/**
 * Regla default según el `pieceKind` del maestro. Patrones de tramo recto se
 * computan por longitud declarada; accesorios se asumen proporcionales al
 * ancho. El usuario puede sobreescribir por producto con cualquiera de los
 * tres `kind` disponibles.
 */
export function defaultAporteForMaster(master: MasterModel): AporteRule {
  if (master.pieceKind === 'tramo_recto') return { kind: 'longitud' };
  return { kind: 'multiplo-ancho', multiplier: 2 };
}

/**
 * Validación estructural de una regla. Centralizada acá para que serialize /
 * hydrate puedan rechazar formas inválidas sin lógica dispersa.
 */
export function isAporteRule(value: unknown): value is AporteRule {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'longitud' && v.kind !== 'multiplo-ancho' && v.kind !== 'fijo-mm') return false;
  if (v.kind === 'multiplo-ancho') {
    if (typeof v.multiplier !== 'number' || !Number.isFinite(v.multiplier) || v.multiplier <= 0) return false;
  }
  if (v.kind === 'fijo-mm') {
    if (typeof v.valueMm !== 'number' || !Number.isFinite(v.valueMm) || v.valueMm <= 0) return false;
  }
  return true;
}

/**
 * Calcula el aporte al trazado en mm para una regla + dimensiones runtime.
 *
 * ⚠️  NO integrado al cómputo real todavía. Expuesto para pruebas y para
 * cuando se conecte al pipeline del motor. Devuelve `null` cuando la regla
 * requiere una dimensión que no fue provista (p.ej. `longitud` sin
 * `longitud_mm`): el llamador decide si fallar o pedir dato al usuario.
 */
export function computeAporteMm(
  rule: AporteRule,
  dims: AporteDimensions,
): number | null {
  switch (rule.kind) {
    case 'longitud':
      if (typeof dims.longitud_mm !== 'number' || !Number.isFinite(dims.longitud_mm)) return null;
      return dims.longitud_mm;
    case 'multiplo-ancho': {
      const m = rule.multiplier ?? 2;
      return dims.ancho_mm * m;
    }
    case 'fijo-mm':
      return rule.valueMm ?? null;
  }
}

/**
 * Etiqueta corta para la UI. No se usa en cálculos — sólo texto.
 */
export function aporteRuleLabel(rule: AporteRule): string {
  switch (rule.kind) {
    case 'longitud':
      return 'Por longitud del segmento';
    case 'multiplo-ancho':
      return `${rule.multiplier ?? 2} × ancho del patrón`;
    case 'fijo-mm':
      return `${rule.valueMm ?? 0} mm fijos`;
  }
}
