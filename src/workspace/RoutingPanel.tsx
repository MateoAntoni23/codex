/**
 * RoutingPanel — right-panel UI for interactive tray routing.
 *
 * Step 1 — selectingPort:   instructions; user clicks a port in the scene.
 * Step 2 — configuringSegment: pick product, length, snap; compatibility check.
 * Step 3 — confirmingReduction: pick reduction candidate, set reduction length.
 *
 * Atomic commit: ALL new pieces + connections written to tray store in one edit() call.
 * Cancel at any step leaves the tray unchanged.
 */
import { useMemo, useState } from 'react';
import { useTrayStore } from '../tray/store';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useRoutingStore } from './useRoutingStore';
import {
  getFreePorts,
  checkDirectCompatibility,
  findReductionCandidates,
  computeEndpoint,
  snapDirectionToAxis,
  generateConnectionId,
} from './routingRules';
import { buildSegmentPiece, generateSegmentId } from './addTraySegment';

// ─── Step 1: selecting port ───────────────────────────────────────────────────

function StepSelectingPort() {
  const entrada = useTrayStore((s) => s.entrada);
  const freePorts = useMemo(() => {
    if (!entrada) return [];
    return getFreePorts(entrada.piezas, entrada.conexiones);
  }, [entrada]);

  return (
    <div style={{ padding: '10px 12px', fontSize: 11 }}>
      <p style={{ color: '#99aadd', marginBottom: 8, lineHeight: 1.5 }}>
        Acercá el puntero a una pieza en la escena para ver sus puertos libres (esferas naranjas) y hacé clic para continuar desde allí.
      </p>
      {freePorts.length === 0 ? (
        <p style={{ color: '#ff9955', fontSize: 10 }}>Sin puertos libres — todas las bocas están ocupadas.</p>
      ) : (
        <p style={{ color: '#556677', fontSize: 10 }}>{freePorts.length} puerto{freePorts.length !== 1 ? 's' : ''} libre{freePorts.length !== 1 ? 's' : ''} disponible{freePorts.length !== 1 ? 's' : ''}.</p>
      )}
    </div>
  );
}

// ─── Step 2: configuring segment ─────────────────────────────────────────────

