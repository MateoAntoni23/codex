/**
 * portMappingAudit — recorre productos del catálogo con maestro y verifica que
 * cada boca de su receta se traduce a un puerto que el catálogo publica.
 *
 * Problemas posibles por producto:
 *  - `uncalibrated`: una boca no tiene correspondencia (sin calibración de bocas).
 *  - `missing-catalog-port`: la traducción produce un puerto_id que no existe en
 *    PUERTOS_PRODUCTO.
 *
 * Es una función pura sobre los datos y las funciones de resolución inyectadas,
 * para poder probarla también con un maestro sintético al que le falta una boca.
 */
import type { CatalogPort, Product } from '../tray/model';
import type { PortResolution } from './catalogPortMapping';

export interface AuditIssue {
  producto_id: string;
  master: string;
  boca: string;
  kind: 'uncalibrated' | 'missing-catalog-port';
  detail: string;
}

export interface AuditInput {
  productos: readonly Product[];
  puertos: readonly CatalogPort[];
  /** Maestro del producto (id + bocas declaradas), o null si no tiene. */
  masterFor: (p: Product) => { id: string; ports: readonly { recipePortName: string }[] } | null;
  /** Nombres de boca que emite la receta paramétrica del producto, o null si no hay receta. */
  recipePortsFor: (p: Product) => readonly string[] | null;
  resolve: (productId: string, recipePortName: string) => PortResolution;
}

export interface AuditReport {
  withMaster: number;
  checkedPorts: number;
  issues: AuditIssue[];
  /** Productos con maestro y al menos un problema. */
  unresolvedProducts: string[];
}

export function auditPortMappings(input: AuditInput): AuditReport {
  const portIds = new Set(input.puertos.map((p) => p.puerto_id));
  const issues: AuditIssue[] = [];
  let withMaster = 0;
  let checkedPorts = 0;
  for (const p of input.productos) {
    const master = input.masterFor(p);
    if (!master) continue;
    withMaster++;
    const names = input.recipePortsFor(p) ?? master.ports.map((x) => x.recipePortName);
    for (const boca of names) {
      checkedPorts++;
      const r = input.resolve(p.producto_id, boca);
      if (r.status === 'uncalibrated') {
        issues.push({ producto_id: p.producto_id, master: master.id, boca, kind: 'uncalibrated', detail: r.reason });
        continue;
      }
      const id = `${p.producto_id}-${r.catalogPortName}`;
      if (!portIds.has(id)) {
        issues.push({ producto_id: p.producto_id, master: master.id, boca, kind: 'missing-catalog-port', detail: `${id} no existe en PUERTOS_PRODUCTO` });
      }
    }
  }
  return {
    withMaster,
    checkedPorts,
    issues,
    unresolvedProducts: [...new Set(issues.map((i) => i.producto_id))].sort(),
  };
}
