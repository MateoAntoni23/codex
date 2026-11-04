import { useState, useCallback } from 'react';
import { useSceneStore } from '../store/sceneStore';
import type { ObjectType, DomainObject } from '../types/domain';

const SELECTABLE: ReadonlySet<ObjectType> = new Set(['panel', 'motor']);

interface CategoryDef {
  key: string;
  label: string;
  types: ObjectType[];
}

const CATEGORIES: CategoryDef[] = [
  { key: 'tableros',        label: 'Tableros',        types: ['panel'] },
  { key: 'motores',         label: 'Motores',         types: ['motor'] },
  { key: 'bombas',          label: 'Bombas',          types: [] },
  { key: 'valvulas',        label: 'Válvulas',        types: [] },
  { key: 'sensores',        label: 'Sensores',        types: [] },
  { key: 'iluminacion',     label: 'Iluminación',     types: [] },
  { key: 'botoneras',       label: 'Botoneras',       types: [] },
  { key: 'infraestructura', label: 'Infraestructura', types: ['floor', 'building'] },
];

function buildInitialExpanded(objects: DomainObject[]): Set<string> {
  const expanded = new Set<string>();
  for (const cat of CATEGORIES) {
    if (objects.some((o) => cat.types.includes(o.type))) {
      expanded.add(cat.key);
    }
  }
  return expanded;
}

export function SceneTree() {
  const objects = useSceneStore((s) => s.objects);
  const selectedId = useSceneStore((s) => s.selectedId);
  const selectObject = useSceneStore((s) => s.selectObject);
  const clearSelection = useSceneStore((s) => s.clearSelection);

  const [expanded, setExpanded] = useState<Set<string>>(() =>
    buildInitialExpanded(objects),
  );

  const toggleCategory = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  return (
    <div className="scene-tree-panel">
      <div className="panel-title">Elementos de la Escena</div>
      <ul className="scene-tree">
        {CATEGORIES.map((cat) => {
          const catObjects = objects.filter((o) => cat.types.includes(o.type));
          const count = catObjects.length;
          const isExpanded = expanded.has(cat.key);

          return (
            <li key={cat.key} className="tree-category">
              <button
                type="button"
                className="tree-category-header"
                aria-expanded={isExpanded}
                onClick={() => toggleCategory(cat.key)}
              >
                <span className="tree-category-chevron" aria-hidden="true">
                  {isExpanded ? '▾' : '▸'}
                </span>
                <span className="tree-category-label">{cat.label}</span>
                <span className="tree-category-count">({count})</span>
              </button>

              {isExpanded && count > 0 && (
                <ul className="tree-category-items">
                  {catObjects.map((obj) => {
                    const selectable = SELECTABLE.has(obj.type);
                    const selected = selectedId === obj.id;
                    return (
                      <li
                        key={obj.id}
                        className={`tree-item${selected ? ' tree-item--selected' : ''}${selectable ? ' tree-item--selectable' : ''}`}
                        tabIndex={selectable ? 0 : -1}
                        onClick={() => {
                          if (selectable) {
                            selected ? clearSelection() : selectObject(obj.id);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (selectable && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            selected ? clearSelection() : selectObject(obj.id);
                          }
                        }}
                      >
                        <span className="tree-name">{obj.name}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
