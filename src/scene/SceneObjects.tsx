import { useSceneStore } from '../store/sceneStore';
import { Floor } from './Floor';
import { Building } from './Building';
import { ElectricalPanel } from './ElectricalPanel';
import { Motor } from './Motor';

export function SceneObjects() {
  const objects = useSceneStore((s) => s.objects);
  const selectedId = useSceneStore((s) => s.selectedId);
  const selectObject = useSceneStore((s) => s.selectObject);

  return (
    <>
      {objects.map((obj) => {
        if (obj.type === 'floor') return <Floor key={obj.id} obj={obj} />;
        if (obj.type === 'building') return <Building key={obj.id} obj={obj} />;
        if (obj.type === 'panel') {
          return (
            <ElectricalPanel
              key={obj.id}
              obj={obj}
              isSelected={selectedId === obj.id}
              onSelect={() => selectObject(obj.id)}
            />
          );
        }
        if (obj.type === 'motor') {
          return (
            <Motor
              key={obj.id}
              obj={obj}
              isSelected={selectedId === obj.id}
              onSelect={() => selectObject(obj.id)}
            />
          );
        }
        return null;
      })}
    </>
  );
}
