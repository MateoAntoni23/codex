/**
 * Dibujo esquemático de las bajadas (equipo ↔ bandeja): una línea recta desde el
 * punto de salida sobre el flanco del tramo hasta el centro del equipo, con los
 * puntos guardados al crear el enlace. No es bandeja: se dibuja como línea de
 * trazos. Una bajada desactualizada (equipo o tramo movido) se dibuja en color
 * de aviso y sigue mostrando lo guardado: nada se recalcula solo.
 */
import { Line } from '@react-three/drei';
import type { TrayInput } from '../../tray/model';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { bajadasOf, estadoBajada } from './bajada';

type V3 = [number, number, number];
const toViewer = (mm: readonly number[]): V3 => [mm[0] / 1000, mm[2] / 1000, -mm[1] / 1000];

export function BajadasEnEscena({ entrada }: { entrada: TrayInput }) {
  const elements = useWorkspaceStore((s) => s.elements);
  const bajadas = bajadasOf(entrada);
  if (!bajadas.length) return null;
  return (
    <group name="bajadas">
      {bajadas.map((b) => {
        const vigente = estadoBajada(entrada, elements, b).vigente;
        return (
          <Line
            key={b.id}
            name={`bajada-${b.id}`}
            points={[toViewer(b.punto_salida_mm), toViewer(b.punto_equipo_mm)]}
            color={vigente ? '#e8a33d' : '#d9534f'}
            dashed
            dashSize={0.08}
            gapSize={0.05}
            lineWidth={2}
          />
        );
      })}
    </group>
  );
}
