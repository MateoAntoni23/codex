/**
 * Extremos libres para continuar: las bocas libres de las piezas (getFreePorts) y
 * las bocas de enganche de escalera sin nada continuado (una boca abierta sobre
 * el flanco de un tronco es un extremo libre legítimo).
 */
import type { TrayInput } from '../../tray/model';
import { getFreePorts, verifyStartPortValid, type FreePort } from '../routingRules';
import type { StartPort } from '../useRoutingStore';
import { bocasLibresDeEnganche, bocasOcupadasPorEnganches, idDeBocaEnganche } from './enganche';

export function extremosLibres(entrada: TrayInput | null | undefined): FreePort[] {
  if (!entrada) return [];
  return [
    ...getFreePorts(entrada.piezas, entrada.conexiones, bocasOcupadasPorEnganches(entrada)),
    ...bocasLibresDeEnganche(entrada).map((b) => ({ pieceId: b.pieceId, portName: b.portName, pos: [...b.pos] as FreePort['pos'], dir: [...b.dir] as FreePort['dir'], sectionUp: [...b.sectionUp] as FreePort['sectionUp'] })),
  ];
}

/** verifyStartPortValid, con las bocas de enganche: siguen libres y en el mismo lugar. */
export function verificarOrigen(entrada: TrayInput, startPort: StartPort): { valid: boolean; reason: string } {
  if (!idDeBocaEnganche(startPort.portName)) return verifyStartPortValid(entrada.piezas, entrada.conexiones, startPort);
  const b = bocasLibresDeEnganche(entrada).find((x) => x.pieceId === startPort.pieceId && x.portName === startPort.portName);
  if (!b) return { valid: false, reason: `La boca ${startPort.portName} ya no está libre (o el enganche quedó desactualizado).` };
  const d = Math.hypot(b.pos[0] - startPort.pos[0], b.pos[1] - startPort.pos[1], b.pos[2] - startPort.pos[2]);
  if (d > 0.01) return { valid: false, reason: `La posición de la boca cambió desde que se seleccionó (desviación ${d.toFixed(2)} mm).` };
  return { valid: true, reason: '' };
}
