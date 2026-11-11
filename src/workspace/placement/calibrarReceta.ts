/**
 * calibrarReceta — aplica la calibración POR PATRÓN (B-2.5) a la receta cruda
 * de un producto. Reemplaza, para la definición efectiva, a
 * `resolveRecipeForProduct` (overrides por SKU con marco y centros absolutos,
 * heredados por búsqueda).
 *
 * Cada boca con corrección se mueve/gira respecto de SU boca nominal (la de la
 * receta de este producto, ya en su ancho), en sus propios ejes: la misma
 * corrección vale en 300 y en 450 sin escalarse. La malla no cambia (no hay
 * `modelFrame`): preTransform identidad.
 */
import * as THREE from 'three';
import type { GeometryRecipe, PortDef } from '../../parametric/geometry/outlines';
import type { MasterModel } from '../../configurator/masterModels';
import type { Product } from '../../tray/model';
import {
  aplicarCorreccion,
  calibracionPara,
  esCorreccionNula,
  marcoDeBoca,
  MARCA_HEREDADA,
  type CalibracionAplicable,
} from '../calibracionPatron';
import type { StoredDefinition } from './placementCore';

/** El producto tiene las dimensiones del modelo medido del patrón. */
export function esVarianteMedida(product: Product, master: MasterModel): boolean {
  const r = product as unknown as Record<string, unknown>;
  const b = master.baseParams;
  if (product.ancho_nominal_mm !== b.ancho_mm) return false;
  if (r.ala_nominal_mm !== b.ala_mm) return false;
  if (b.angulo_deg !== undefined && r.angulo_grados !== b.angulo_deg) return false;
  return true;
}

export interface RecetaCalibrada {
  readonly recipe: GeometryRecipe;
  readonly preTransform: THREE.Matrix4;
  readonly calibrada: boolean;
  readonly aplicable: CalibracionAplicable;
  readonly info?: StoredDefinition['calibracion'];
  /** Bocas con corrección declarada que la receta no tiene (se informan, no se aplican). */
  readonly bocasDesconocidas: readonly string[];
}

export function calibrarReceta(raw: GeometryRecipe, product: Product, master: MasterModel | null): RecetaCalibrada {
  const identidad = new THREE.Matrix4();
  if (!master) return { recipe: raw, preTransform: identidad, calibrada: false, aplicable: { origen: 'ninguna' }, bocasDesconocidas: [] };
  const aplicable = calibracionPara(product.producto_id, master.id, esVarianteMedida(product, master));
  if (aplicable.origen === 'ninguna') return { recipe: raw, preTransform: identidad, calibrada: false, aplicable, bocasDesconocidas: [] };

  const nombres = new Set(raw.ports.map((p) => p.name));
  const bocasDesconocidas = Object.keys(aplicable.bocas).filter((n) => !nombres.has(n));
  let algunaAplicada = false;
  const ports: PortDef[] = raw.ports.map((p) => {
    const c = aplicable.bocas[p.name];
    if (!c || esCorreccionNula(c)) return p;
    algunaAplicada = true;
    const m = aplicarCorreccion(marcoDeBoca(p.center, p.normal, p.v_dir), c);
    return { ...p, center: m.centro, normal: m.axial, v_dir: m.vertical, u_dir: m.lateral };
  });
  if (!algunaAplicada) return { recipe: raw, preTransform: identidad, calibrada: false, aplicable, bocasDesconocidas };
  const info: StoredDefinition['calibracion'] = aplicable.origen === 'excepcion'
    ? { origen: 'excepcion', patron: aplicable.patron, heredada: false, nota: `excepción: ${aplicable.motivo}` }
    : { origen: 'patron', patron: aplicable.patron, heredada: aplicable.heredada, ...(aplicable.heredada ? { nota: MARCA_HEREDADA } : {}) };
  return { recipe: { ...raw, ports }, preTransform: identidad, calibrada: true, aplicable, info, bocasDesconocidas };
}
