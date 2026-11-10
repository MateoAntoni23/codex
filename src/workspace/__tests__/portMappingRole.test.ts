/**
 * Hito 2 — la auditoría contrasta el SENTIDO de cada boca contra nombre_puerto
 * del catálogo: "boca derivación" debe caer en la boca que el patrón declara
 * derivación, y los troncos en las otras (caso T escalera con P2/P3 intercambiados).
 */
import { describe, it, expect } from 'vitest';
import { auditPortMappings } from '../portMappingAudit';
import type { CatalogPort, Product } from '../../tray/model';

const prod = { producto_id: 'X_T' } as Product;
const puertos = [
  { puerto_id: 'X_T-P1', nombre_puerto: 'boca 1' },
  { puerto_id: 'X_T-P2', nombre_puerto: 'boca 2' },
  { puerto_id: 'X_T-P3', nombre_puerto: 'boca derivación' },
] as CatalogPort[];
const run = (labels: [string, string][]) => auditPortMappings({
  productos: [prod],
  puertos,
  masterFor: () => ({ id: 'm', ports: labels.map(([recipePortName, physicalLabel]) => ({ recipePortName, physicalLabel })) }),
  recipePortsFor: () => null,
  resolve: (_id, boca) => ({ status: 'mapped', catalogPortName: boca } as never),
});

describe('auditoría de bocas — sentido', () => {
  it('patrón con derivación y tronco intercambiados → role-mismatch en ambas bocas', () => {
    const r = run([['P1', 'Tronco'], ['P2', 'Boca derivación'], ['P3', 'Tronco']]);
    expect(r.issues.map((i) => [i.boca, i.kind])).toEqual([['P2', 'role-mismatch'], ['P3', 'role-mismatch']]);
  });
  it('patrón alineado con el catálogo → sin problemas', () => {
    expect(run([['P1', 'Tronco'], ['P2', 'Tronco'], ['P3', 'Boca derivación']]).issues).toEqual([]);
  });
});
