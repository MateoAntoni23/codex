/**
 * Etapa 1 — Equipos.
 *
 * Una sola lista agrupada por categoría con los equipos del proyecto y los
 * importados del Excel (ubicados o no). Filtro Todos / Sin ubicar / Ubicados y
 * buscador. Herramientas: Seleccionar, Ubicar, Mover, Rotar.
 *
 * Compatibilidad: la sección conserva las clases `imported-tree-section` /
 * `imported-tree-item`, el buscador de texto y el conmutador "Incluir RETIRADOS"
 * que usan las pruebas E2E existentes.
 */
import { useMemo, useState } from 'react';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { mapImportCategoria } from '../../import/placement';
import { nextDefaultPositionForCategoria } from '../../import/ImportedEquipmentInspector';
import { PreviewAddForm } from '../../preview/PreviewAddForm';
import type { Category, EquipmentElement } from '../../types/domain-v2';
import { CATEGORY_LABEL } from './labels';
import { Empty, ToolBar, useRevealSelected } from './shared';

type PlacementFilter = 'todos' | 'sin-ubicar' | 'ubicados';

interface Row {
  key: string;
  category: Category;
  title: string;
  subtitle: string | null;
  placed: boolean;
  retirado: boolean;
  /** equipoId del Excel (si la fila viene del catálogo importado). */
  equipoId: string | null;
  elementId: string | null;
  badge: 'placed' | 'unplaced' | 'pending' | null;
}

function rowSearchText(r: Row): string {
  return `${r.title} ${r.subtitle ?? ''}`.toLowerCase();
}

/** Rota 90° alrededor del eje vertical (Z del dominio) un equipo ubicado. */
export function rotateElementZ90(el: EquipmentElement): EquipmentElement | null {
  if (el.placementStatus !== 'placed' || !el.transform) return null;
  const q = el.transform.rotation;
  const s = Math.SQRT1_2; // sin(45°) = cos(45°)
  // q' = qz * q, con qz = (0, 0, s, s)
  const rotation = {
    x: s * q.x - s * q.y,
    y: s * q.y + s * q.x,
    z: s * q.z + s * q.w,
    w: s * q.w - s * q.z,
  };
  return { ...el, transform: { ...el.transform, rotation } } as EquipmentElement;
}

