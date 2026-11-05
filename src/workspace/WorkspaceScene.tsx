/**
 * WorkspaceScene — unified R3F scene combining equipment and tray objects.
 * Equipment objects are rendered using PreviewSceneObjects patterns.
 * Tray objects are rendered by TrayObjects.
 */
import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { elementToRenderProps } from '../scene/v2-adapter';
import { useWorkspaceStore } from './useWorkspaceStore';
import { TrayObjects } from './TrayObjects';
import type { ElementRenderProps } from '../scene/v2-adapter';

type Q4 = [number, number, number, number];

const CATEGORY_COLOR: Record<string, string> = {
  electrical_panel: '#5577aa',
  motor:            '#778866',
  pump:             '#6688aa',
  sensor:           '#aa7733',
  process_valve:    '#8866aa',
  solenoid_valve:   '#aa6688',
  actuator:         '#668899',
  luminaire:        '#aaaa44',
  pushbutton:       '#aa6644',
  terminal_block:   '#888888',
  manifold:         '#7788aa',
  pneumatic_panel:  '#5599aa',
  infrastructure:   '#445566',
};

function EquipmentObject({
  rp,
  isSelected,
  onSelect,
}: {
  rp: ElementRenderProps;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { positionViewer, rotationViewer, sizeViewer, geometryKind, category, name } = rp;
  if (!positionViewer) return null;

  const color    = CATEGORY_COLOR[category] ?? '#888888';
  const emissive = isSelected ? '#223366' : '#000000';
  const emissiveIntensity = isSelected ? 2 : 0;
  const quat     = (rotationViewer ?? [0, 0, 0, 1]) as Q4;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect();
  };

  if (geometryKind === 'box' && category === 'infrastructure') {
    return (
      <mesh position={positionViewer} quaternion={quat} onClick={handleClick}>
        <boxGeometry args={sizeViewer ?? [1, 1, 1]} />
        <meshBasicMaterial color={isSelected ? '#aabbcc' : '#8899aa'} wireframe />
      </mesh>
    );
  }

  if (geometryKind === 'box' || geometryKind === 'asset') {
    return (
      <mesh position={positionViewer} quaternion={quat} castShadow onClick={handleClick}>
        <boxGeometry args={sizeViewer ?? [1, 1, 1]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} />
      </mesh>
    );
  }

  if (geometryKind === 'cylinder') {
    const [dx, dy] = sizeViewer ?? [0.3, 1, 0.3];
    return (
      <mesh position={positionViewer} quaternion={quat} castShadow onClick={handleClick}>
        <cylinderGeometry args={[dx / 2, dx / 2, dy, 24]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} />
      </mesh>
    );
  }

  // No geometry / unknown: placeholder
  return (
    <group position={positionViewer}>
      <mesh onClick={handleClick}>
        <boxGeometry args={[0.35, 0.35, 0.35]} />
        <meshStandardMaterial color="#eeaa00" emissive="#ff8800" emissiveIntensity={isSelected ? 3 : 1.5} wireframe />
      </mesh>
      <Html center distanceFactor={8} style={{ pointerEvents: 'none' }} position={[0, 0.45, 0]}>
        <div style={{ background: 'rgba(0,0,0,0.5)', color: '#ffcc44', fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>
          {name}
        </div>
      </Html>
    </group>
  );
}

export function WorkspaceScene() {
  const elements         = useWorkspaceStore((s) => s.elements);
  const selectedEquipId  = useWorkspaceStore((s) => s.selectedEquipId);
  const selectEquip      = useWorkspaceStore((s) => s.selectEquip);
  const layers           = useWorkspaceStore((s) => s.layers);

  const allRenderProps = useMemo(
    () => elements.map((el) => elementToRenderProps(el, elements)),
    [elements],
  );

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={1.2} castShadow />

      {/* Equipment objects */}
      {allRenderProps.map((rp) => {
        if (!rp.placed) return null;
        const isInfra = rp.category === 'infrastructure';
        if (isInfra && !layers.infrastructure) return null;
        if (!isInfra && !layers.equipment) return null;
        return (
          <EquipmentObject
            key={rp.id}
            rp={rp}
            isSelected={selectedEquipId === rp.id}
            onSelect={() => selectEquip(rp.id)}
          />
        );
      })}

      {/* Tray objects — TrayObjects reads useTrayStore and useWorkspaceStore for layers/selection */}
      <TrayObjects />
    </>
  );
}
