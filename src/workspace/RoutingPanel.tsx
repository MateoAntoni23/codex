/**
 * RoutingPanel — right-panel UI for interactive tray routing.
 *
 * Step 1 — selectingPort:   instructions; user clicks a port in the scene.
 * Step 2 — configuringSegment: pick product, length, snap; compatibility check;
 *           PE extension proposal if applicable.
 * Step 3 — confirmingReduction: pick reduction candidate, set reduction length.
 *
 * Atomic commit: ALL new pieces + connections (+ optional PE extension) written
 * to tray store in one edit() call. Cancel at any step leaves the tray unchanged.
 *
 * Undo/redo: exposed in the panel header; both invalidate motor results.
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
  hasSelfPortEquivalence,
} from './routingRules';
import { buildSegmentPiece, generateSegmentId } from './addTraySegment';
import { planAddSegment, planAddCurve, applyOperation, type PeExtensionProposal } from './workspaceOperation';
import {
  isHorizontalCurve,
  isInteractivelyInsertable,
  isWalkable,
  getLimitationReason,
  formatProductOption,
} from './pieceClassification';
import { hasParametricRecipe, resolveRecipe, placeRecipe, chiralityForTurn } from './parametricBridge';
import { buildContinuationCandidates, type ContinuationCandidate } from './continuationCandidates';

// ─── PE extension proposal widget ────────────────────────────────────────────

function PeExtensionWidget({
  proposal,
  decision,
  chosenConductorIdx,
  onChange,
  onChooseConductor,
}: {
  proposal: PeExtensionProposal;
  decision: 'accept' | 'reject';
  /** null means no choice yet (required when ambiguous and decision=accept). */
  chosenConductorIdx: number | null;
  onChange: (d: 'accept' | 'reject') => void;
  onChooseConductor: (idx: number) => void;
}) {
  const displayPrimary = chosenConductorIdx !== null
    ? (proposal.candidates.find(c => c.conductorIdx === chosenConductorIdx) ?? proposal.primary)
    : proposal.primary;

  const isPending = displayPrimary.status === 'pending';
  const isAmbiguousAndUnchosen = proposal.ambiguous && decision === 'accept' && chosenConductorIdx === null;
  const isExtendBlocked = isAmbiguousAndUnchosen || (decision === 'accept' && isPending);

  return (
    <div style={{ marginBottom: 8, padding: '6px 8px', borderRadius: 3, background: '#1a2235', border: '1px solid #2a3a55', fontSize: 10 }}>
      <div style={{ color: '#99aadd', marginBottom: 4, fontWeight: 600 }}>Recorrido PE</div>

      {isPending && (
        <div style={{ color: '#ddaa44', marginBottom: 4, borderLeft: '2px solid #aa8822', paddingLeft: 6 }}>
          Verificación pendiente — el extremo no pudo confirmarse desde las conexiones o la pieza tiene más de 2 puertos.
          Usá "No extender" para confirmar el tramo sin modificar el PE.
        </div>
      )}

      {proposal.ambiguous ? (
        <div style={{ marginBottom: 6 }}>
          <div style={{ color: '#ddaa44', marginBottom: 4 }}>
            {proposal.candidates.length} conductores con extremo en este tramo — elegí cuál extender:
          </div>
          {proposal.candidates.map(c => (
            <button
              key={c.conductorIdx}
              onClick={() => onChooseConductor(c.conductorIdx)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', marginBottom: 3,
                padding: '3px 6px', borderRadius: 3, cursor: 'pointer', fontSize: 10,
                background: chosenConductorIdx === c.conductorIdx ? '#1f3322' : '#1e2233',
                color: chosenConductorIdx === c.conductorIdx ? '#77cc77' : '#99aabb',
                border: `1px solid ${chosenConductorIdx === c.conductorIdx ? '#336644' : '#334455'}`,
              }}
            >
              {c.conductorId}
              <span style={{ color: '#556677', marginLeft: 6 }}>
                ({c.extensionEnd === 'start' ? 'prepend' : 'append'} · {c.currentRecorrido.length} piezas)
              </span>
              {c.status === 'pending' && <span style={{ color: '#ddaa44', marginLeft: 4 }}>⚠ pendiente</span>}
            </button>
          ))}
          {isAmbiguousAndUnchosen && (
            <div style={{ color: '#ff9955', marginTop: 2 }}>Elegí un conductor para poder confirmar.</div>
          )}
        </div>
      ) : (
        <div style={{ color: '#8899bb', marginBottom: 6, lineHeight: 1.5 }}>
          Conductor <span style={{ color: '#ffaa44', fontFamily: 'monospace' }}>{displayPrimary.conductorId}</span>
          {' '}({displayPrimary.currentRecorrido.length} pieza{displayPrimary.currentRecorrido.length !== 1 ? 's' : ''} ·{' '}
          {displayPrimary.extensionEnd === 'start' ? 'extiende inicio' : 'extiende final'}).
          ¿Extender para incluir el nuevo tramo?
        </div>
      )}

      <div style={{ display: 'flex', gap: 5 }}>
        <button
          style={{
            flex: 1, padding: '3px 0', fontSize: 11, borderRadius: 3,
            cursor: isExtendBlocked ? 'default' : 'pointer',
            background: decision === 'accept' ? '#1f3322' : '#222233',
            color: decision === 'accept' ? '#77cc77' : '#556677',
            border: `1px solid ${decision === 'accept' ? '#336644' : '#334455'}`,
            opacity: isExtendBlocked ? 0.5 : 1,
          }}
          onClick={() => !isExtendBlocked && onChange('accept')}
          disabled={isExtendBlocked}
        >
          ✓ Extender
        </button>
        <button
          style={{
            flex: 1, padding: '3px 0', fontSize: 11, borderRadius: 3, cursor: 'pointer',
            background: decision === 'reject' ? '#2a1a1a' : '#222233',
            color: decision === 'reject' ? '#ff9955' : '#556677',
            border: `1px solid ${decision === 'reject' ? '#664444' : '#334455'}`,
          }}
          onClick={() => onChange('reject')}
        >
          ✗ No extender
        </button>
      </div>
    </div>
  );
}

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
  onConfirmDirect: (peDecision: 'accept' | 'reject', peChosenConductorIdx: number | null) => void;
  onCancel: () => void;
}) {
  const context           = useTrayStore((s) => s.context);
  const entrada           = useTrayStore((s) => s.entrada);
  const startPort         = useRoutingStore((s) => s.startPort);
  const selectedProductId = useRoutingStore((s) => s.selectedProductId);
  const previewLengthMm   = useRoutingStore((s) => s.previewLengthMm);
  const snapToAxis        = useRoutingStore((s) => s.snapToAxis);
  const turnDirection     = useRoutingStore((s) => s.turnDirection);
  const setProduct        = useRoutingStore((s) => s.setProduct);
  const setLength         = useRoutingStore((s) => s.setLength);
  const toggleSnap        = useRoutingStore((s) => s.toggleSnap);
  const setTurnDirection  = useRoutingStore((s) => s.setTurnDirection);

  const [error, setError] = useState<string | null>(null);
  const [peDecision, setPeDecision] = useState<'accept' | 'reject'>('accept');
  const [peChosenConductorIdx, setPeChosenConductorIdx] = useState<number | null>(null);

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

  // Compatible product IDs for the existing port (port-level catalog lookup).
  // When the catalog declares the existing product's two ports as interchangeable
  // (self-compat P1↔P2 entry, or horizontal curve by construction), union both
  // port queries — the catalog typically documents one port only.
  const compatibleIds = useMemo(() => {
    if (!existingProduct || !startPort || !context?.compatibilidades) return new Set<string>();
    const ids = getCompatibleProductIds(context.compatibilidades, existingProduct.producto_id, startPort.portName);
    if (hasSelfPortEquivalence(context.compatibilidades, existingProduct)) {
      const altPort = startPort.portName === 'P1' ? 'P2' : 'P1';
      const altIds = getCompatibleProductIds(context.compatibilidades, existingProduct.producto_id, altPort);
      for (const id of altIds) ids.add(id);
    }
    return ids;
  }, [context?.compatibilidades, existingProduct, startPort]);

  // All catalog products declared compatible with this port, regardless of whether
  // the current flow can insert them. Non-insertable ones are shown as disabled
  // options with an explicit limitation message rather than being hidden silently.
  const compatibleWalkable = useMemo(
    () => (context?.productos ?? []).filter(
      (p) => isWalkable(p) && compatibleIds.has(p.producto_id),
    ),
    [context?.productos, compatibleIds],
  );
  // Un producto es seleccionable si el flujo clásico lo admite o si hay una
  // receta paramétrica que resuelve la geometría (p.ej. curvas con radio_mm
  // nulo en catálogo pero medidas en el STEP paramétrico).
  const compatibleProducts = useMemo(
    () => compatibleWalkable.filter((p) => isInteractivelyInsertable(p) || hasParametricRecipe(p)),
    [compatibleWalkable],
  );
  const nonInsertableCompatible = useMemo(
    () => compatibleWalkable.filter((p) => !isInteractivelyInsertable(p) && !hasParametricRecipe(p)),
    [compatibleWalkable],
  );
  // Clasificación visual separada (sin alterar compatibilidades del catálogo):
  // los que tienen modelo paramétrico se cuentan aparte y se marcan con ◆ en
  // el selector; el resto queda como insertable sin modelo.
  const parametricCompatible = useMemo(
    () => compatibleProducts.filter((p) => hasParametricRecipe(p)),
    [compatibleProducts],
  );

  // Group compatible products by family for <optgroup> display
  const familyGroups = useMemo(() => {
    const groups = new Map<string, { name: string; acabado: string | null; products: typeof compatibleProducts }>();
    for (const p of compatibleProducts) {
      const famId = (p as Record<string, unknown>).familia_id as string | undefined ?? '__other__';
      if (!groups.has(famId)) {
        const fam = context?.familias?.find((f) => f.familia_id === famId);
        groups.set(famId, { name: fam?.nombre_familia ?? famId, acabado: fam?.acabado_normalizado ?? null, products: [] });
      }
      groups.get(famId)!.products.push(p);
    }
    return groups;
  }, [compatibleProducts, context?.familias]);

  // Candidatos clasificados con razones explícitas — base del selector
  // ampliado ("Recomendados" / "Otros productos"). Mantiene disjunción con
  // compatibleProducts: los "recommended" son un subconjunto estricto.
  const continuationCandidates: ContinuationCandidate[] = useMemo(() => {
    if (!existingProduct || !startPort || !context?.productos) return [];
    return buildContinuationCandidates({
      existingProduct,
      existingPortName: startPort.portName,
      catalogProducts: context.productos,
      compatibleIds,
    });
  }, [existingProduct, startPort, context?.productos, compatibleIds]);

  const otherCandidates: ContinuationCandidate[] = useMemo(
    () => continuationCandidates.filter((c) => c.category === 'other'),
    [continuationCandidates],
  );
  const otherCandidateById = useMemo(() => {
    const m = new Map<string, ContinuationCandidate>();
    for (const c of otherCandidates) m.set(c.product.producto_id, c);
    return m;
  }, [otherCandidates]);

  const selectedOtherCandidate = useMemo(
    () => otherCandidateById.get(selectedProductId) ?? null,
    [otherCandidateById, selectedProductId],
  );

  // Motivo requerido al usar un candidato 'other' (compatibilidad no documentada
  // o piece_kind pendiente). Vive en el componente — el store de excepciones
  // es otra tarea aún pendiente; aquí al menos bloqueamos la confirmación.
  const [exceptionMotive, setExceptionMotive] = useState('');

  const selectedProduct = useMemo(() => {
    const fromCompat = compatibleProducts.find((p) => p.producto_id === selectedProductId);
    if (fromCompat) return fromCompat;
    const fromOther = otherCandidates.find((c) => c.product.producto_id === selectedProductId);
    return fromOther?.product ?? null;
  }, [compatibleProducts, otherCandidates, selectedProductId]);

  const isCurve = isHorizontalCurve(selectedProduct);

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

  // Receta paramétrica resuelta para el producto seleccionado — null cuando
  // caemos al fallback de arco sustituto (familia sin catálogo paramétrico).
  const parametricEntry = useMemo(
    () => (selectedProduct ? resolveRecipe(selectedProduct) : null),
    [selectedProduct],
  );

  // Ajuste geométrico: evalúa la colocación del puente paramétrico desde el
  // puerto activo. Para curvas calcula P2 en coordenadas de mundo; el panel
  // muestra el radio de línea central medido para que el usuario vea cuán
  // lejos quedaría el arco sustituto de la geometría real del STEP.
  const geometricFit = useMemo(() => {
    if (!parametricEntry || !selectedProduct || !startPort) return null;
    if (parametricEntry.piece_kind !== 'curva_horizontal') return null;
    try {
      const chirality = chiralityForTurn(turnDirection);
      const placed = placeRecipe(selectedProduct, parametricEntry, startPort.pos, startPort.dir, chirality);
      const dx = placed.p2.pos[0] - placed.p1.pos[0];
      const dy = placed.p2.pos[1] - placed.p1.pos[1];
      const dz = placed.p2.pos[2] - placed.p1.pos[2];
      const chord = Math.hypot(dx, dy, dz);
      const angleDeg = ((selectedProduct as Record<string, unknown>).angulo_grados as number | undefined) ?? 0;
      const θ = (angleDeg * Math.PI) / 180;
      const sinHalf = Math.sin(θ / 2);
      const centerlineR = sinHalf > 1e-9 ? chord / (2 * sinHalf) : null;
      const catalogR = (selectedProduct as Record<string, unknown>).radio_mm as number | null | undefined;
      const fallbackR = (catalogR ?? 300) + (selectedProduct.ancho_nominal_mm ?? 0) / 2;
      return { ok: true as const, centerlineR, fallbackR, catalogR: catalogR ?? null, angleDeg };
    } catch (err) {
      return { ok: false as const, reason: err instanceof Error ? err.message : String(err) };
    }
  }, [parametricEntry, selectedProduct, startPort, turnDirection]);

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

  // Plan the pending operation for PE proposal preview (only when all inputs valid)
  const pendingOp = useMemo(() => {
    if (!compat?.ok || !selectedProduct || !entrada || !startPort) return null;
    if (isCurve) {
      try {
        return planAddCurve(entrada, startPort, selectedProduct, compat, turnDirection);
      } catch {
        return null;
      }
    }
    if (!effectiveDir || previewLengthMm <= 0) return null;
    try {
      return planAddSegment(entrada, startPort, selectedProduct, compat, previewLengthMm, effectiveDir);
    } catch {
      return null;
    }
  }, [compat, selectedProduct, entrada, startPort, effectiveDir, previewLengthMm, isCurve, turnDirection]);

  const handleConfirm = () => {
    setError(null);
    if (!selectedProduct) { setError('Seleccioná un producto compatible.'); return; }
    // Candidato 'other' habilitado para inserción: exige motivo escrito.
    if (selectedOtherCandidate) {
      if (!selectedOtherCandidate.insertionSupported) {
        setError('Este producto todavía no puede insertarse desde el flujo interactivo.');
        return;
      }
      if (exceptionMotive.trim().length < 3) {
        setError('Escribí el motivo de la excepción antes de confirmar.');
        return;
      }
    }
    if (!compat?.ok && !selectedOtherCandidate) { setError(compat?.reason ?? 'Sin compatibilidad documentada.'); return; }
    if (!isCurve) {
      if (snapToAxis && snapWarnAngle !== null) {
        setError('La dirección del puerto no coincide con el eje más cercano — desactivá el ajuste al eje para continuar.');
        return;
      }
      if (previewLengthMm <= 0) { setError('La longitud debe ser mayor que 0.'); return; }
    }
    if (pendingOp?.peExtension?.ambiguous && peDecision === 'accept' && peChosenConductorIdx === null) {
      setError('Elegí un conductor PE o seleccioná "No extender".');
      return;
    }
    onConfirmDirect(peDecision, peChosenConductorIdx);
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
          Continuación ({compatibleProducts.length} compatible{compatibleProducts.length !== 1 ? 's' : ''})
          {parametricCompatible.length > 0 && (
            <span style={{ color: '#99ccff', marginLeft: 6 }}>
              · {parametricCompatible.length} con modelo
            </span>
          )}
          {nonInsertableCompatible.length > 0 && (
            <span style={{ color: '#ddaa44', marginLeft: 6 }}>
              · {nonInsertableCompatible.length} pendiente{nonInsertableCompatible.length !== 1 ? 's' : ''}
            </span>
          )}
        </label>
        {/* Hint: familia activa sin modelos paramétricos — propone arrancar
            un trazado nuevo. No falsea compatibilidad: declara explícitamente
            que el catálogo SAMET veda intercambio entre familias (REV-032). */}
        {compatibleProducts.length > 0 && parametricCompatible.length === 0 && (
          <div style={{
            marginBottom: 6, padding: '6px 8px', borderRadius: 3, fontSize: 10,
            background: '#2a1f10', color: '#ddaa44', borderLeft: '2px solid #886633', lineHeight: 1.5,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Ningún compatible tiene modelo paramétrico diseñado</div>
            Los modelos 3D confirmados viven en la familia <strong>SAM-STP-Z (Perforada)</strong>:
            TRPS-300-22-Z (recto), CPS-300-45-Z y CPS-300-90-Z (curvas horizontales).
            SAMET veda compatibilidad entre familias (REV-032), por eso no aparecen acá.
            Cancelá y usá "+ Agregar tramo recto" para iniciar un principal perforado.
          </div>
        )}
        {compatibleProducts.length === 0 && otherCandidates.length === 0 ? (
          <div style={{ padding: '6px 8px', background: '#2a1a1a', borderRadius: 3, color: '#ff9955', fontSize: 10 }}>
            Sin continuaciones insertables para este puerto en el trazado interactivo.
            {!context?.compatibilidades?.length && ' (Catálogo no disponible)'}
          </div>
        ) : (
          <select
            data-codex-routing-product-select
            className="inspector-input"
            style={{ width: '100%' }}
            value={selectedProductId}
            onChange={(e) => {
              setProduct(e.target.value);
              setError(null);
              setExceptionMotive('');
            }}
          >
            {!selectedProductId && <option value="">— Elegí un producto —</option>}
            {compatibleProducts.length > 0 && (
              <optgroup label="Recomendados — compatibilidad SAMET + modelo">
                {Array.from(familyGroups.entries()).map(([famId, { name, acabado, products }]) => (
                  <optgroup key={famId} label={acabado ? `  ${name} (${acabado})` : `  ${name}`}>
                    {products.map((p) => (
                      <option key={p.producto_id} value={p.producto_id}>
                        {hasParametricRecipe(p) ? '◆ ' : '○ '}{formatProductOption(p)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </optgroup>
            )}
            {otherCandidates.length > 0 && (
              <optgroup label="Otros productos — requieren excepción con motivo">
                {otherCandidates.map((c) => (
                  <option
                    key={c.product.producto_id}
                    value={c.product.producto_id}
                    disabled={!c.insertionSupported}
                  >
                    {c.insertionSupported ? '⚠ ' : '⏳ '}{formatProductOption(c.product)}
                    {' — '}
                    {c.reasonCode === 'compat_no_documentada' && 'compat. no documentada'}
                    {c.reasonCode === 'kind_pendiente_insercion' && 'inserción pendiente'}
                    {c.reasonCode === 'sin_modelo_geometrico' && 'sin modelo'}
                    {c.reasonCode === 'boca_dimension_divergente' && 'bocas divergentes'}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        )}
        {(compatibleProducts.length > 0 || otherCandidates.length > 0) && (
          <div style={{ fontSize: 9, color: '#667788', marginTop: 2 }}>
            ◆ modelo paramétrico · ○ sin modelo · ⚠ excepción (sin compat SAMET) · ⏳ inserción pendiente
          </div>
        )}
        {selectedOtherCandidate && (
          <div style={{
            marginTop: 8, padding: '6px 8px', borderRadius: 3, fontSize: 10,
            background: '#2a2211', color: '#ffcc77', borderLeft: '2px solid #aa8822', lineHeight: 1.5,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 3 }}>
              Excepción — {selectedOtherCandidate.reasonCode.split('_').join(' ')}
            </div>
            <div style={{ color: '#ccbb99', marginBottom: 6 }}>
              {selectedOtherCandidate.reasonText}
            </div>
            {selectedOtherCandidate.insertionSupported ? (
              <>
                <label style={{ color: '#8888aa', display: 'block', marginBottom: 3 }}>
                  Motivo (obligatorio — no modifica el diagnóstico del motor):
                </label>
                <textarea
                  data-codex-routing-exception-motive
                  value={exceptionMotive}
                  onChange={(e) => setExceptionMotive(e.target.value)}
                  placeholder="Ej.: autorización técnica del proyectista; condición de obra que fuerza esta combinación."
                  rows={2}
                  style={{
                    width: '100%', fontSize: 10, padding: '4px 6px', borderRadius: 3,
                    background: '#1a1e30', color: '#ccddee', border: '1px solid #334455',
                    resize: 'vertical',
                  }}
                />
              </>
            ) : (
              <div style={{ color: '#ff9955' }}>
                Inserción pendiente — el flujo interactivo todavía no coloca este tipo de pieza.
                Se muestra para que la brecha sea visible, pero no se puede confirmar desde aquí.
              </div>
            )}
          </div>
        )}
        {nonInsertableCompatible.length > 0 && (
          <details style={{ marginTop: 6, padding: '5px 8px', background: '#2a2211', borderRadius: 3, fontSize: 10, color: '#ddaa44', borderLeft: '2px solid #aa8822' }}>
            <summary style={{ cursor: 'pointer', color: '#ddaa44' }}>
              {nonInsertableCompatible.length} producto{nonInsertableCompatible.length !== 1 ? 's' : ''} compatible{nonInsertableCompatible.length !== 1 ? 's' : ''} aún no soportado{nonInsertableCompatible.length !== 1 ? 's' : ''} en este flujo
            </summary>
            <ul style={{ margin: '4px 0 0', paddingLeft: 16, color: '#ccbb99' }}>
              {Array.from(new Map(nonInsertableCompatible.map(p => [p.tipo_pieza, p])).values()).map((p) => (
                <li key={p.tipo_pieza}>
                  <strong style={{ color: '#ddaa44' }}>{p.tipo_pieza}</strong>
                  {' · '}
                  <span style={{ color: '#aaaa88' }}>{nonInsertableCompatible.filter(q => q.tipo_pieza === p.tipo_pieza).length} candidato{nonInsertableCompatible.filter(q => q.tipo_pieza === p.tipo_pieza).length !== 1 ? 's' : ''}</span>
                  {' — '}
                  <span style={{ color: '#aa9977' }}>{getLimitationReason(p)}</span>
                </li>
              ))}
            </ul>
          </details>
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

      {/* Ajuste geométrico — separado de la compatibilidad de catálogo. */}
      {selectedProduct && isCurve && (
        <div style={{
          marginBottom: 8, padding: '5px 8px', borderRadius: 3, fontSize: 10,
          background: parametricEntry ? '#1a2235' : '#2a2211',
          color: parametricEntry ? '#99aadd' : '#ddaa44',
          borderLeft: `2px solid ${parametricEntry ? '#3355aa' : '#aa8822'}`,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>
            {parametricEntry ? 'Ajuste geométrico — receta paramétrica' : 'Ajuste geométrico — arco sustituto'}
          </div>
          {parametricEntry && geometricFit?.ok && (
            <div style={{ color: '#aaaacc' }}>
              Receta <code style={{ color: '#99ccff' }}>{parametricEntry.recipe}</code>. Radio medido en el STEP:{' '}
              <strong style={{ color: '#99ccff' }}>
                {geometricFit.centerlineR != null ? `${geometricFit.centerlineR.toFixed(1)} mm` : '—'}
              </strong>{' '}
              (fallback catálogo: {geometricFit.fallbackR.toFixed(0)} mm
              {geometricFit.catalogR == null ? ' — radio nominal null, derivado por defecto 300' : ''}).
            </div>
          )}
          {parametricEntry && geometricFit && !geometricFit.ok && (
            <div style={{ color: '#ff9955' }}>
              La receta paramétrica no se puede colocar desde este puerto: {geometricFit.reason}. Se usará el arco sustituto.
            </div>
          )}
          {!parametricEntry && (
            <div style={{ color: '#ccbb99' }}>
              Sin receta paramétrica confirmada para este SKU — se extruirá un arco sustituto con
              radio = (radio_mm ∣ 300) + ancho/2. La curva de la pieza confirmada podría diferir del STEP original.
            </div>
          )}
        </div>
      )}

      {/* PE extension proposal (only when operation is fully planned) */}
      {pendingOp?.peExtension && (
        <PeExtensionWidget
          proposal={pendingOp.peExtension}
          decision={peDecision}
          chosenConductorIdx={peChosenConductorIdx}
          onChange={(d) => { setPeDecision(d); if (d === 'reject') setPeChosenConductorIdx(null); }}
          onChooseConductor={(idx) => { setPeChosenConductorIdx(idx); setPeDecision('accept'); }}
        />
      )}

      {/* Turn direction (curves only) */}
      {isCurve && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: '#8888aa', marginBottom: 4 }}>Dirección de giro</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {(['left', 'right'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setTurnDirection(d)}
                style={{
                  flex: 1, padding: '4px 0', fontSize: 11, borderRadius: 3, cursor: 'pointer',
                  background: turnDirection === d ? '#1a2235' : '#222233',
                  color: turnDirection === d ? '#99ccff' : '#556677',
                  border: `1px solid ${turnDirection === d ? '#3355aa' : '#334455'}`,
                }}
              >
                {d === 'left' ? '↰ Izquierda' : '↱ Derecha'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Length input (straight segments only) */}
      {!isCurve && (
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
      )}

      {/* Axis snap (straight segments only) */}
      {!isCurve && (
        <>
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
              La dirección del puerto ({snapWarnAngle}°) no coincide con el eje más cercano.
            </div>
          )}
        </>
      )}

      {error && (
        <div style={{ color: '#ff7755', marginBottom: 8, fontSize: 11 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          style={{
            flex: 1, padding: '5px 0', fontSize: 12, background: '#1f3322',
            color: 'white', border: '1px solid #336644', borderRadius: 3, cursor: 'pointer',
            opacity: (!isCurve && snapToAxis && snapWarnAngle !== null) ? 0.5 : 1,
          }}
          onClick={handleConfirm}
          disabled={!selectedProduct || (!isCurve && snapToAxis && snapWarnAngle !== null)}
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
  const context          = useTrayStore((s) => s.context);
  const entrada          = useTrayStore((s) => s.entrada);
  const trayEdit         = useTrayStore((s) => s.edit);
  const trayUndo         = useTrayStore((s) => s.undo);
  const trayRedo         = useTrayStore((s) => s.redo);
  const history          = useTrayStore((s) => s.history);
  const future           = useTrayStore((s) => s.future);
  const markDirty        = useWorkspaceStore((s) => s.markDirty);
  const selectTray       = useWorkspaceStore((s) => s.selectTray);

  const step              = useRoutingStore((s) => s.step);
  const startPort         = useRoutingStore((s) => s.startPort);
  const selectedProductId = useRoutingStore((s) => s.selectedProductId);
  const previewLengthMm   = useRoutingStore((s) => s.previewLengthMm);
  const snapToAxis        = useRoutingStore((s) => s.snapToAxis);
  const turnDirection     = useRoutingStore((s) => s.turnDirection);
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

  /**
   * Direct commit: validates, plans the operation (planAddSegment), applies it
   * (applyOperation) atomically, and writes the result via a single trayEdit().
   * peDecision and peChosenConductorIdx come from the user's explicit choices in step 2.
   */
  const commitDirect = (peDecision: 'accept' | 'reject', peChosenConductorIdx: number | null) => {
    setCommitError(null);
    if (!entrada || !startPort) return;

    // Pre-commit validation
    const portCheck = verifyStartPortValid(entrada.piezas, entrada.conexiones, startPort);
    if (!portCheck.valid) { setCommitError(portCheck.reason); return; }

    const effDir = getEffectiveDir();
    if (!effDir) return;

    if (!selectedProductId) { setCommitError('Sin producto seleccionado.'); return; }
    if (previewLengthMm <= 0) { setCommitError('La longitud debe ser mayor que 0.'); return; }

    // Re-verify compatibility at commit time (single source of truth)
    const existingPiece = entrada.piezas.find((p) => p.instancia_id === startPort.pieceId);
    const existingProductForComp = context?.productos.find((p) => p.producto_id === existingPiece?.producto_id);
    const selectedProductForComp = context?.productos.find((p) => p.producto_id === selectedProductId);
    if (!existingProductForComp || !selectedProductForComp) {
      setCommitError('Producto no encontrado en catálogo. Recargá el contexto.');
      return;
    }
    const compat = checkDirectCompatibility(
      { compatibilidades: context?.compatibilidades ?? [], componentesUnion: context?.componentesUnion ?? [] },
      existingProductForComp, startPort.portName, selectedProductForComp, 'P1',
    );
    if (!compat.ok) { setCommitError(compat.reason); return; }

    const isSelectedCurve = isHorizontalCurve(selectedProductForComp);

    try {
      // Plan the operation (pure, no side effects)
      let op;
      if (isSelectedCurve) {
        op = planAddCurve(entrada, startPort, selectedProductForComp, compat, turnDirection);
      } else {
        if (previewLengthMm <= 0) { setCommitError('La longitud debe ser mayor que 0.'); return; }
        op = planAddSegment(entrada, startPort, selectedProductForComp, compat, previewLengthMm, effDir);
      }

      // Revalidate PE choice against the freshly planned operation
      if (peDecision === 'accept' && op.peExtension) {
        // Determine target candidate: explicit choice or default primary
        const targetCandidate = peChosenConductorIdx !== null
          ? op.peExtension.candidates.find(c => c.conductorIdx === peChosenConductorIdx)
          : op.peExtension.primary;

        if (peChosenConductorIdx !== null && !targetCandidate) {
          setCommitError('El conductor PE elegido ya no es válido — elegí de nuevo antes de confirmar.');
          return;
        }
        const resolvedCandidate = targetCandidate ?? op.peExtension.primary;
        if (resolvedCandidate.status === 'pending') {
          setCommitError('La extensión PE está pendiente de verificación — usá "No extender" para continuar.');
          return;
        }
        if (peChosenConductorIdx !== null) {
          op.peExtension = { ...op.peExtension, primary: resolvedCandidate };
        }
      }

      // Apply all-or-nothing
      const nextEntrada = applyOperation(entrada, op, peDecision);
      // Single atomic write to store (pushes to history, clears future)
      trayEdit(nextEntrada);
      selectTray(op.newPiece.instancia_id);
      markDirty();
      deactivate();
    } catch (e) {
      setCommitError(`Error al crear la pieza: ${String(e)}`);
    }
  };

  const commitWithReduction = () => {
    setCommitError(null);
    if (!entrada || !startPort) return;

    const portCheck = verifyStartPortValid(entrada.piezas, entrada.conexiones, startPort);
    if (!portCheck.valid) { setCommitError(portCheck.reason); return; }

    const effDir = getEffectiveDir();
    if (!effDir) return;

    const effProductId = selectedProductId;
    if (!reductionProductId) { setCommitError('Seleccioná una reducción antes de confirmar.'); return; }
    if (!effProductId) { setCommitError('Seleccioná producto y reducción.'); return; }
    if (reductionLengthMm <= 0 || previewLengthMm <= 0) { setCommitError('Las longitudes deben ser mayores que 0.'); return; }

    try {
      const next = structuredClone(entrada);
      const pieceIds = new Set(next.piezas.map((p) => p.instancia_id));
      const connIds  = new Set(next.conexiones.map((c) => c.conexion_id));

      const redId = generateSegmentId(pieceIds);
      pieceIds.add(redId);

      const existingPortPos = startPort.pos;
      const redEnd = computeEndpoint(existingPortPos, effDir, reductionLengthMm);

      let redPiece;
      let conn1b: [string, string];

      if (reductionPortToExisting === 'P2') {
        redPiece = buildSegmentPiece(redId, reductionProductId, redEnd, existingPortPos);
        conn1b = [redId, 'P2'];
      } else {
        redPiece = buildSegmentPiece(redId, reductionProductId, existingPortPos, redEnd);
        conn1b = [redId, 'P1'];
      }

      const newId  = generateSegmentId(pieceIds);
      const contEnd = computeEndpoint(redEnd, effDir, previewLengthMm);
      const newPiece = buildSegmentPiece(newId, effProductId, redEnd, contEnd);

      const conn1Id = generateConnectionId(connIds);
      connIds.add(conn1Id);
      const conn1 = { conexion_id: conn1Id, a: [startPort.pieceId, startPort.portName] as [string, string], b: conn1b };

      const conn2Id = generateConnectionId(connIds);
      const redPortToNew = reductionPortToExisting === 'P2' ? 'P1' : 'P2';
      const conn2 = { conexion_id: conn2Id, a: [redId, redPortToNew] as [string, string], b: [newId, 'P1'] as [string, string] };

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

  const canUndo = history.length > 0;
  const canRedo = future.length > 0;

  return (
    <div className="inspector-panel" style={{ padding: 0 }}>
      <div className="inspector-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#ff9900' }}>
          ● Continuando trazado
        </span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {/* Undo / Redo */}
          <button
            title={canUndo ? `Deshacer (${history.length})` : 'Sin operaciones para deshacer'}
            style={{ fontSize: 11, padding: '1px 6px', background: canUndo ? '#2a3344' : '#1e2233', color: canUndo ? '#99aadd' : '#445566', border: '1px solid #334455', borderRadius: 2, cursor: canUndo ? 'pointer' : 'default' }}
            onClick={() => { if (canUndo) { trayUndo(); markDirty(); } }}
            disabled={!canUndo}
          >↩</button>
          <button
            title={canRedo ? `Rehacer (${future.length})` : 'Sin operaciones para rehacer'}
            style={{ fontSize: 11, padding: '1px 6px', background: canRedo ? '#2a3344' : '#1e2233', color: canRedo ? '#99aadd' : '#445566', border: '1px solid #334455', borderRadius: 2, cursor: canRedo ? 'pointer' : 'default' }}
            onClick={() => { if (canRedo) { trayRedo(); markDirty(); } }}
            disabled={!canRedo}
          >↪</button>
          <button
            style={{ fontSize: 10, padding: '2px 8px', background: '#3a2200', color: '#cc8844', border: '1px solid #664422', borderRadius: 2, cursor: 'pointer' }}
            onClick={deactivate}
          >
            Cancelar
          </button>
        </div>
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
