/**
 * continuationCandidates — clasifica los productos ofrecidos como continuación
 * al rutear desde un puerto libre en dos estados explícitos:
 *
 *   - 'recommended': combinación respaldada por catálogo (compatibilidades
 *     publicadas por SAMET) Y el flujo interactivo sabe insertarla hoy
 *     (bien sea por las fórmulas clásicas o por una receta paramétrica
 *     ya soportada por el puente). Son las opciones "verdes" del selector.
 *
 *   - 'other': producto paramétrico del mismo ancho (misma familia
 *     geométrica), SIN compatibilidad explícita en el catálogo. Se lista
 *     con una razón visible y marcado con `requiresException = true`. Si
 *     además su `piece_kind` todavía NO está habilitado para inserción
 *     interactiva (DCPS, XPS, CUPS mientras se completa la generalización
 *     de `placeRecipe`), se devuelve `insertionSupported = false` y el
 *     selector debe renderizar la opción como deshabilitada con tooltip
 *     explicativo.
 *
 *   Separación deliberada entre:
 *     - "no compatible según catálogo" (ausencia de compatibilidad
 *       declarada: razón → 'compat_no_documentada')
 *     - "sin modelo geométrico" (producto sin receta paramétrica ni
 *       geometría catálogo-completa: razón → 'sin_modelo_geometrico')
 *     - "piece_kind pendiente de habilitar" (geometría existe pero el
 *       flujo interactivo aún no la coloca: razón → 'kind_pendiente_insercion').
 *
 *   Compartir familia NO convierte una conexión en compatible. La
 *   categorización 'other' se basa ÚNICAMENTE en coincidencia de `ancho`
 *   (misma clase geométrica del perfil), no en `familia_id` del catálogo.
 *
 * Reglas de prioridad de orden dentro de cada grupo:
 *   - Desde un recto (tramo_recto): el mismo producto_id va primero en
 *     'recommended' si es compatible.
 *   - Desde un accesorio (curva, T, X, cruz, vertical): un recto paramétrico
 *     va primero en 'recommended' si es compatible.
 *
 * Este módulo es pura clasificación: no lee stores, no toca el motor Python
 * ni el store de excepciones. El RoutingPanel lo invoca con los inputs ya
 * resueltos y usa el resultado para pintar el selector.
 */
import type { Product } from '../tray/model';
import { modeloDeProducto } from './placement/definitions';
import {
  isInteractivelyInsertable,
  isStraight,
  isHorizontalCurve,
  isVerticalCurve,
} from './pieceClassification';

/**
 * "Tiene modelo paramétrico" en el sentido amplio: existe receta geométrica
 * para el producto aunque el `piece_kind` todavía no esté habilitado para
 * inserción interactiva (`modeloDeProducto(p).colocable`).
 */
function hasParametricModel(product: Product | null | undefined): boolean {
  return modeloDeProducto(product) !== null;
}

/** Patrón de la derivación lateral (DCPS): sólo se coloca con un enganche sobre un tronco. */
export const PATRON_DERIVACION_LATERAL = 'master:perforada:derivacion_lateral';

/**
 * Una DCPS no se ofrece como continuación de un recorrido: colocada así no tiene
 * tronco anfitrión y se computaría una derivación que no deriva de nada. Se
 * coloca sólo con la herramienta "Derivación en tramo".
 */
export function esDerivacionLateral(product: Product | null | undefined): boolean {
  return modeloDeProducto(product)?.patron === PATRON_DERIVACION_LATERAL;
}

export type CandidateCategory = 'recommended' | 'other';

export type OtherReasonCode =
  | 'compat_no_documentada'
  | 'sin_modelo_geometrico'
  | 'kind_pendiente_insercion'
  | 'boca_dimension_divergente';

export interface ContinuationCandidate {
  readonly product: Product;
  readonly category: CandidateCategory;
  /** Verdadero si se requiere aceptar una excepción con motivo para usarlo. */
  readonly requiresException: boolean;
  /** Verdadero si el flujo interactivo sabe colocar hoy este piece_kind. */
  readonly insertionSupported: boolean;
  /** Receta paramétrica diseñada para este producto. */
  readonly hasParametricModel: boolean;
  /** Código corto para pruebas y clasificación de telemetría. */
  readonly reasonCode: OtherReasonCode | 'ok';
  /** Texto mostrado en el panel para que el usuario entienda el estado. */
  readonly reasonText: string;
}

export interface ContinuationInputs {
  readonly existingProduct: Product;
  readonly existingPortName: string;
  readonly catalogProducts: readonly Product[];
  readonly compatibleIds: ReadonlySet<string>;
}

