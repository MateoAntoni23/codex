import { useState, useCallback } from 'react';
import { usePreviewStore } from './usePreviewStore';
import { PREVIEW_ELEMENTS } from './previewData';
import type { Category } from '../types/domain-v2';

const CATEGORY_LABEL: Record<Category, string> = {
  electrical_panel: 'Tableros Eléctricos',
  pneumatic_panel:  'Tableros Neumáticos',
  motor:            'Motores',
  pump:             'Bombas',
  sensor:           'Sensores',
  process_valve:    'Válvulas de Proceso',
  solenoid_valve:   'Electroválvulas',
  actuator:         'Actuadores',
  luminaire:        'Luminarias',
  pushbutton:       'Botoneras',
  terminal_block:   'Borneras',
  manifold:         'Manifolds',
  infrastructure:   'Infraestructura',
};

const placed   = PREVIEW_ELEMENTS.filter((e) => e.placementStatus === 'placed');
const unplaced = PREVIEW_ELEMENTS.filter((e) => e.placementStatus === 'unplaced');

const placedCategories = [...new Set(placed.map((e) => e.category as Category))];

export function PreviewElementList() {
  const selectedId = usePreviewStore((s) => s.selectedId);
  const select = usePreviewStore((s) => s.select);
  const clearSelection = usePreviewStore((s) => s.clearSelection);

  const initialExpanded = new Set(placedCategories as string[]);
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  return (
    <div className="scene-tree-panel">
      <div className="panel-title">Elementos v2 — Vista de prueba</div>

      {/* Elementos ubicados agrupados por categoría */}
      <ul className="scene-tree" style={{ flex: 1 }}>
        {placedCategories.map((cat) => {
          const items = placed.filter((e) => e.category === cat);
          const isOpen = expanded.has(cat);
          return (
            <li key={cat} className="tree-category">
              <button
                type="button"
                className="tree-category-header"
                aria-expanded={isOpen}
                onClick={() => toggle(cat)}
              >
                <span className="tree-category-chevron" aria-hidden="true">
                  {isOpen ? '▾' : '▸'}
                </span>
                <span className="tree-category-label">{CATEGORY_LABEL[cat]}</span>
                <span className="tree-category-count">({items.length})</span>
              </button>

              {isOpen && (
                <ul className="tree-category-items">
                  {items.map((el) => {
                    const sel = selectedId === el.id;
                    return (
                      <li
                        key={el.id}
                        className={`tree-item tree-item--selectable${sel ? ' tree-item--selected' : ''}`}
                        tabIndex={0}
                        onClick={() => sel ? clearSelection() : select(el.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            sel ? clearSelection() : select(el.id);
                          }
                        }}
                      >
                        <span className="tree-name">{el.name}</span>
                        {el.geometry == null && (
                          <span className="preview-pending-badge">?</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {/* Sección de elementos sin ubicar (no se dibujan en escena) */}
      {unplaced.length > 0 && (
        <div className="preview-unplaced-section">
          <div className="preview-unplaced-title">Sin ubicar ({unplaced.length})</div>
          <ul className="preview-unplaced-list">
            {unplaced.map((el) => (
              <li key={el.id} className="preview-unplaced-item">
                <span className="tree-name">{el.name}</span>
                <span className="preview-unplaced-badge">{CATEGORY_LABEL[el.category as Category]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
