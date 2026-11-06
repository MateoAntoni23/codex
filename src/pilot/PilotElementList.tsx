/**
 * PilotElementList — lista izquierda con las 4 piezas piloto.
 *
 * Marca el estado de procedencia (medido / provisional) y las validaciones.
 * No permite agregar/eliminar; la vista es solo-lectura sobre datos auditados.
 */

import { getPilotData } from './pilotAdapter';
import { usePilotStore } from './usePilotStore';
import type { PiezaId } from './types';

const LABEL: Record<PiezaId, string> = {
  recto: 'Recto escalera',
  curva_90: 'Curva 90°',
  te: 'T',
  reduccion: 'Reducción',
};

export function PilotElementList() {
  const data = getPilotData();
  const selected = usePilotStore((s) => s.selection?.pieceId ?? null);
  const selectPiece = usePilotStore((s) => s.selectPiece);

  const items = (Object.keys(data.piezas) as PiezaId[]).map((id) => {
    const p = data.piezas[id];
    const provisional = id === 'curva_90';
    return (
      <li key={id}>
        <button
          type="button"
          className={`pilot-list-item${selected === id ? ' pilot-list-item--selected' : ''}`}
          onClick={() => selectPiece(id)}
        >
          <div className="pilot-list-name">{LABEL[id]}</div>
          <div className="pilot-list-sku">{p.producto_id}</div>
          <div className="pilot-list-meta">
            <span className={`pilot-badge pilot-badge--${provisional ? 'prov' : 'med'}`}>
              {provisional ? 'PROVISIONAL' : 'MEDIDO'}
            </span>
            <span className="pilot-list-valid">V1–V6 PASS</span>
          </div>
        </button>
      </li>
    );
  });

  return (
    <div className="pilot-list">
      <div className="pilot-list-title">Piezas piloto (geometría experimental)</div>
      <ul className="pilot-list-ul">{items}</ul>
    </div>
  );
}
