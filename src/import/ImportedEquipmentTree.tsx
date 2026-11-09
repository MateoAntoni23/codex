/**
 * ImportedEquipmentTree — sección del árbol que lista equipos del libro ELS-IMP-EQCX.
 * - Agrupa por categoría (del contrato: 22 posibles).
 * - Filtro por texto (tag/descripcion/sector) y toggle "mostrar RETIRADO".
 * - Al hacer clic selecciona el equipo importado y el inspector muestra la ficha técnica.
 * - La escena 3D NO cambia: muchos equipos importados no tienen ubicación 3D (A10).
 */
import { useMemo, useState } from 'react';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import type { EquipoImportado } from './types';

export function ImportedEquipmentTree() {
  const catalog = useWorkspaceStore((s) => s.importedCatalog);
  const selectedId = useWorkspaceStore((s) => s.selectedImportedEquipoId);
  const selectImportedEquipo = useWorkspaceStore((s) => s.selectImportedEquipo);

  const [query, setQuery] = useState('');
  const [showRetirados, setShowRetirados] = useState(false);

  const grouped = useMemo(() => {
    if (!catalog) return [] as Array<{ categoria: string; equipos: EquipoImportado[] }>;
    const q = query.trim().toLowerCase();
    const filtered = catalog.equipos.filter((e) => {
      if (!showRetirados && e.estadoAlcance === 'RETIRADO') return false;
      if (!q) return true;
      return (
        e.tag.toLowerCase().includes(q) ||
        e.descripcion.toLowerCase().includes(q) ||
        (e.sector?.toLowerCase().includes(q) ?? false) ||
        (e.planta?.toLowerCase().includes(q) ?? false) ||
        e.equipoId.toLowerCase().includes(q)
      );
    });
    const byCat = new Map<string, EquipoImportado[]>();
    for (const e of filtered) {
      const k = e.categoria || '(sin categoría)';
      const arr = byCat.get(k);
      if (arr) arr.push(e);
      else byCat.set(k, [e]);
    }
    return [...byCat.entries()]
      .map(([categoria, equipos]) => ({
        categoria,
        equipos: equipos.sort((a, b) => a.tag.localeCompare(b.tag)),
      }))
      .sort((a, b) => a.categoria.localeCompare(b.categoria));
  }, [catalog, query, showRetirados]);

  if (!catalog) return null;

  const total = catalog.equipos.length;
  const retiradosTotal = catalog.equipos.filter((e) => e.estadoAlcance === 'RETIRADO').length;
  const filteredCount = grouped.reduce((n, g) => n + g.equipos.length, 0);

  return (
    <section className="workspace-tree-section imported-tree-section">
      <h3>Equipos importados ({filteredCount}/{total})</h3>
      <div className="import-filters" style={{ marginBottom: 6 }}>
        <input
          type="text"
          placeholder="Buscar TAG, descripción, sector…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8f9ba3', marginBottom: 6 }}>
        <input
          type="checkbox"
          checked={showRetirados}
          onChange={(e) => setShowRetirados(e.target.checked)}
        />
        Incluir RETIRADOS ({retiradosTotal})
      </label>

      {grouped.length === 0 && (
        <p className="workspace-empty" style={{ fontSize: 11 }}>
          Sin coincidencias.
        </p>
      )}

      {grouped.map(({ categoria, equipos }) => (
        <details key={categoria} className="imported-tree-category" open>
          <summary>{categoria} ({equipos.length})</summary>
          {equipos.map((e) => {
            const isSel = selectedId === e.equipoId;
            const isRet = e.estadoAlcance === 'RETIRADO';
            const cls = [
              'imported-tree-item',
              isSel ? 'selected' : '',
              isRet ? 'retirado' : '',
            ].filter(Boolean).join(' ');
            return (
              <div
                key={e.equipoId}
                className={cls}
                onClick={() => selectImportedEquipo(e.equipoId)}
                role="button"
                tabIndex={0}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    selectImportedEquipo(e.equipoId);
                  }
                }}
                title={e.descripcion}
              >
                <span className="tag">{e.tag}</span>
                <span className="id">{e.equipoId}</span>
              </div>
            );
          })}
        </details>
      ))}
    </section>
  );
}
