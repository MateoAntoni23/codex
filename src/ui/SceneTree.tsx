import { useSceneStore } from '../store/sceneStore';
import type { ObjectType } from '../types/domain';

const TYPE_ICON: Record<ObjectType, string> = {
  floor: '▦',
  building: '🏭',
  panel: '⚡',
  motor: '⚙️',
};

const TYPE_LABEL: Record<ObjectType, string> = {
  floor: 'Piso',
  building: 'Nave',
  panel: 'Tablero',
  motor: 'Motor',
};

const SELECTABLE: ObjectType[] = ['panel', 'motor'];

export function SceneTree() {
  const objects = useSceneStore((s) => s.objects);
  const selectedId = useSceneStore((s) => s.selectedId);
  const selectObject = useSceneStore((s) => s.selectObject);
  const clearSelection = useSceneStore((s) => s.clearSelection);

  return (
    <div className="panel panel-left">
      <div className="panel-title">Elementos de la Escena</div>
      <ul className="scene-tree">
        {objects.map((obj) => {
          const selectable = SELECTABLE.includes(obj.type);
          const selected = selectedId === obj.id;
          return (
            <li
              key={obj.id}
              className={`tree-item${selected ? ' tree-item--selected' : ''}${selectable ? ' tree-item--selectable' : ''}`}
              onClick={() => {
                if (selectable) {
                  selected ? clearSelection() : selectObject(obj.id);
                }
              }}
            >
              <span className="tree-icon">{TYPE_ICON[obj.type]}</span>
              <span className="tree-name">{obj.name}</span>
              <span className="tree-type">{TYPE_LABEL[obj.type]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