function describeKindPendiente(product: Product): string {
  const modelo = modeloDeProducto(product);
  if (!modelo) return 'Inserción interactiva pendiente para este tipo de pieza.';
  switch (modelo.tipo) {
    case 'derivacion_lateral':
      return 'Derivación lateral (T): tres bocas. Inserción interactiva pendiente — requiere elegir boca de entrada y conservar las dos bocas libres para continuar.';
    case 'cruz':
      return 'Cruz: cuatro bocas. Inserción interactiva pendiente — requiere elegir boca de entrada y conservar las tres bocas restantes libres.';
    case 'curva_vertical':
      return 'Curva vertical: transición horizontal↔vertical. Inserción interactiva pendiente — el STEP mide bocas de 36.56 mm vs ala 50 mm del catálogo SAMET (compatibilidad no publicada).';
    default:
      return 'Inserción interactiva pendiente para este tipo de pieza.';
  }
}

function describeOtherReason(isParametric: boolean): {
  code: OtherReasonCode;
  text: string;
} {
  if (!isParametric) {
    return {
      code: 'sin_modelo_geometrico',
      text:
        'Compatibilidad no documentada en el catálogo SAMET y sin modelo paramétrico cargado — ' +
        'no puede ofrecerse como continuación directa.',
    };
  }
  // Producto paramétrico pero no catálogo-compat.
  return {
    code: 'compat_no_documentada',
    text:
      'Compartir ancho geométrico no convierte la conexión en compatible: ' +
      'el catálogo SAMET no publica compatibilidad para esta combinación de puerto. ' +
      'Requiere aceptar una excepción con motivo para continuar.',
  };
}

/**
 * Categoriza y ordena los productos candidatos para continuar desde
 * `existingProduct.existingPortName`.
 *
 * El resultado está pensado para pintarse como dos `<optgroup>` en el
 * selector del RoutingPanel. Cada candidato trae su razón exacta — no
 * se inventan compatibilidades ni geometría.
 */
export function buildContinuationCandidates(
  inputs: ContinuationInputs,
): ContinuationCandidate[] {
  const { existingProduct, catalogProducts, compatibleIds } = inputs;

  const result: ContinuationCandidate[] = [];
  const seen = new Set<string>();

  const existingAncho = existingProduct.ancho_nominal_mm;

  for (const p of catalogProducts) {
    if (seen.has(p.producto_id)) continue;
    if (esDerivacionLateral(p)) continue; // DCPS: sólo con un enganche (ver esDerivacionLateral)
    const isCompat = compatibleIds.has(p.producto_id);
    const isParametric = hasParametricModel(p);
    const kindSupported = isParametric ? modeloDeProducto(p)?.colocable === true : false;
    const insertable = isInteractivelyInsertable(p) || kindSupported;

    if (isCompat) {
      // Grupo 'recommended': debe ser insertable (clásico o paramétrico habilitado).
      if (!insertable) {
        // Compatible pero piece_kind aún no habilitado → entra en 'other' con
        // razón específica para no "esconder" el gap.
        result.push({
          product: p,
          category: 'other',
          requiresException: false,
          insertionSupported: false,
          hasParametricModel: isParametric,
          reasonCode: 'kind_pendiente_insercion',
          reasonText: describeKindPendiente(p),
        });
        seen.add(p.producto_id);
        continue;
      }
      result.push({
        product: p,
        category: 'recommended',
        requiresException: false,
        insertionSupported: true,
        hasParametricModel: isParametric,
        reasonCode: 'ok',
        reasonText: '',
      });
      seen.add(p.producto_id);
      continue;
    }

    // No catálogo-compat. Sólo entra en 'other' si hay señal geométrica que
    // justifique ofrecerlo — en la práctica, si es paramétrico del mismo ancho.
    if (!isParametric) continue;
    if (
      typeof existingAncho === 'number' &&
      typeof p.ancho_nominal_mm === 'number' &&
      existingAncho !== p.ancho_nominal_mm
    ) {
      continue;
    }
    const { code, text } = describeOtherReason(isParametric);
    result.push({
      product: p,
      category: 'other',
      requiresException: true,
      insertionSupported: kindSupported,
      hasParametricModel: isParametric,
      reasonCode: code,
      reasonText: text,
    });
    seen.add(p.producto_id);
  }

  // Orden intra-grupo: priorizar el mismo producto desde recto, y recto desde
  // accesorio.
  result.sort((a, b) => {
    // Grupo primero (recommended antes que other).
    if (a.category !== b.category) return a.category === 'recommended' ? -1 : 1;
    // Dentro del mismo grupo: el mismo producto_id va primero cuando origen es recto.
    if (isStraight(existingProduct)) {
      const aSelf = a.product.producto_id === existingProduct.producto_id ? 0 : 1;
      const bSelf = b.product.producto_id === existingProduct.producto_id ? 0 : 1;
      if (aSelf !== bSelf) return aSelf - bSelf;
    } else if (isHorizontalCurve(existingProduct) || isVerticalCurve(existingProduct)) {
      // Desde curva: priorizar rectos.
      const aStraight = isStraight(a.product) ? 0 : 1;
      const bStraight = isStraight(b.product) ? 0 : 1;
      if (aStraight !== bStraight) return aStraight - bStraight;
    }
    // Fallback estable: por producto_id para tests reproducibles.
    return a.product.producto_id.localeCompare(b.product.producto_id);
  });

  return result;
}