export function EquiposPanel({ onOpenImportWizard }: { onOpenImportWizard: () => void }) {
  const elements = useWorkspaceStore((s) => s.elements);
  const catalog = useWorkspaceStore((s) => s.importedCatalog);
  const selectedEquipId = useWorkspaceStore((s) => s.selectedEquipId);
  const selectedImportedId = useWorkspaceStore((s) => s.selectedImportedEquipoId);
  const selectEquip = useWorkspaceStore((s) => s.selectEquip);
  const selectImportedEquipo = useWorkspaceStore((s) => s.selectImportedEquipo);
  const layers = useWorkspaceStore((s) => s.layers);
  const toggleLayer = useWorkspaceStore((s) => s.toggleLayer);
  const moveMode = useWorkspaceStore((s) => s.moveMode);
  const setMoveMode = useWorkspaceStore((s) => s.setMoveMode);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PlacementFilter>('todos');
  const [showRetirados, setShowRetirados] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<Category>>(new Set());
  const [adding, setAdding] = useState(false);
  const [listEl, setListEl] = useState<HTMLElement | null>(null);
  const [rotateMsg, setRotateMsg] = useState<string | null>(null);

  // ── Filas: importados (ubicados o no) + equipos propios del proyecto ──────
  const allRows = useMemo<Row[]>(() => {
    const byEquipoId = new Map<string, EquipmentElement>();
    for (const el of elements) if (el.importedRef) byEquipoId.set(el.importedRef.equipoId, el);
    const rows: Row[] = [];
    for (const e of catalog?.equipos ?? []) {
      const linked = byEquipoId.get(e.equipoId);
      const placed = linked?.placementStatus === 'placed';
      rows.push({
        key: `imp:${e.equipoId}`,
        category: linked && linked.category !== 'infrastructure' ? linked.category : mapImportCategoria(e.categoria),
        title: e.tag || e.descripcion,
        subtitle: e.tag ? e.descripcion : null,
        placed,
        retirado: e.estadoAlcance === 'RETIRADO',
        equipoId: e.equipoId,
        elementId: linked?.id ?? null,
        badge: linked ? (placed ? 'placed' : 'unplaced') : 'pending',
      });
    }
    for (const el of elements) {
      if (el.importedRef) continue; // ya figura por su fila del Excel
      if (el.category === 'infrastructure') continue; // etapa Planta
      rows.push({
        key: `el:${el.id}`,
        category: el.category,
        title: el.tag || el.name,
        subtitle: el.tag ? el.name : null,
        placed: el.placementStatus === 'placed',
        retirado: false,
        equipoId: null,
        elementId: el.id,
        badge: null,
      });
    }
    return rows;
  }, [catalog, elements]);

  // Fila de la selección actual (equipo propio, importado, o importado vinculado).
  const selectedRow = useMemo(() => {
    if (selectedImportedId) return allRows.find((r) => r.equipoId === selectedImportedId) ?? null;
    if (selectedEquipId) return allRows.find((r) => r.elementId === selectedEquipId) ?? null;
    return null;
  }, [allRows, selectedEquipId, selectedImportedId]);

  // 3a: si la selección llega desde la escena y su fila está oculta por un
  // filtro o un grupo plegado, se muestra.
  const [lastRevealed, setLastRevealed] = useState<string | null>(null);
  if (!selectedRow && lastRevealed !== null) setLastRevealed(null);
  if (selectedRow && selectedRow.key !== lastRevealed) {
    setLastRevealed(selectedRow.key);
    if (collapsed.has(selectedRow.category)) {
      const next = new Set(collapsed);
      next.delete(selectedRow.category);
      setCollapsed(next);
    }
    const q = query.trim().toLowerCase();
    if (q && !rowSearchText(selectedRow).includes(q)) setQuery('');
    if ((filter === 'ubicados' && !selectedRow.placed) || (filter === 'sin-ubicar' && selectedRow.placed)) setFilter('todos');
    if (selectedRow.retirado && !showRetirados) setShowRetirados(true);
  }
  useRevealSelected(listEl, selectedRow?.key ?? null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter((r) => {
      if (r.retirado && !showRetirados) return false;
      if (filter === 'ubicados' && !r.placed) return false;
      if (filter === 'sin-ubicar' && r.placed) return false;
      return !q || rowSearchText(r).includes(q);
    });
  }, [allRows, query, filter, showRetirados]);

  const groups = useMemo(() => {
    const m = new Map<Category, Row[]>();
    for (const r of visible) {
      const arr = m.get(r.category);
      if (arr) arr.push(r);
      else m.set(r.category, [r]);
    }
    return [...m.entries()]
      .map(([cat, rows]) => ({ cat, rows: rows.sort((a, b) => a.title.localeCompare(b.title)) }))
      .sort((a, b) => CATEGORY_LABEL[a.cat].localeCompare(CATEGORY_LABEL[b.cat]));
  }, [visible]);

  const importedTotal = catalog?.equipos.length ?? 0;
  const importedShown = visible.filter((r) => r.equipoId).length;
  const ownCount = visible.filter((r) => !r.equipoId).length;

  const pick = (r: Row) => {
    if (r.equipoId) {
      // Ficha del Excel en el inspector y, si ya está ubicado, también marcado en la escena (B4).
      selectImportedEquipo(r.equipoId);
      if (r.elementId) useWorkspaceStore.setState({ selectedEquipId: r.elementId });
    } else if (r.elementId) selectEquip(r.elementId);
  };

  // ── Herramientas ─────────────────────────────────────────────────────────
  const selectedElement = selectedEquipId ? elements.find((e) => e.id === selectedEquipId) ?? null : null;
  const selectedImported = selectedImportedId ? catalog?.equipos.find((e) => e.equipoId === selectedImportedId) ?? null : null;
  const importedLinked = selectedImportedId ? elements.find((e) => e.importedRef?.equipoId === selectedImportedId) ?? null : null;
  const canPlace = Boolean(selectedImported && !importedLinked);
  const canMove = Boolean(selectedElement && selectedElement.placementStatus === 'placed' && selectedElement.parentId === null);

  const placeSelected = () => {
    if (!selectedImported) return;
    const st = useWorkspaceStore.getState();
    const placedCount = st.elements.filter((e) => e.importedRef !== null && e.placementStatus === 'placed').length;
    const id = st.placeImportedEquipo(selectedImported.equipoId, nextDefaultPositionForCategoria(selectedImported.categoria, placedCount));
    if (id) {
      st.selectEquip(id);
      requestAnimationFrame(() => {
        const w = window as typeof window & { __codex?: { focusElement?: (id: string) => unknown } };
        w.__codex?.focusElement?.(id);
      });
    }
  };

  const rotateSelected = () => {
    if (!selectedElement || !canMove) return;
    const next = rotateElementZ90(selectedElement);
    if (next) {
      useWorkspaceStore.getState().updateElement(next);
      setRotateMsg('Rotado 90° sobre el eje vertical.');
    }
  };

  const activeTool = moveMode ? 'mover' : 'seleccionar';

  return (
    <div className="stage-panel" data-testid="panel-equipos">
      <ToolBar
        stage="equipos"
        active={activeTool}
        tools={[
          { id: 'seleccionar', label: 'Seleccionar' },
          { id: 'ubicar', label: 'Ubicar', disabled: !canPlace, title: canPlace ? 'Colocar en escena el equipo importado seleccionado' : 'Elegí un equipo importado sin ubicar' },
          { id: 'mover', label: 'Mover', disabled: !canMove, title: canMove ? 'Gizmo XYZ para mover el equipo' : 'Elegí un equipo ubicado (sin padre)' },
          { id: 'rotar', label: 'Rotar 90°', disabled: !canMove, title: canMove ? 'Rota el equipo 90° sobre el eje vertical' : 'Elegí un equipo ubicado (sin padre)' },
        ]}
        onPick={(t) => {
          setRotateMsg(null);
          if (t === 'seleccionar') setMoveMode(false);
          else if (t === 'ubicar') placeSelected();
          else if (t === 'mover') setMoveMode(!moveMode);
          else if (t === 'rotar') rotateSelected();
        }}
      />
      {rotateMsg && <p className="stage-note" role="status">{rotateMsg}</p>}

      <div className="stage-actions">
        <button type="button" onClick={onOpenImportWizard} data-testid="open-import-wizard">Importar Excel</button>
        <button type="button" onClick={() => setAdding((v) => !v)} data-testid="new-equipment" aria-expanded={adding}>
          Nuevo equipo
        </button>
      </div>

      {adding && (
        <div className="stage-inline-form" data-testid="new-equipment-form">
          <PreviewAddForm
            onCreated={(el) => {
              useWorkspaceStore.getState().addElement(el);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      <section className="workspace-tree-section imported-tree-section stage-section" ref={setListEl} data-testid="equipment-list">
        <h3 className="stage-section-title">
          {catalog ? `Equipos importados (${importedShown}/${importedTotal})` : `Equipos (${ownCount})`}
          {catalog && ownCount > 0 ? ` · propios ${ownCount}` : ''}
        </h3>
        <div className="import-filters">
          <input
            type="text"
            placeholder="Buscar TAG, nombre, descripción…"
            aria-label="Buscar equipos"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="equipment-search"
          />
        </div>
        <div className="stage-segmented" role="radiogroup" aria-label="Filtrar por ubicación">
          {([['todos', 'Todos'], ['sin-ubicar', 'Sin ubicar'], ['ubicados', 'Ubicados']] as const).map(([v, label]) => (
            <label key={v} className={filter === v ? 'is-active' : ''}>
              <input type="radio" name="equip-filter" value={v} checked={filter === v} onChange={() => setFilter(v)} data-testid={`equipment-filter-${v}`} />
              {label}
            </label>
          ))}
        </div>
        {catalog && (
          <label className="stage-check">
            <input type="checkbox" checked={showRetirados} onChange={(e) => setShowRetirados(e.target.checked)} />
            Incluir RETIRADOS ({catalog.equipos.filter((e) => e.estadoAlcance === 'RETIRADO').length})
          </label>
        )}
        <label className="stage-check">
          <input type="checkbox" checked={layers.equipment} onChange={() => toggleLayer('equipment')} />
          Equipos visibles en la escena
        </label>

        {allRows.length === 0 && (
          <Empty testid="equipment-empty">Sin equipos. Importá el Excel o creá un equipo nuevo.</Empty>
        )}
        {allRows.length > 0 && visible.length === 0 && <Empty>Sin coincidencias.</Empty>}

        {groups.map(({ cat, rows }) => {
          const open = !collapsed.has(cat);
          return (
            <details key={cat} open={open} className="imported-tree-category" data-testid={`equipment-group-${cat}`}>
              <summary
                onClick={(ev) => {
                  ev.preventDefault();
                  const next = new Set(collapsed);
                  if (open) next.add(cat);
                  else next.delete(cat);
                  setCollapsed(next);
                }}
              >
                {CATEGORY_LABEL[cat]} ({rows.length})
              </summary>
              {open && rows.map((r) => {
                const isSel = selectedRow?.key === r.key;
                return (
                  <div
                    key={r.key}
                    data-row-key={r.key}
                    className={`imported-tree-item stage-row${isSel ? ' selected active' : ''}${r.retirado ? ' retirado' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-current={isSel ? 'true' : undefined}
                    onClick={() => pick(r)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        pick(r);
                      }
                    }}
                    title={r.subtitle ?? r.title}
                  >
                    <span className="tag">{r.title}</span>
                    {r.subtitle && <span className="stage-row-sub">{r.subtitle}</span>}
                    {r.badge ? (
                      <span className={`stage-badge tone-${r.badge === 'placed' ? 'ok' : r.badge === 'unplaced' ? 'warn' : 'neutral'}`} data-testid={`imp-badge-${r.badge}`}>
                        {r.badge === 'placed' ? 'Ubicado' : r.badge === 'unplaced' ? 'En proyecto' : 'Sin ubicar'}
                      </span>
                    ) : (
                      <span className={`stage-badge tone-${r.placed ? 'ok' : 'neutral'}`}>{r.placed ? 'Ubicado' : 'Sin ubicar'}</span>
                    )}
                  </div>
                );
              })}
            </details>
          );
        })}
      </section>
    </div>
  );
}

