/**
 * emptyProject — el proyecto vacío por defecto del espacio de trabajo.
 *
 * Un proyecto nuevo no trae equipos de demostración ni piezas de ejemplo. Para
 * que el trazado sea válido en el frontend (`assertInput` exige el bloque `pe`)
 * hace falta un `pe` con valores neutros. Decisión documentada:
 *
 *   pe = { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: <texto>, conductores: [] }
 *
 * - `seccion_requerida_mm2: 0` y `cable_id: ''` NO son un requisito de ingeniería:
 *   significan "PE sin definir". Nunca se inventa una sección ni un cable.
 * - `toMotorEntrada` OMITE el bloque `pe` cuando es neutro (`isNeutralPe`). En el
 *   contrato trazado/1 el motor trata `pe` como opcional (sin `pe` no evalúa
 *   equipotencial); así un proyecto sin PE definido puede calcularse ocupación y
 *   cómputo sin que el motor rechace una sección 0. No se cambia el contrato.
 * - En cuanto el usuario fija un `cable_id` (WorkspaceTree) el bloque deja de
 *   ser neutro y viaja completo.
 */
import type { TrayInput } from '../tray/model';

export const NEUTRAL_PE_ORIGIN = 'Proyecto sin PE definido (valor neutro; no es un requisito)';

export function emptyTrayInput(): TrayInput {
  return {
    version_contrato: 'trazado/1',
    piezas: [],
    conexiones: [],
    circuitos: [],
    soportes: [],
    pe: {
      seccion_requerida_mm2: 0,
      cable_id: '',
      origen_requisito: NEUTRAL_PE_ORIGIN,
      conductores: [],
    },
  };
}

/** `true` si el bloque `pe` es el valor neutro del proyecto vacío (PE sin definir). */
export function isNeutralPe(pe: TrayInput['pe']): boolean {
  return pe.cable_id === '' && pe.conductores.length === 0;
}

/** `true` si el trazado no contiene piezas, conexiones, circuitos ni soportes. */
export function isEmptyTray(t: TrayInput): boolean {
  return (
    t.piezas.length === 0 &&
    t.conexiones.length === 0 &&
    t.circuitos.length === 0 &&
    t.soportes.length === 0 &&
    isNeutralPe(t.pe)
  );
}
