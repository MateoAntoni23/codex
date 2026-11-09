/**
 * sistemaClassifier — mapea `familia_id` del catálogo al sistema comercial que
 * el usuario usa para navegar (Perforada, Escalera Z, Escalera G, Alambre
 * inoxidable, Otros).
 *
 * Reglas:
 *   - NO deduce el sistema del nombre del archivo ni del sufijo del SKU.
 *     Siempre parte del `familia_id` publicado en el snapshot del catálogo.
 *   - Z y G se separan aunque puedan compartir geometría — la decisión del
 *     usuario de unificar geometría se respeta en el pipeline paramétrico,
 *     pero la clasificación comercial preserva familia, SKU y acabado.
 *   - Lo no clasificado explícitamente cae en "Otros" (accesorios, ferretería,
 *     perfilería): se muestra en la lista para que el usuario vea por qué una
 *     pieza no está en el filtro principal.
 */

export type Sistema =
  | 'perforada'
  | 'escalera-z'
  | 'escalera-g'
  | 'alambre-inox'
  | 'otros';

export interface SistemaInfo {
  readonly id: Sistema;
  readonly label: string;
}

export const SISTEMAS: readonly SistemaInfo[] = [
  { id: 'perforada',    label: 'Perforada' },
  { id: 'escalera-z',   label: 'Escalera Z' },
  { id: 'escalera-g',   label: 'Escalera G' },
  { id: 'alambre-inox', label: 'Alambre inoxidable' },
  { id: 'otros',        label: 'Otros' },
];

// familia_id → sistema. Fuente: snapshot del catálogo SAMET/FAMIQ.
const FAMILIA_TO_SISTEMA: Record<string, Sistema> = {
  'SAM-STP-Z': 'perforada',
  'SAM-STP-ZN': 'perforada',     // misma geometría, acabado distinto
  'SAM-STE-Z': 'escalera-z',
  'SAM-STE-G': 'escalera-g',
  'SAM-ESC-TRL': 'escalera-g',   // tradicional soldada → la agrupamos con G
  'FAMIQ-ALAMBRE-INOX': 'alambre-inox',
};

export function classifySistema(familiaId: string | null | undefined): Sistema {
  if (typeof familiaId !== 'string' || !familiaId) return 'otros';
  return FAMILIA_TO_SISTEMA[familiaId] ?? 'otros';
}

export function sistemaLabel(id: Sistema): string {
  return SISTEMAS.find((s) => s.id === id)?.label ?? id;
}
