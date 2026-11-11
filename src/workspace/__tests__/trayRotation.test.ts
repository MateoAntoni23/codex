/**
 * B-4 — lógica del gizmo de rotación (sin escena).
 *
 *   - La rotación del proxy del visor (Y arriba) se traduce al trazado (Z arriba)
 *     con el mismo eje y ángulo: girar el proxy 90° sobre el eje Y del visor es
 *     girar la pieza 90° sobre Z del trazado.
 *   - Paso de 15° y giro libre.
 *   - Pivote en el centro o en una boca: el pivote queda fijo.
 *   - Pieza suelta: se confirma directo. Pieza unida: si deja uniones que no
 *     cumplen, se pide confirmación listándolas; si rota sobre el eje de su
 *     boca unida (giro que conserva la unión… salvo por el giro de sección),
 *     se informa igual — nunca queda una unión inválida sin decidir.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ajustarAPaso, ejeMundoDe, mmAVisor, PASO_ROTACION_DEG, puntoPivote, resolverRotacion, rotacionVisorAMm, rotarEnTrazado } from '../trayRotation';
import type { TrayInput } from '../../tray/model';

const q = (axis: [number, number, number], deg: number) => {
  const t = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), (deg * Math.PI) / 180);
  return [t.x, t.y, t.z, t.w];
};

function trazado(conUnion: boolean): TrayInput {
  const recto = (id: string, x0: number) => ({
    instancia_id: id, producto_id: 'SAM_TRPS-300-22-Z', longitud_mm: 1000,
    puertos: {
      P1: { posicion_mm: [x0, 0, 0], direccion: [-1, 0, 0], orientacion_seccion_ws: [0, 0, 1] },
      P2: { posicion_mm: [x0 + 1000, 0, 0], direccion: [1, 0, 0], orientacion_seccion_ws: [0, 0, 1] },
    },
  });
  return {
    version_contrato: 'trazado/1',
    piezas: [recto('A', 0), recto('B', 1000)] as never,
    conexiones: conUnion ? [{ conexion_id: 'C1', a: ['A', 'P2'], b: ['B', 'P1'] }] : [],
    circuitos: [], soportes: [],
    pe: { seccion_requerida_mm2: 0, cable_id: '', origen_requisito: '', conductores: [] },
  } as TrayInput;
}

describe('B-4 — rotación del gizmo', () => {
  it('visor → trazado: Y del visor es Z del trazado; X es X; Z del visor es −Y', () => {
    const z = rotacionVisorAMm(q([0, 1, 0], 90));
    expect(ejeMundoDe(z.eje)).toBe('Z');
    expect(z.deg).toBeCloseTo(90, 9);
    const x = rotacionVisorAMm(q([1, 0, 0], -30));
    expect(ejeMundoDe(x.eje)).toBe('X');
    expect(x.deg).toBeCloseTo(-30, 9);
    const y = rotacionVisorAMm(q([0, 0, 1], 45)); // +Z visor = −Y mm → −45° sobre +Y
    expect(ejeMundoDe(y.eje)).toBe('Y');
    expect(y.deg).toBeCloseTo(-45, 9);
    expect(rotacionVisorAMm([0, 0, 0, 1]).deg).toBe(0);
  });

  it('la conversión es consistente con la escena: un punto girado en el visor cae donde lo gira el trazado', () => {
    const quat = q([0.3, 0.8, -0.5], 37);
    const { eje, deg } = rotacionVisorAMm(quat);
    const pMm = [120, -340, 560];
    const enVisor = new THREE.Vector3(...mmAVisor(pMm)).applyQuaternion(new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3]));
    const t = rotarEnTrazado({ ...trazado(false), piezas: [{ instancia_id: 'P', producto_id: 'x', puertos: { P1: { posicion_mm: pMm, direccion: [1, 0, 0] } } }] } as never, 'P', eje, deg, [0, 0, 0]);
    const r = t.piezas[0].puertos.P1.posicion_mm;
    expect(mmAVisor(r).map((v, i) => v - enVisor.toArray()[i]).every((d) => Math.abs(d) < 1e-9)).toBe(true);
  });

  it('paso de 15° por defecto; sin paso (tecla modificadora) el ángulo es libre', () => {
    expect(PASO_ROTACION_DEG).toBe(15);
    expect(ajustarAPaso(22, 15)).toBe(15);
    expect(ajustarAPaso(23, 15)).toBe(30);
    expect(ajustarAPaso(23.4, null)).toBe(23.4);
  });

  it('pivote en una boca: la boca queda fija; pivote en el centro: el centro queda fijo', () => {
    const t = trazado(false);
    const A = t.piezas[0];
    const enBoca = rotarEnTrazado(t, 'A', [0, 0, 1], 90, puntoPivote(A, { boca: 'P1' })!).piezas[0];
    expect(enBoca.puertos.P1.posicion_mm).toEqual([0, 0, 0]);
    expect(enBoca.puertos.P2.posicion_mm.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 1000, 0]);
    const enCentro = rotarEnTrazado(t, 'A', [0, 0, 1], 90, puntoPivote(A, 'centro')!).piezas[0];
    expect(puntoPivote(enCentro, 'centro')!.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([500, 0, 0]);
    expect(puntoPivote(A, { boca: 'NO' })).toBeNull();
  });

  it('PB8 — pieza suelta: se confirma directo; pieza unida: pide confirmación listando la unión', () => {
    const suelta = trazado(false);
    expect(resolverRotacion(rotarEnTrazado(suelta, 'B', [0, 0, 1], 45, puntoPivote(suelta.piezas[1], 'centro')!), 'B')).toEqual({ tipo: 'confirmar' });
    const unida = trazado(true);
    const post = rotarEnTrazado(unida, 'B', [0, 0, 1], 45, puntoPivote(unida.piezas[1], 'centro')!);
    expect(resolverRotacion(post, 'B')).toEqual({ tipo: 'pedir_confirmacion', rotas: ['C1'] });
    // Girar 90° sobre el eje de su boca unida conserva posición y dirección, pero
    // el giro de sección deja la unión inválida: también pide confirmación.
    const pb1 = unida.piezas[1].puertos.P1;
    const sobreBoca = rotarEnTrazado(unida, 'B', pb1.direccion, 90, pb1.posicion_mm);
    expect(resolverRotacion(sobreBoca, 'B')).toEqual({ tipo: 'pedir_confirmacion', rotas: ['C1'] });
    // 360° la deja igual: unión intacta.
    expect(resolverRotacion(rotarEnTrazado(unida, 'B', pb1.direccion, 360, pb1.posicion_mm), 'B')).toEqual({ tipo: 'confirmar' });
  });
});
