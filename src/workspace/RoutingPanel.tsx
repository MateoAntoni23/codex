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
  getCompatibleProductIds,
  checkDirectCompatibility,
  findReductionCandidates,
  computeEndpoint,
  snapDirectionToAxis,
  snapChangesDirection,
  angleBetweenDirs,
  verifyStartPortValid,
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

function StepConfiguringSegment({ onConfirmDirect, onCancel }: {
  onConfirmDirect: () => void;
  onCancel: () => void;
}) {
  const context           = useTrayStore((s) => s.context);
  const entrada           = useTrayStore((s) => s.entrada);
  const startPort         = useRoutingStore((s) => s.startPort);
  const selectedProductId = useRoutingStore((s) => s.selectedProductId);
  const previewLengthMm   = useRoutingStore((s) => s.previewLengthMm);
  const snapToAxis        = useRoutingStore((s) => s.snapToAxis);
  const setProduct        = useRoutingStore((s) => s.setProduct);
  const setLength         = useRoutingStore((s) => s.setLength);
  const toggleSnap        = useRoutingStore((s) => s.toggleSnap);

  const [error, setError] = useState<string | null>(null);

  // Existing piece / product at the selected port
  const existingPiece = useMemo(
    () => entrada?.piezas.find((p) => p.instancia_id === startPort?.pieceId),
    [entrada?.piezas, startPort?.pieceId],
  );
  const existingProduct = useMemo(
    () => context?.productos.find((p) => p.producto_id === existingPiece?.producto_id),
    [context?.productos, existingPiece?.producto_id],
  );

  // Port info from PUERTOS_PRODUCTO (port-level dimensions and interface)
  const existingPortInfo = useMemo(() => {
    if (!startPort || !context?.puertos || !existingPiece) return null;
    const portId = `${existingPiece.producto_id}-${startPort.portName}`;
    return context.puertos.find((p) => p.puerto_id === portId) ?? null;
  }, [context?.puertos, existingPiece, startPort]);

  // Family info for the existing product
  const existingFamily = useMemo(
    () => context?.familias?.find((f) => f.familia_id === (existingProduct as Record<string, unknown>)?.familia_id),
    [context?.familias, existingProduct],
  );

  // Compatible product IDs for the existing port (port-level catalog lookup)
  const compatibleIds = useMemo(() => {
    if (!existingProduct || !startPort || !context?.compatibilidades) return new Set<string>();
    return getCompatibleProductIds(context.compatibilidades, existingProduct.producto_id, startPort.portName);
  }, [context?.compatibilidades, existingProduct, startPort]);

  // Filter to recta products that are documented as compatible with this port
  const compatibleRectaProducts = useMemo(
    () => (context?.productos ?? []).filter((p) => p.tipo_pieza === 'recta' && compatibleIds.has(p.producto_id)),
    [context?.productos, compatibleIds],
  );

  // Group compatible products by family for <optgroup> display
  const familyGroups = useMemo(() => {
    const groups = new Map<string, { name: string; acabado: string | null; products: typeof compatibleRectaProducts }>();
    for (const p of compatibleRectaProducts) {
      const famId = (p as Record<string, unknown>).familia_id as string | undefined ?? '__other__';
      if (!groups.has(famId)) {
        const fam = context?.familias?.find((f) => f.familia_id === famId);
        groups.set(famId, { name: fam?.nombre_familia ?? famId, acabado: fam?.acabado_normalizado ?? null, products: [] });
      }
      groups.get(famId)!.products.push(p);
    }
    return groups;
  }, [compatibleRectaProducts, context?.familias]);

  const selectedProduct = useMemo(
    () => compatibleRectaProducts.find((p) => p.producto_id === selectedProductId) ?? null,
    [compatibleRectaProducts, selectedProductId],
  );

  const compat = useMemo(() => {
    if (!existingProduct || !selectedProduct || !context || !startPort) return null;
    return checkDirectCompatibility(
      { compatibilidades: context.compatibilidades ?? [], componentesUnion: context.componentesUnion ?? [] },
      existingProduct,
      startPort.portName,
      selectedProduct,
      'P1',
    );
  }, [context, existingProduct, selectedProduct, startPort]);

  const effectiveDir = useMemo(() => {
    if (!startPort) return null;
    return snapToAxis ? snapDirectionToAxis(startPort.dir) : startPort.dir;
  }, [startPort, snapToAxis]);

  const snapWarnAngle = useMemo(() => {
    if (!startPort) return null;
    if (!snapChangesDirection(startPort.dir)) return null;
    const snapped = snapDirectionToAxis(startPort.dir);
    return angleBetweenDirs(startPort.dir, snapped).toFixed(1);
  }, [startPort]);

  const handleConfirm = () => {
    setError(null);
    if (!selectedProduct) { setError('Seleccioná un producto compatible.'); return; }
    if (!compat?.ok) { setError(compat?.reason ?? 'Sin compatibilidad documentada.'); return; }
    if (snapToAxis && snapWarnAngle !== null) {
      setError('La dirección del puerto no coincide con el eje más cercano — desactivá el ajuste al eje para continuar.');
      return;
    }
    onConfirmDirect();
  };

  if (!startPort) return null;

  // Dimensions to display: prefer port-level data, fall back to product-level
  const displayAncho = existingPortInfo?.ancho_nominal_mm ?? existingProduct?.ancho_nominal_mm;
  const displayAla = existingPortInfo?.ala_nominal_mm ?? (existingProduct as Record<string, unknown> | undefined)?.ala_nominal_mm as number | null | undefined;

  return (
    <div style={{ padding: '10px 12px', fontSize: 11 }}>
      {/* Port origin info */}
      <div style={{ marginBottom: 10, padding: '6px 8px', background: '#1a1e30', borderRadius: 3, lineHeight: 1.6 }}>
        <div style={{ color: '#8888aa', marginBottom: 2, fontSize: 10 }}>Puerto de origen</div>
        <div style={{ color: '#ffaa44', fontFamily: 'monospace', fontSize: 11 }}>
          {startPort.pieceId}.{startPort.portName}
        </div>
        {existingProduct && (
          <div style={{ color: '#99aadd', fontSize: 10, marginTop: 2 }}>
            <span style={{ color: '#8888aa' }}>Tipo:</span> {existingProduct.tipo_pieza}
            {existingFamily && (
              <> · <span style={{ color: '#8888aa' }}>Familia:</span> {existingFamily.nombre_familia}</>
            )}
          </div>
        )}
        {(displayAncho != null || displayAla != null) && (
          <div style={{ color: '#99aadd', fontSize: 10 }}>
            <span style={{ color: '#8888aa' }}>Dimensiones:</span>{' '}
            {displayAncho != null ? `${displayAncho} mm ancho` : ''}
            {displayAncho != null && displayAla != null ? ' × ' : ''}
            {displayAla != null ? `${displayAla} mm ala` : ''}
          </div>
        )}
        {existingPortInfo?.interfaz_conexion && (
          <div style={{ color: '#556677', fontSize: 10 }}>
            <span style={{ color: '#8888aa' }}>Interfaz:</span> {existingPortInfo.interfaz_conexion}
          </div>
        )}
        {existingFamily?.acabado_normalizado && (
          <div style={{ color: '#556677', fontSize: 10 }}>
            <span style={{ color: '#8888aa' }}>Acabado:</span> {existingFamily.acabado_normalizado}
          </div>
        )}
      </div>

      {/* Compatible product selector */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ color: '#8888aa', display: 'block', marginBottom: 3 }}>
          Continuación ({compatibleRectaProducts.length} compatible{compatibleRectaProducts.length !== 1 ? 's' : ''})
        </label>
        {compatibleRectaProducts.length === 0 ? (
          <div style={{ padding: '6px 8px', background: '#2a1a1a', borderRadius: 3, color: '#ff9955', fontSize: 10 }}>
            Sin continuaciones documentadas para este puerto en COMPATIBILIDADES.
            {!context?.compatibilidades?.length && ' (Catálogo no disponible)'}
          </div>
        ) : (
          <select
            className="inspector-input"
            style={{ width: '100%' }}
            value={selectedProductId}
            onChange={(e) => { setProduct(e.target.value); setError(null); }}
          >
            {!selectedProductId && <option value="">— Elegí un producto —</option>}
            {Array.from(familyGroups.entries()).map(([famId, { name, acabado, products }]) => (
              <optgroup key={famId} label={acabado ? `${name} (${acabado})` : name}>
                {products.map((p) => (
                  <option key={p.producto_id} value={p.producto_id}>
                    {p.ancho_nominal_mm ?? '?'} mm
                    {(p as Record<string, unknown>).ala_nominal_mm != null
                      ? ` × ${(p as Record<string, unknown>).ala_nominal_mm} mm ala`
                      : ''}
                    {' — '}{p.sku}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </div>

      {/* Compatibility result for selected product */}
      {compat && (
        <div style={{
          marginBottom: 8, padding: '5px 8px', borderRadius: 3, fontSize: 10,
          background: compat.ok ? '#1a2e1a' : '#2a1a1a',
          color: compat.ok ? '#77cc77' : '#ff7755',
          borderLeft: `2px solid ${compat.ok ? '#44aa44' : '#aa4444'}`,
        }}>
          {compat.reason}
          {compat.ok && compat.requiredUnion.length > 0 && (
            <div style={{ marginTop: 4, color: '#aaaacc' }}>
              Conexión con accesorios de unión — Python los calculará en el cómputo al calcular el trazado.
            </div>
          )}
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
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: snapWarnAngle ? 4 : 10, cursor: 'pointer', fontSize: 11, color: '#8888aa' }}>
        <input type="checkbox" checked={snapToAxis} onChange={toggleSnap} />
        Ajustar al eje dominante
        {effectiveDir && snapToAxis && (
          <span style={{ color: '#99aadd', fontSize: 10 }}>
            ({effectiveDir.map(v => v.toFixed(0)).join(', ')})
          </span>
        )}
      </label>

      {snapWarnAngle !== null && (
        <div style={{ marginBottom: 10, padding: '5px 8px', borderRadius: 3, fontSize: 10, background: '#2a2211', color: '#ddaa44', borderLeft: '2px solid #aa8822' }}>
          La dirección del puerto ({snapWarnAngle}°) no coincide con el eje más cercano — ajustar a eje crearía una unión angular que requiere una curva, aún no soportada en este flujo.
        </div>
      )}

      {error && (
        <div style={{ color: '#ff7755', marginBottom: 8, fontSize: 11 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          style={{
            flex: 1, padding: '5px 0', fontSize: 12, background: '#1f3322',
            color: 'white', border: '1px solid #336644', borderRadius: 3, cursor: 'pointer',
            opacity: (snapToAxis && snapWarnAngle !== null) ? 0.5 : 1,
          }}
          onClick={handleConfirm}
          disabled={!selectedProduct || (snapToAxis && snapWarnAngle !== null)}
        >
          Confirmar continuación
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
  const setReductionPortToExisting = useRoutingStore((s) => s.setReductionPortToExisting);

  const [error, setError] = useState<string | null>(null);

  const existingProduct = useMemo(() => {
    const piece = entrada?.piezas.find((p) => p.instancia_id === startPort?.pieceId);
    return context?.productos.find((p) => p.producto_id === piece?.producto_id);
  }, [context?.productos, entrada?.piezas, startPort?.pieceId]);

  const newProduct = useMemo(
    () => context?.productos.find((p) => p.producto_id === selectedProductId),
    [context?.productos, selectedProductId],
  );

  const candidates = useMemo(() => {
    if (!existingProduct || !newProduct || !context) return [];
    return findReductionCandidates(
      {
        productos: context.productos,
        compatibilidades: context.compatibilidades ?? [],
        componentesUnion: context.componentesUnion ?? [],
        puertos: context.puertos ?? [],
      },
      existingProduct,
      newProduct,
    );
  }, [context, existingProduct, newProduct]);

  // No fallback: only use explicitly set reductionProductId
  const effectiveReductionId = reductionProductId || '';

  const selectedCandidate = useMemo(
    () => candidates.find((c) => c.reductionProduct.producto_id === effectiveReductionId),
    [candidates, effectiveReductionId],
  );

  const handleSelectCandidate = (productId: string) => {
    setError(null);
    setReductionProduct(productId);
    const candidate = candidates.find((c) => c.reductionProduct.producto_id === productId);
    if (candidate) {
      setReductionPortToExisting(candidate.reductionPortToExisting);
    }
  };

  const handleConfirm = () => {
    setError(null);
    if (!effectiveReductionId) { setError('Seleccioná una reducción.'); return; }
    if (!selectedCandidate) { setError('La reducción seleccionada ya no es válida. Elegí otra.'); return; }
    if (!selectedCandidate.geometryDocumented) {
      setError('Pendiente — longitud no documentada en el catálogo. Esta reducción no puede insertarse hasta que el catálogo incluya su longitud.');
      return;
    }
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
          No se encontraron reducciones compatibles en el catálogo para este par de productos. Verificá que el catálogo incluya entradas de COMPATIBILIDADES para ambos lados de la reducción.
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
              onChange={(e) => handleSelectCandidate(e.target.value)}
            >
              <option value="">— Elegí una reducción —</option>
              {candidates.map((c) => (
                <option key={c.reductionProduct.producto_id} value={c.reductionProduct.producto_id}>
                  {c.reductionProduct.sku}
                  {!c.geometryDocumented ? ' (pendiente — sin longitud)' : ''}
                  {' '}(P{c.reductionPortToExisting}→exist. / P{c.reductionPortToNew}→nuevo)
                </option>
              ))}
            </select>
            {selectedCandidate && (
              <div style={{ fontSize: 10, color: '#445566', marginTop: 3 }}>
                {selectedCandidate.reductionProduct.descripcion_original}
              </div>
            )}
          </div>

          {/* Port orientation info */}
          {selectedCandidate && (
            <div style={{ marginBottom: 8, padding: '5px 8px', borderRadius: 3, fontSize: 10, background: '#1a2235', color: '#8899bb', lineHeight: 1.5 }}>
              Puerto {selectedCandidate.reductionPortToExisting} conecta al tramo existente ·
              Puerto {selectedCandidate.reductionPortToNew} conecta al nuevo tramo
              {(selectedCandidate.unionForExistingConn.length > 0 || selectedCandidate.unionForNewConn.length > 0) && (
                <div style={{ marginTop: 2, color: '#aaaacc' }}>
                  Conexión con accesorios de unión — Python los calculará en el cómputo al calcular el trazado.
                </div>
              )}
            </div>
          )}

          {selectedCandidate?.geometryDocumented ? (
            <>
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
              <div style={{ marginBottom: 8, padding: '6px 8px', background: '#1a2235', borderRadius: 3, fontSize: 10, color: '#8899bb', lineHeight: 1.5 }}>
                Tramo existente → reducción ({reductionLengthMm} mm) → nuevo tramo ({newProduct?.ancho_nominal_mm ?? '?'} mm)
              </div>
            </>
          ) : selectedCandidate && (
            <div style={{ marginBottom: 8, padding: '6px 8px', background: '#2a2211', borderRadius: 3, fontSize: 10, color: '#ddaa44', borderLeft: '2px solid #aa8822' }}>
              Longitud no documentada en el catálogo — inserción pendiente de datos.
            </div>
          )}

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
  const reductionPortToExisting = useRoutingStore((s) => s.reductionPortToExisting);
  const deactivate        = useRoutingStore((s) => s.deactivate);
  const back              = useRoutingStore((s) => s.back);

  const [commitError, setCommitError] = useState<string | null>(null);

  const getEffectiveDir = () => {
    if (!startPort) return null;
    return snapToAxis ? snapDirectionToAxis(startPort.dir) : startPort.dir;
  };

  const getNewPieceId = (existingIds: Set<string>) => generateSegmentId(existingIds);

  const commitDirect = () => {
    setCommitError(null);
    if (!entrada || !startPort) return;

    // Pre-commit validation
    const portCheck = verifyStartPortValid(entrada.piezas, entrada.conexiones, startPort);
    if (!portCheck.valid) {
      setCommitError(portCheck.reason);
      return;
    }

    const effDir = getEffectiveDir();
    if (!effDir) return;

    const effProductId = selectedProductId;
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

    // Pre-commit validation
    const portCheck = verifyStartPortValid(entrada.piezas, entrada.conexiones, startPort);
    if (!portCheck.valid) {
      setCommitError(portCheck.reason);
      return;
    }

    const effDir = getEffectiveDir();
    if (!effDir) return;

    const effProductId = selectedProductId;

    // Strict: no fallback to first reduction in catalog
    if (!reductionProductId) {
      setCommitError('Seleccioná una reducción antes de confirmar.');
      return;
    }
    const effReductionId = reductionProductId;

    if (!effProductId) {
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

      const redId = getNewPieceId(pieceIds);
      pieceIds.add(redId);

      const existingPortPos = startPort.pos;
      const redEnd = computeEndpoint(existingPortPos, effDir, reductionLengthMm);

      let redPiece;
      let conn1b: [string, string];

      if (reductionPortToExisting === 'P2') {
        // P2 connects to existing, P1 is at redEnd
        redPiece = buildSegmentPiece(redId, effReductionId, redEnd, existingPortPos);
        conn1b = [redId, 'P2'];
      } else {
        // Default: P1 connects to existing, P2 is at redEnd
        redPiece = buildSegmentPiece(redId, effReductionId, existingPortPos, redEnd);
        conn1b = [redId, 'P1'];
      }

      // Continuation piece starts at redEnd (which is P2 of reduction when P1→existing)
      const newId = getNewPieceId(pieceIds);
      const contEnd = computeEndpoint(redEnd, effDir, previewLengthMm);
      const newPiece = buildSegmentPiece(newId, effProductId, redEnd, contEnd);

      // Connection 1: existing piece → reduction
      const conn1Id = generateConnectionId(connIds);
      connIds.add(conn1Id);
      const conn1 = {
        conexion_id: conn1Id,
        a: [startPort.pieceId, startPort.portName] as [string, string],
        b: conn1b,
      };

      // Connection 2: reduction → new piece
      const conn2Id = generateConnectionId(connIds);
      const redPortToNew = reductionPortToExisting === 'P2' ? 'P1' : 'P2';
      const conn2 = {
        conexion_id: conn2Id,
        a: [redId, redPortToNew] as [string, string],
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
