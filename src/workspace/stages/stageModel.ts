/**
 * stageModel — etapas de trabajo del espacio de trabajo (hito 1b) y reglas puras.
 *
 * Cinco etapas: Equipos · Planta · Bandejas · Conexiones · Resultados. La escena
 * 3D es común; cada etapa muestra sólo su lista, sus herramientas y su inspector.
 *
 * Selección que pertenece a otra etapa (decisión 3b): **se cambia de etapa
 * automáticamente** a la que es dueña de lo seleccionado. Motivo: la selección
 * puede nacer en la escena (clic en un equipo o una pieza), que es común a todas
 * las etapas; ofrecer el cambio con un botón obligaría a un segundo gesto para
 * ver la ficha de lo que el operador acaba de tocar. Excepción: si la etapa actual
 * también sabe mostrar esa selección, se queda (p. ej. una pieza elegida en
 * Resultados muestra su resultado, no salta a Bandejas).
 */
export type StageId = 'equipos' | 'planta' | 'bandejas' | 'conexiones' | 'resultados';

export const STAGES: ReadonlyArray<{ id: StageId; n: number; label: string }> = [
  { id: 'equipos', n: 1, label: 'Equipos' },
  { id: 'planta', n: 2, label: 'Planta' },
  { id: 'bandejas', n: 3, label: 'Bandejas' },
  { id: 'conexiones', n: 4, label: 'Conexiones' },
  { id: 'resultados', n: 5, label: 'Resultados' },
];

export type SelectionKind =
  | 'equipment'
  | 'infrastructure'
  | 'imported'
  | 'piece'
  | 'support'
  | 'routing'
  | 'join-tool';

/** Etapas que saben mostrar cada tipo de selección; la primera es la dueña. */
const ACCEPTS: Record<SelectionKind, readonly StageId[]> = {
  equipment: ['equipos'],
  infrastructure: ['planta'],
  imported: ['equipos'],
  piece: ['bandejas', 'resultados'],
  support: ['bandejas'],
  routing: ['bandejas'],
  'join-tool': ['bandejas'],
};

/** Etapa a mostrar cuando aparece una selección de `kind` estando en `current`. */
export function stageForSelection(current: StageId, kind: SelectionKind): StageId {
  const ok = ACCEPTS[kind];
  return ok.includes(current) ? current : ok[0];
}

export function isStageId(v: unknown): v is StageId {
  return typeof v === 'string' && STAGES.some((s) => s.id === v);
}
