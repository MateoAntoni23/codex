import { useState, useCallback } from 'react';
import { usePreviewStore } from './usePreviewStore';
import { PreviewAddForm } from './PreviewAddForm';
import { duplicateElement, checkDeleteDependencies } from './previewCrud';
import type { Category, EquipmentElement } from '../types/domain-v2';

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

export function PreviewElementList() {
  const elements       = usePreviewStore((s) => s.elements);
  const selectedId     = usePreviewStore((s) => s.selectedId);
  const select         = usePreviewStore((s) => s.select);
  const clearSelection = usePreviewStore((s) => s.clearSelection);
  const addElement     = usePreviewStore((s) => s.addElement);
  const removeElement  = usePreviewStore((s) => s.removeElement);
  const addEvidence    = usePreviewStore((s) => s.addEvidence);

  const [showAddForm, setShowAddForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteBlocker, setDeleteBlocker] = useState<{ id: string; message: string } | null>(null);

  const placed   = elements.filter((e) => e.placementStatus === 'placed');
  const unplaced = elements.filter((e) => e.placementStatus === 'unplaced');
  const placedCategories = [...new Set(placed.map((e) => e.category as Category))];

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(placedCategories as string[]),
  );

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  function handleDuplicate(el: EquipmentElement) {
    setConfirmDeleteId(null);
    setDeleteBlocker(null);
    const { duplicate, provenance } = duplicateElement(el);
    addElement(duplicate);
    addEvidence(provenance);
    // Auto-expand the category group of the duplicate
    setExpanded((prev) => new Set([...prev, duplicate.category]));
  }

  function handleDeleteRequest(el: EquipmentElement) {
    const check = checkDeleteDependencies(el, elements);
    if (!check.canDelete) {
      setConfirmDeleteId(null);
      setDeleteBlocker({ id: el.id, message: check.blockers.join(' ') });
    } else {
      setDeleteBlocker(null);
      setConfirmDeleteId(el.id);
    }
  }

  function handleConfirmDelete(id: string) {
    removeElement(id);
    setConfirmDeleteId(null);
    setDeleteBlocker(null);
  }

  function handleCancelDelete() {
    setConfirmDeleteId(null);
    setDeleteBlocker(null);
  }

  if (showAddForm) {
    return (
      <div className="scene-tree-panel">
        <PreviewAddForm
          onCreated={(el) => {
            addElement(el);
            setShowAddForm(false);
            setExpanded((prev) => new Set([...prev, el.category]));
          }}
          onCancel={() => setShowAddForm(false)}
        />
      </div>
    );
  }

  function ItemActions({ el }: { el: EquipmentElement }) {
    return (
      <div className="tree-item-actions">
        <button
          type="button"
          className="tree-action-btn"
          aria-label={`Duplicar ${el.name}`}
          title="Duplicar"
          onClick={(e) => { e.stopPropagation(); handleDuplicate(el); }}
        >
          Dup
        </button>
        <button
          type="button"
          className="tree-action-btn tree-action-btn--danger"
          aria-label={`Eliminar ${el.name}`}
          title="Eliminar"
          onClick={(e) => { e.stopPropagation(); handleDeleteRequest(el); }}
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="scene-tree-panel">
      <div className="panel-title">
        Elementos v2 — Vista de prueba
      </div>

      <button
        type="button"
        className="preview-add-btn"
        onClick={() => setShowAddForm(true)}
      >
        + Agregar equipo
      </button>

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
                    const showConfirm = confirmDeleteId === el.id;
                    const showBlocker = deleteBlocker?.id === el.id;
                    return (
                      <li key={el.id}>
                        <div
                          role="listitem"
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
                          <ItemActions el={el} />
                        </div>
                        {showConfirm && (
                          <div className="tree-delete-confirm">
                            <span>¿Eliminar &quot;{el.name}&quot;?</span>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ fontSize: 11, padding: '1px 7px' }}
                              onClick={() => handleConfirmDelete(el.id)}
                            >
                              Sí, eliminar
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ fontSize: 11, padding: '1px 7px' }}
                              onClick={handleCancelDelete}
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
                        {showBlocker && (
                          <div className="tree-delete-blocker">
                            {deleteBlocker!.message}
                          </div>
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

      {/* Sección de elementos sin ubicar */}
      {unplaced.length > 0 && (
        <div className="preview-unplaced-section">
          <div className="preview-unplaced-title">Sin ubicar ({unplaced.length})</div>
          <ul className="preview-unplaced-list">
            {unplaced.map((el) => {
              const sel = selectedId === el.id;
              const showConfirm = confirmDeleteId === el.id;
              const showBlocker = deleteBlocker?.id === el.id;
              return (
                <li key={el.id}>
                  <div
                    className={`preview-unplaced-item preview-unplaced-item--selectable${sel ? ' tree-item--selected' : ''}`}
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
                    <span className="preview-unplaced-badge">{CATEGORY_LABEL[el.category as Category]}</span>
                    <div className="tree-item-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="tree-action-btn"
                        aria-label={`Duplicar ${el.name}`}
                        title="Duplicar"
                        onClick={() => handleDuplicate(el)}
                      >
                        Dup
                      </button>
                      <button
                        type="button"
                        className="tree-action-btn tree-action-btn--danger"
                        aria-label={`Eliminar ${el.name}`}
                        title="Eliminar"
                        onClick={() => handleDeleteRequest(el)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  {showConfirm && (
                    <div className="tree-delete-confirm">
                      <span>¿Eliminar &quot;{el.name}&quot;?</span>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: 11, padding: '1px 7px' }}
                        onClick={() => handleConfirmDelete(el.id)}
                      >
                        Sí, eliminar
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: 11, padding: '1px 7px' }}
                        onClick={handleCancelDelete}
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                  {showBlocker && (
                    <div className="tree-delete-blocker">
                      {deleteBlocker!.message}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
