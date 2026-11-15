/**
 * Parte civil en la escena: una malla por archivo importado, en su posición
 * (ejes declarados, giro en planta y desplazamiento).
 *
 * Contexto visual: NO recibe clics (raycast apagado), así los clics de la escena
 * siguen llegando a las bandejas y los equipos. Se selecciona desde la lista de
 * Planta.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { MM_TO_VIEWER } from '../workspace/placement/PlacedMesh';
import { useParteCivilStore } from './parteCivilStore';
import { decodificarMalla, matrizArchivo, type ArchivoCivil, type TipoCivil } from './modelo';

/** Tonos provisorios de la parte A (la paleta configurable es la parte C). */
const COLOR_PROVISORIO: Record<TipoCivil, string> = {
  muro: '#56606e',
  columna: '#9a8f78',
  viga: '#6f7d70',
  losa: '#3d4148',
  otro: '#6b6b6b',
};

const sinRaycast = () => undefined;

function MallaArchivo({ archivo, seleccionado }: { archivo: ArchivoCivil; seleccionado: boolean }) {
  const geom = useMemo(() => {
    const { posiciones, indices } = decodificarMalla(archivo.malla);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeVertexNormals();
    return g;
  }, [archivo.malla]);
  useLayoutEffect(() => () => geom.dispose(), [geom]);

  const matriz = useMemo(() => {
    const m = new THREE.Matrix4().fromArray(matrizArchivo(archivo));
    return new THREE.Matrix4().multiplyMatrices(MM_TO_VIEWER, m);
  }, [archivo]);
  const ref = useRef<THREE.Mesh | null>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    m.matrix.copy(matriz);
    m.matrixWorldNeedsUpdate = true;
    m.userData.codex = {
      kind: 'civil', archivoId: archivo.id, nombre: archivo.nombre, tipo: archivo.tipo, nivel: archivo.nivel.nombre,
      triangulos: archivo.malla.triangulos, seleccionado,
    };
  }, [matriz, archivo, seleccionado]);

  return (
    <mesh ref={ref} matrixAutoUpdate={false} raycast={sinRaycast}>
      <primitive object={geom} attach="geometry" />
      <meshStandardMaterial
        color={COLOR_PROVISORIO[archivo.tipo]}
        emissive={seleccionado ? '#ffffff' : '#000000'}
        emissiveIntensity={seleccionado ? 0.15 : 0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function ParteCivilEnEscena() {
  const archivos = useParteCivilStore((s) => s.archivos);
  const seleccionado = useParteCivilStore((s) => s.seleccionado);
  return (
    <group name="parte-civil">
      {archivos.map((a) => <MallaArchivo key={a.id} archivo={a} seleccionado={seleccionado === a.id} />)}
    </group>
  );
}