function StepConfiguringSegment({ onConfirmDirect, onNeedsReduction, onCancel }: {
  onConfirmDirect: () => void;
  onNeedsReduction: () => void;
  onCancel: () => void;
}) {
  const context          = useTrayStore((s) => s.context);
  const entrada          = useTrayStore((s) => s.entrada);
  const startPort        = useRoutingStore((s) => s.startPort);
  const selectedProductId = useRoutingStore((s) => s.selectedProductId);
  const previewLengthMm  = useRoutingStore((s) => s.previewLengthMm);
  const snapToAxis       = useRoutingStore((s) => s.snapToAxis);
  const setProduct       = useRoutingStore((s) => s.setProduct);
  const setLength        = useRoutingStore((s) => s.setLength);
  const toggleSnap       = useRoutingStore((s) => s.toggleSnap);

  const [error, setError] = useState<string | null>(null);

  const rectaProducts = useMemo(
    () => context?.productos.filter((p) => p.tipo_pieza === 'recta') ?? [],
    [context?.productos],
  );

  // Auto-select first product if none selected
  const effectiveProductId = selectedProductId || rectaProducts[0]?.producto_id || '';

  const selectedProduct = useMemo(
    () => context?.productos.find((p) => p.producto_id === effectiveProductId),
    [context?.productos, effectiveProductId],
  );

  // Find the product of the existing piece at the start port
  const existingPiece = useMemo(
    () => entrada?.piezas.find((p) => p.instancia_id === startPort?.pieceId),
    [entrada?.piezas, startPort?.pieceId],
  );
  const existingProduct = useMemo(
    () => context?.productos.find((p) => p.producto_id === existingPiece?.producto_id),
    [context?.productos, existingPiece?.producto_id],
  );

  const compat = useMemo(() => {
    if (!existingProduct || !selectedProduct) return null;
    return checkDirectCompatibility(existingProduct, selectedProduct);
  }, [existingProduct, selectedProduct]);

  const effectiveDir = useMemo(() => {
    if (!startPort) return null;
    return snapToAxis ? snapDirectionToAxis(startPort.dir) : startPort.dir;
  }, [startPort, snapToAxis]);

  const handleConfirm = () => {
    setError(null);
    if (!compat) { setError('Seleccioná un producto.'); return; }
    if (!compat.ok && !compat.needsReduction) { setError(compat.reason); return; }
    if (compat.needsReduction) { onNeedsReduction(); return; }
    onConfirmDirect();
  };

  if (!startPort) return null;

  return (
    <div style={{ padding: '10px 12px', fontSize: 11 }}>
      {/* Start port info */}
      <div style={{ marginBottom: 10, padding: '6px 8px', background: '#1a1e30', borderRadius: 3 }}>
        <div style={{ color: '#8888aa', marginBottom: 2 }}>Puerto de inicio</div>
        <div style={{ color: '#ffaa44', fontFamily: 'monospace' }}>
          {startPort.pieceId}.{startPort.portName}
        </div>
        {existingPiece && (
          <div style={{ color: '#556677', fontSize: 10, marginTop: 2 }}>
            {existingPiece.producto_id}
            {existingProduct?.ancho_nominal_mm != null &&
              ` · ${existingProduct.ancho_nominal_mm} mm`}
          </div>
        )}
      </div>

      {/* Product selector */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ color: '#8888aa', display: 'block', marginBottom: 3 }}>
          Producto a continuar
        </label>
        {rectaProducts.length === 0 ? (
          <p style={{ color: '#ff9955' }}>Sin productos rectos en el catálogo.</p>
        ) : (
          <select
            className="inspector-input"
            style={{ width: '100%' }}
            value={effectiveProductId}
            onChange={(e) => { setProduct(e.target.value); setError(null); }}
          >
            {rectaProducts.map((p) => (
              <option key={p.producto_id} value={p.producto_id}>
                {p.sku} — {p.ancho_nominal_mm ?? '?'} mm
                {(p as Record<string, unknown>).ala_nominal_mm != null
                  ? ` · ala ${(p as Record<string, unknown>).ala_nominal_mm} mm`
                  : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Compatibility feedback */}
      {compat && (
        <div style={{
          marginBottom: 8,
          padding: '5px 8px',
          borderRadius: 3,
          fontSize: 10,
          background: compat.ok ? '#1a2e1a' : compat.needsReduction ? '#2a2a1a' : '#2a1a1a',
          color: compat.ok ? '#77cc77' : compat.needsReduction ? '#cccc66' : '#ff7755',
          borderLeft: `2px solid ${compat.ok ? '#44aa44' : compat.needsReduction ? '#aaaa44' : '#aa4444'}`,
        }}>
          {compat.reason}
        </div>
      )}

      {/* Length input */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ color: '#8888aa', display: 'block', marginBottom: 3 }}>
          Longitud del tramo (mm)
        </label>
        <input
          type="number"
          className="inspector-input"
          style={{ width: '100%' }}
          min={1}
          step={100}
          value={previewLengthMm}
          onChange={(e) => setLength(Number(e.target.value))}
        />
      </div>

      {/* Axis snap */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, cursor: 'pointer', fontSize: 11, color: '#8888aa' }}>
        <input type="checkbox" checked={snapToAxis} onChange={toggleSnap} />
        Ajustar al eje dominante
        {effectiveDir && snapToAxis && (
          <span style={{ color: '#99aadd', fontSize: 10 }}>
            ({effectiveDir.map(v => v.toFixed(0)).join(', ')})
          </span>
        )}
      </label>

      {error && (
        <div style={{ color: '#ff7755', marginBottom: 8, fontSize: 11 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          style={{
            flex: 1, padding: '5px 0', fontSize: 12,
            background: compat?.needsReduction ? '#3d3322' : '#1f3322',
            color: 'white',
            border: `1px solid ${compat?.needsReduction ? '#aa8833' : '#336644'}`,
            borderRadius: 3, cursor: 'pointer',
          }}
          onClick={handleConfirm}
          disabled={!selectedProduct}
        >
          {compat?.needsReduction ? 'Elegir reducción →' : 'Confirmar continuación'}
        </button>
        <button
          style={{ padding: '5px 10px', fontSize: 12, background: '#333355', color: '#8888aa', border: '1px solid #445566', borderRadius: 3, cursor: 'pointer' }}
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: confirming reduction ────────────────────────────────────────────

function StepConfirmingReduction({ onConfirm, onBack }: {
  onConfirm: () => void;
  onBack: () => void;
}) {
  const context           = useTrayStore((s) => s.context);
  const entrada           = useTrayStore((s) => s.entrada);
  const startPort         = useRoutingStore((s) => s.startPort);
  const selectedProductId = useRoutingStore((s) => s.selectedProductId);
  const reductionProductId = useRoutingStore((s) => s.reductionProductId);
  const reductionLengthMm = useRoutingStore((s) => s.reductionLengthMm);
  const setReductionProduct = useRoutingStore((s) => s.setReductionProduct);
  const setReductionLength  = useRoutingStore((s) => s.setReductionLength);

  const [error, setError] = useState<string | null>(null);

  const existingProduct = useMemo(() => {
    const piece = entrada?.piezas.find((p) => p.instancia_id === startPort?.pieceId);
    return context?.productos.find((p) => p.producto_id === piece?.producto_id);
  }, [context?.productos, entrada?.piezas, startPort?.pieceId]);

  const candidates = useMemo(
    () => existingProduct ? findReductionCandidates(existingProduct, context?.productos ?? []) : [],
    [existingProduct, context?.productos],
  );

  const effectiveReductionId = reductionProductId || candidates[0]?.producto_id || '';

  const newProduct = useMemo(
    () => context?.productos.find((p) => p.producto_id === selectedProductId),
    [context?.productos, selectedProductId],
  );

  const handleConfirm = () => {
    setError(null);
    if (!effectiveReductionId) { setError('Seleccioná una reducción.'); return; }
    if (reductionLengthMm <= 0) { setError('La longitud de la reducción debe ser mayor que 0.'); return; }
    onConfirm();
  };

  if (!startPort) return null;

  return (
    <div style={{ padding: '10px 12px', fontSize: 11 }}>
      <div style={{ marginBottom: 8, fontSize: 11, color: '#cccc66' }}>
        Se necesita una reducción entre el tramo existente y el nuevo.
      </div>

      {candidates.length === 0 ? (
        <div style={{ padding: '8px', background: '#2a1a1a', borderRadius: 3, color: '#ff7755', fontSize: 10 }}>
          No se encontraron reducciones compatibles en el catálogo para este tramo. Verificá que el catálogo incluya reducciones de la familia y ancho correspondientes.
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>
            <label style={{ color: '#8888aa', display: 'block', marginBottom: 3 }}>
              Producto de reducción
            </label>
            <select
              className="inspector-input"
              style={{ width: '100%' }}
              value={effectiveReductionId}
              onChange={(e) => { setReductionProduct(e.target.value); setError(null); }}
            >
              {candidates.map((p) => (
                <option key={p.producto_id} value={p.producto_id}>
                  {p.sku}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 10, color: '#445566', marginTop: 3 }}>
              {candidates.find(p => p.producto_id === effectiveReductionId)?.descripcion_original}
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ color: '#8888aa', display: 'block', marginBottom: 3 }}>
              Longitud de la reducción (mm)
            </label>
            <input
              type="number"
              className="inspector-input"
              style={{ width: '100%' }}
              min={1}
              step={50}
              value={reductionLengthMm}
              onChange={(e) => setReductionLength(Number(e.target.value))}
            />
          </div>

          {/* Summary */}
          <div style={{ marginBottom: 8, padding: '6px 8px', background: '#1a2235', borderRadius: 3, fontSize: 10, color: '#8899bb', lineHeight: 1.5 }}>
            Tramo existente → reducción ({reductionLengthMm} mm) → nuevo tramo ({newProduct?.ancho_nominal_mm ?? '?'} mm)
          </div>

          {error && (
            <div style={{ color: '#ff7755', marginBottom: 8, fontSize: 11 }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{ flex: 1, padding: '5px 0', fontSize: 12, background: '#1f3322', color: 'white', border: '1px solid #336644', borderRadius: 3, cursor: 'pointer' }}
              onClick={handleConfirm}
            >
              Confirmar con reducción
            </button>
            <button
              style={{ padding: '5px 10px', fontSize: 12, background: '#333355', color: '#8888aa', border: '1px solid #445566', borderRadius: 3, cursor: 'pointer' }}
              onClick={onBack}
            >
              ← Atrás
            </button>
          </div>
        </>
      )}

      {candidates.length === 0 && (
        <button
          style={{ marginTop: 8, width: '100%', padding: '5px 0', fontSize: 11, background: '#333355', color: '#8888aa', border: '1px solid #445566', borderRadius: 3, cursor: 'pointer' }}
          onClick={onBack}
        >
          ← Volver
        </button>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function RoutingPanel() {
  const context          = useTrayStore((s) => s.context);
  const entrada          = useTrayStore((s) => s.entrada);
  const trayEdit         = useTrayStore((s) => s.edit);
  const markDirty        = useWorkspaceStore((s) => s.markDirty);
  const selectTray       = useWorkspaceStore((s) => s.selectTray);

  const step              = useRoutingStore((s) => s.step);
  const startPort         = useRoutingStore((s) => s.startPort);
  const selectedProductId = useRoutingStore((s) => s.selectedProductId);
  const previewLengthMm   = useRoutingStore((s) => s.previewLengthMm);
  const snapToAxis        = useRoutingStore((s) => s.snapToAxis);
  const reductionProductId = useRoutingStore((s) => s.reductionProductId);
  const reductionLengthMm = useRoutingStore((s) => s.reductionLengthMm);
  const deactivate        = useRoutingStore((s) => s.deactivate);
  const proceedToReduction = useRoutingStore((s) => s.proceedToReduction);
  const back              = useRoutingStore((s) => s.back);

  const [commitError, setCommitError] = useState<string | null>(null);

  const rectaProducts = useMemo(
    () => context?.productos.filter((p) => p.tipo_pieza === 'recta') ?? [],
    [context?.productos],
  );

  const getEffectiveDir = () => {
    if (!startPort) return null;
    return snapToAxis ? snapDirectionToAxis(startPort.dir) : startPort.dir;
  };

  const getEffectiveProductId = () =>
    selectedProductId || rectaProducts[0]?.producto_id || '';

  const getNewPieceId = (existingIds: Set<string>) => generateSegmentId(existingIds);

  const commitDirect = () => {
    setCommitError(null);
    if (!entrada || !startPort) return;

    const effDir = getEffectiveDir();
    if (!effDir) return;

    const effProductId = getEffectiveProductId();
    if (!effProductId) { setCommitError('Sin producto seleccionado.'); return; }

    if (previewLengthMm <= 0) { setCommitError('La longitud debe ser mayor que 0.'); return; }

    try {
      const next = structuredClone(entrada);
      const pieceIds = new Set(next.piezas.map((p) => p.instancia_id));
      const connIds = new Set(next.conexiones.map((c) => c.conexion_id));

      const newId = getNewPieceId(pieceIds);
      const startPos = startPort.pos;
      const endPos = computeEndpoint(startPos, effDir, previewLengthMm);
      const newPiece = buildSegmentPiece(newId, effProductId, startPos, endPos);

      const connId = generateConnectionId(connIds);
      const conn = {
        conexion_id: connId,
        a: [startPort.pieceId, startPort.portName] as [string, string],
        b: [newId, 'P1'] as [string, string],
      };

      next.piezas.push(newPiece);
      next.conexiones.push(conn);
      trayEdit(next);
      selectTray(newId);
      markDirty();
      deactivate();
    } catch (e) {
      setCommitError(`Error al crear la pieza: ${String(e)}`);
    }
  };

  const commitWithReduction = () => {
    setCommitError(null);
    if (!entrada || !startPort) return;

    const effDir = getEffectiveDir();
    if (!effDir) return;

    const effProductId = getEffectiveProductId();
    const effReductionId = reductionProductId || context?.productos.find((p) => p.tipo_pieza === 'reducción')?.producto_id || '';

    if (!effProductId || !effReductionId) {
      setCommitError('Seleccioná producto y reducción.');
      return;
    }
    if (reductionLengthMm <= 0 || previewLengthMm <= 0) {
      setCommitError('Las longitudes deben ser mayores que 0.');
      return;
    }

    try {
      const next = structuredClone(entrada);
      const pieceIds = new Set(next.piezas.map((p) => p.instancia_id));
      const connIds = new Set(next.conexiones.map((c) => c.conexion_id));

      // Reduction piece
      const redId = getNewPieceId(pieceIds);
      pieceIds.add(redId);
      const redStart = startPort.pos;
      const redEnd = computeEndpoint(redStart, effDir, reductionLengthMm);
      const redPiece = buildSegmentPiece(redId, effReductionId, redStart, redEnd);

      // Continuation piece
      const newId = getNewPieceId(pieceIds);
      const contEnd = computeEndpoint(redEnd, effDir, previewLengthMm);
      const newPiece = buildSegmentPiece(newId, effProductId, redEnd, contEnd);

      // Two connections
      const conn1Id = generateConnectionId(connIds);
      connIds.add(conn1Id);
      const conn1 = {
        conexion_id: conn1Id,
        a: [startPort.pieceId, startPort.portName] as [string, string],
        b: [redId, 'P1'] as [string, string],
      };

      const conn2Id = generateConnectionId(connIds);
      const conn2 = {
        conexion_id: conn2Id,
        a: [redId, 'P2'] as [string, string],
        b: [newId, 'P1'] as [string, string],
      };

      next.piezas.push(redPiece, newPiece);
      next.conexiones.push(conn1, conn2);
      trayEdit(next);
      selectTray(newId);
      markDirty();
      deactivate();
    } catch (e) {
      setCommitError(`Error al crear las piezas: ${String(e)}`);
    }
  };

  return (
    <div className="inspector-panel" style={{ padding: 0 }}>
      <div className="inspector-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#ff9900' }}>
          ● Continuando trazado
        </span>
        <button
          style={{ fontSize: 10, padding: '2px 8px', background: '#3a2200', color: '#cc8844', border: '1px solid #664422', borderRadius: 2, cursor: 'pointer' }}
          onClick={deactivate}
        >
          Cancelar
        </button>
      </div>

      <div style={{ padding: '4px 12px 2px', fontSize: 10, color: '#556677' }}>
        {step === 'selectingPort' && 'Paso 1 / 2 — Seleccioná un puerto libre'}
        {step === 'configuringSegment' && 'Paso 2 / 2 — Configurá el nuevo tramo'}
        {step === 'confirmingReduction' && 'Reducción — Elegí el accesorio de transición'}
      </div>

      {step === 'selectingPort' && <StepSelectingPort />}

      {step === 'configuringSegment' && (
        <StepConfiguringSegment
          onConfirmDirect={commitDirect}
          onNeedsReduction={proceedToReduction}
          onCancel={deactivate}
        />
      )}

      {step === 'confirmingReduction' && (
        <StepConfirmingReduction
          onConfirm={commitWithReduction}
          onBack={back}
        />
      )}

      {commitError && (
        <div style={{ padding: '6px 12px', fontSize: 11, color: '#ff7755' }}>{commitError}</div>
      )}
    </div>
  );
}

export function RoutingStatusBadge() {
  const active = useRoutingStore((s) => s.active);
  const step   = useRoutingStore((s) => s.step);
  if (!active) return null;
  return (
    <span style={{ color: '#ff9900', fontWeight: 600 }}>
      {' '}● Modo trazado —{' '}
      {step === 'selectingPort' && 'seleccioná un puerto'}
      {step === 'configuringSegment' && 'configurando tramo'}
      {step === 'confirmingReduction' && 'eligiendo reducción'}
    </span>
  );
}
