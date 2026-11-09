/**
 * productMappingStatus — clasifica un producto del catálogo según su
 * capacidad real de inserción paramétrica, separando limpiamente:
 *
 *   - `no-recipe`        · no hay receta paramétrica (ni STEP) para el SKU.
 *                         No hay nada que configurar; la pieza queda fuera
 *                         del Configurador hasta que haya STEP o receta.
 *
 *   - `recipe-not-ready` · hay receta pero su `piece_kind` NO está en
 *                         SUPPORTED_PIECE_KINDS; se conoce la geometría pero
 *                         el bridge paramétrico aún no la coloca interactivamente.
 *                         Acción: habilitar `piece_kind` en parametricBridge.
 *
 *   - `recipe-default-identity` · hay receta y es 2-boca con nombres P1/P2 que
 *                         coinciden con los del catálogo SAMET. La asociación
 *                         boca↔puerto es la identidad y es correcta — no hay
 *                         "sin mapping" que resolver. Pieza insertable sin
 *                         acción manual.
 *
 *   - `recipe-default-mapping` · hay receta con nombres semánticos
 *                         (tronco_P1, P1_horizontal, …) y existe un
 *                         DEFAULT_MAPPINGS entry para el producto. Asociación
 *                         resuelta por decisión del proyecto. Pieza insertable.
 *
 *   - `recipe-override`  · el usuario grabó un override en el Configurador.
 *                         Los ajustes (mapping, modelFrame, portGeometry) son
 *                         los que valen.
 *
 *   - `recipe-needs-mapping` · hay receta con nombres semánticos y NO hay
 *                         default ni override. El usuario debe decidir qué
 *                         puerto de catálogo corresponde a cada boca de la
 *                         receta. Hoy el único caso así sería un accesorio
 *                         3+ puertos nuevo; no debería mostrarse como "sin
 *                         mapping" sin cause, sino con acción concreta.
 *
 * Reglas:
 *   - NO devolver "sin mapping" como único estado para distinguir casos muy
 *     distintos (STEP ausente vs mapping ausente).
 *   - NO tocar el motor Python ni la vista ?pilot=step.
 *   - Deterministic: un mismo producto + estado de overrides produce el mismo
 *     resultado. No mira al tiempo.
 */

import type { Product } from '../tray/model';
import {
  getEffectiveMapping,
  type ProductPortMapping,
} from '../workspace/catalogPortMapping';
import {
  resolveParametricEntry,
  isParametricInsertable,
} from '../workspace/parametricBridge';
import type { ParametricEntry } from '../parametric/catalog';
import { buildRecipeFor, type RawParams } from '../parametric/geometry/recipes';

export type MappingStatus =
  | 'no-recipe'
  | 'recipe-not-ready'
  | 'recipe-default-identity'
  | 'recipe-default-mapping'
  | 'recipe-override'
  | 'recipe-needs-mapping';

export interface MappingStatusInfo {
  readonly status: MappingStatus;
  readonly label: string;
  /** Causa concreta: por qué está en este estado. Legible por humanos. */
  readonly cause: string;
  /** Acción recomendada. Vacío cuando no hay acción (estado terminal ok). */
  readonly action: string;
  /** True si la pieza se puede insertar en el workspace tal como está. */
  readonly insertable: boolean;
}

const LABELS: Record<MappingStatus, string> = {
  'no-recipe': 'Sin receta',
  'recipe-not-ready': 'Receta no habilitada',
  'recipe-default-identity': 'Mapping identidad (P1/P2)',
  'recipe-default-mapping': 'Mapping por defecto',
  'recipe-override': 'Override de proyecto',
  'recipe-needs-mapping': 'Falta mapping',
};

/**
 * True cuando TODAS las bocas de la receta usan nombres P1/P2/P3/… — en ese
 * caso la asociación con el catálogo SAMET es la identidad y no requiere
 * declaración explícita.
 */
function recipeUsesCanonicalPortNames(entry: ParametricEntry): boolean {
  try {
    const recipe = buildRecipeFor(entry.piece_kind, {} as RawParams);
    return recipe.ports.every((p) => /^P\d+$/.test(p.name));
  } catch {
    return false;
  }
}

/**
 * Clasifica un producto según su mapping efectivo. Deterministic: lee
 * exclusivamente el estado actual de overrides via getEffectiveMapping.
 */
export function classifyProductMapping(product: Product): MappingStatusInfo {
  const entry = resolveParametricEntry(product);
  if (!entry) {
    return {
      status: 'no-recipe',
      label: LABELS['no-recipe'],
      cause: 'No hay receta paramétrica asociada al SKU (no se aportó STEP ni se declaró generador procedural).',
      action: 'Aportar STEP o declarar generador procedural para el tipo de pieza.',
      insertable: false,
    };
  }
  const insertable = isParametricInsertable(product);
  if (!insertable) {
    return {
      status: 'recipe-not-ready',
      label: LABELS['recipe-not-ready'],
      cause: `La receta existe (piece_kind=${entry.piece_kind}) pero el puente paramétrico no coloca aún este tipo interactivamente.`,
      action: 'Habilitar piece_kind en SUPPORTED_PIECE_KINDS de parametricBridge, o aislar la pieza con una excepción de proyecto.',
      insertable: false,
    };
  }
  const mapping: ProductPortMapping | null = getEffectiveMapping(product.producto_id);
  if (mapping?.source === 'override') {
    return {
      status: 'recipe-override',
      label: LABELS['recipe-override'],
      cause: `El usuario grabó un override del mapping${mapping.overrideReason ? ` ("${mapping.overrideReason}")` : ''}.`,
      action: '',
      insertable: true,
    };
  }
  if (mapping && mapping.source === 'default') {
    return {
      status: 'recipe-default-mapping',
      label: LABELS['recipe-default-mapping'],
      cause: 'Hay un mapping por defecto declarado por el proyecto que traduce los nombres semánticos de la receta a P1/P2/P3 del catálogo.',
      action: '',
      insertable: true,
    };
  }
  // Sin mapping declarado: distinguir identidad trivial de "falta trabajo".
  if (recipeUsesCanonicalPortNames(entry)) {
    return {
      status: 'recipe-default-identity',
      label: LABELS['recipe-default-identity'],
      cause: 'La receta usa nombres P1/P2 que coinciden con el catálogo SAMET; no se necesita declaración de mapping.',
      action: '',
      insertable: true,
    };
  }
  return {
    status: 'recipe-needs-mapping',
    label: LABELS['recipe-needs-mapping'],
    cause: 'La receta usa nombres semánticos (ej. tronco_P1) sin asociación declarada con los puertos P1/P2/… del catálogo SAMET.',
    action: 'Declarar la asociación en catalogPortMapping.DEFAULT_MAPPINGS o mediante un override del Configurador.',
    insertable: true, // la pieza se coloca (nombres traducidos como identidad), pero compat SAMET falla
  };
}

export function mappingStatusLabel(status: MappingStatus): string {
  return LABELS[status];
}
