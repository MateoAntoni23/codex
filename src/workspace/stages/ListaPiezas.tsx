/**
 * Lista de piezas del proyecto agrupada por tipo (A3, interfaz 2026-11-14):
 * rectos, curvas planas, curvas verticales, T y X, derivaciones, eslabonadas,
 * soportes (y «otras» si aparece algo fuera de esos grupos). Cada grupo muestra su
 * cantidad y se pliega; un filtro de texto busca en los nombres visibles.
 * Clic en una fila: selecciona la pieza (o el soporte).
 */
import { useMemo, useState } from 'react';
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import type { Piece, Product } from '../../tray/model';
import { placedOf } from '../placement/definitions';
import { indexProducts, pieceLabel, pieceLabelById, productLabel } from './displayNames';
import { Empty, useRevealSelected } from './shared';

export type GrupoPieza = 'rectos' | 'curvas-planas' | 'curvas-verticales' | 't-x' | 'derivaciones' | 'eslabonadas' | 'soportes' | 'otras';

export const GRUPOS: ReadonlyArray<[GrupoPieza, string]> = [
  ['rectos', 'Rectos'],
  ['curvas-planas', 'Curvas planas'],
  ['curvas-verticales', 'Curvas verticales'],
  ['t-x', 'T y X'],
  ['derivaciones', 'Derivaciones'],
  ['eslabonadas', 'Eslabonadas'],
  ['soportes', 'Soportes'],
  ['otras', 'Otras'],
];

/** Grupo de una pieza por su tipo en el catálogo (la DCPS, «T» en el catálogo, va con las derivaciones). */
export function grupoDePieza(piece: Piece, product: Product | undefined, patron: string | undefined): GrupoPieza {
  const t = product?.tipo_pieza ?? '';
  if (patron === 'master:perforada:derivacion_lateral' || String(product?.sku ?? '').startsWith('DCPS-')) return 'derivaciones';
  if (t === 'recta') return 'rectos';
  if (t === 'curva horizontal') return 'curvas-planas';
  if (t === 'curva vertical articulada') return 'eslabonadas';
  if (t.startsWith('curva vertical')) return 'curvas-verticales';
  if (t === 'T' || t === 'X') return 't-x';
  void piece;
  return 'otras';
}

interface Fila { key: string; label: string; title?: string; activa: boolean; onClick: () => void }

export function ListaPiezas() {
  const entrada = useTrayStore((s) => s.entrada);
  const context = useTrayStore((s) => s.context);
  const selectedTrayId = useWorkspaceStore((s) => s.selectedTrayId);
  const selectedSupportId = useWorkspaceStore((s) => s.selectedSupportId);
  const selectTray = useWorkspaceStore((s) => s.selectTray);
  const selectSupport = useWorkspaceStore((s) => s.selectSupport);
  const pIdx = useMemo(() => indexProducts(context?.productos), [context]);
  const productos = useMemo(() => new Map<string, Product>((context?.productos ?? []).map((p) => [p.producto_id, p])), [context]);
  const [filtro, setFiltro] = useState('');
  const [plegados, setPlegados] = useState<Set<GrupoPieza>>(new Set());
  const [listEl, setListEl] = useState<HTMLElement | null>(null);
  useRevealSelected(listEl, selectedTrayId ? `piece:${selectedTrayId}` : selectedSupportId ? `support:${selectedSupportId}` : null);

  const piezas = entrada?.piezas ?? [];
  const filas = useMemo(() => {
    const out = new Map<GrupoPieza, Fila[]>(GRUPOS.map(([g]) => [g, []]));
    piezas.forEach((p, i) => {
      const g = grupoDePieza(p, productos.get(p.producto_id), entrada ? placedOf(entrada, p)?.def.patron : undefined);
      const desc = pIdx.get(p.producto_id)?.descripcion_original;
      out.get(g)!.push({
        key: `piece:${p.instancia_id}`, label: pieceLabel(p, i + 1, pIdx), title: typeof desc === 'string' ? desc : undefined,
        activa: selectedTrayId === p.instancia_id, onClick: () => selectTray(p.instancia_id),
      });
    });
    for (const s of entrada?.soportes ?? []) {
      out.get('soportes')!.push({
        key: `support:${s.soporte_id}`,
        label: `${productLabel(s.producto_id, pIdx)} · ${pieceLabelById(s.instancia_id, piezas, pIdx)} · ${s.distancia_desde_P1_mm} mm`,
        activa: selectedSupportId === s.soporte_id, onClick: () => selectSupport(s.soporte_id),
      });
    }
    return out;
  }, [piezas, entrada, productos, pIdx, selectedTrayId, selectedSupportId, selectTray, selectSupport]);

  const q = filtro.trim().toLowerCase();
  const total = piezas.length + (entrada?.soportes.length ?? 0);
  const alternar = (g: GrupoPieza) => setPlegados((prev) => {
    const n = new Set(prev);
    if (n.has(g)) n.delete(g); else n.add(g);
    return n;
  });

  return (
    <section className="stage-section" ref={setListEl} data-testid="piece-list">
      <h4 className="stage-section-title">Piezas ({piezas.length})</h4>
      {total === 0 && <Empty testid="tray-empty">Sin piezas todavía</Empty>}
      {total > 0 && (
        <input
          type="search"
          className="inspector-input"
          placeholder="Filtrar por nombre o código…"
          aria-label="Filtrar piezas"
          data-testid="piece-filter"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          style={{ width: '100%', margin: '2px 0 4px' }}
        />
      )}
      {GRUPOS.map(([g, nombre]) => {
        const todas = filas.get(g)!;
        const visibles = q ? todas.filter((f) => f.label.toLowerCase().includes(q)) : todas;
        if (!todas.length || (q && !visibles.length)) return null;
        // Plegado sólo si el operador lo plegó; con un filtro activo, siempre abierto.
        const abierto = !!q || !plegados.has(g) || visibles.some((f) => f.activa);
        return (
          <details key={g} className="grupo-piezas" open={abierto} data-testid={`grupo-${g}`} data-n={todas.length}>
            <summary onClick={(e) => { e.preventDefault(); alternar(g); }}>
              {nombre} ({q ? `${visibles.length} de ${todas.length}` : todas.length})
            </summary>
            {abierto && visibles.map((f) => (
              <button
                key={f.key}
                type="button"
                data-row-key={f.key}
                className={`workspace-tree-item stage-row${f.activa ? ' active' : ''}`}
                aria-current={f.activa ? 'true' : undefined}
                title={f.title}
                onClick={f.onClick}
              >
                {f.label}
              </button>
            ))}
          </details>
        );
      })}
    </section>
  );
}
