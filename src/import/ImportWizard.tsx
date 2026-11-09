/**
 * ImportWizard — modal de 3 pasos para importar un libro ELS-IMP-EQCX:
 *   1. Elegir archivo (drag&drop o input)
 *   2. Revisar resultado: contadores (A6), listado de hallazgos por severidad (A7),
 *      y — si ya hay un catálogo en el proyecto — diff de reimportación (A8).
 *   3. Confirmar: aplica al workspace vía setImportedCatalog.
 *
 * Cancelar en cualquier paso cierra sin tocar el estado del proyecto.
 * A5: cualquier V-01/V-02 (libro rechazado) impide avanzar al paso 2.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { parseWorkbook } from './parser';
import { diffCatalogs, summarizeDiff } from './reimport';
import type {
  ImportResult,
  ReimportDiff,
  ValidationIssue,
  Severidad,
} from './types';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import './importWizard.css';

type Step = 'file' | 'preview' | 'done';

interface ImportWizardProps {
  onClose: () => void;
}

const SEV_ORDER: Record<Severidad, number> = { ERROR: 0, ADVERTENCIA: 1, INFO: 2 };
const SEV_LABEL: Record<Severidad, string> = { ERROR: 'ERROR', ADVERTENCIA: 'ADV.', INFO: 'INFO' };

export function ImportWizard({ onClose }: ImportWizardProps) {
  const [step, setStep] = useState<Step>('file');
  const [parsing, setParsing] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<Severidad | 'ALL'>('ALL');
  const [issueQuery, setIssueQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevCatalog = useWorkspaceStore((s) => s.importedCatalog);
  const setImportedCatalog = useWorkspaceStore((s) => s.setImportedCatalog);

  const diff = useMemo<ReimportDiff | null>(() => {
    if (!result?.catalog) return null;
    return diffCatalogs(prevCatalog, result.catalog);
  }, [result, prevCatalog]);

  const handleFile = useCallback(async (file: File) => {
    setFatalError(null);
    setParsing(true);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const r = await parseWorkbook(buf, file.name);
      setResult(r);
      setStep('preview');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFatalError(msg);
    } finally {
      setParsing(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  }, [handleFile]);

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    e.target.value = '';
  };

  const confirm = () => {
    if (!result?.catalog) return;
    setImportedCatalog(result.catalog);
    setStep('done');
  };

  // Paso 1 ───────────────────────────────────────────
  const renderStepFile = () => (
    <>
      <div
        className="import-dropzone"
        onDrop={onDrop}
        onDragOver={onDragOver}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="import-dropzone-primary">
          {parsing ? 'Procesando…' : 'Arrastrá el .xlsx o hacé clic para elegirlo'}
        </div>
        <div className="import-dropzone-small">
          Formato ELS-IMP-EQCX v1.x · se valida contra el contrato antes de aplicar
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        style={{ display: 'none' }}
        onChange={onPickFile}
      />
      {fatalError && (
        <div className="import-wizard-error" style={{ marginTop: 14 }}>
          <strong>El archivo fue rechazado.</strong>
          <div style={{ marginTop: 4 }}>{fatalError}</div>
        </div>
      )}
    </>
  );

  // Paso 2 ───────────────────────────────────────────
  const issuesFiltered = useMemo(() => {
    if (!result) return [] as ValidationIssue[];
    const q = issueQuery.trim().toLowerCase();
    const list = [...result.issues].sort((a, b) => {
      const d = SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
      if (d !== 0) return d;
      return a.code.localeCompare(b.code);
    });
    return list.filter((i) => {
      if (severityFilter !== 'ALL' && i.severity !== severityFilter) return false;
      if (!q) return true;
      return (
        i.code.toLowerCase().includes(q) ||
        i.sheet.toLowerCase().includes(q) ||
        (i.recordId?.toLowerCase().includes(q) ?? false) ||
        (i.tag?.toLowerCase().includes(q) ?? false) ||
        i.message.toLowerCase().includes(q)
      );
    });
  }, [result, severityFilter, issueQuery]);

  const errorCount = result?.issues.filter((i) => i.severity === 'ERROR').length ?? 0;
  const advCount   = result?.issues.filter((i) => i.severity === 'ADVERTENCIA').length ?? 0;
  const infoCount  = result?.issues.filter((i) => i.severity === 'INFO').length ?? 0;

  const renderStepPreview = () => {
    if (!result?.catalog) {
      return (
        <div className="import-wizard-error">
          No se pudo construir el catálogo. Corregí los errores y reintentá.
        </div>
      );
    }
    const c = result.counts;
    const conexPorServ = Object.entries(c.conexionesPorServicio)
      .filter(([, n]) => n > 0)
      .sort(([, a], [, b]) => b - a);
    const tendidosPorNat = Object.entries(c.tendidosPorNaturaleza)
      .filter(([, n]) => n > 0)
      .sort(([, a], [, b]) => b - a);

    return (
      <>
        <div className="import-section">
          <h3>Resumen del libro ({result.catalog.meta.nombreArchivo})</h3>
          <div className="import-counts">
            <div className="import-counts-card">
              <h4>Equipos</h4>
              <div className="big">{c.equipos}</div>
              <div className="detail">
                Activos: {c.equiposActivos} · Retirados: {c.equiposRetirados}
              </div>
            </div>
            <div className="import-counts-card">
              <h4>Conexiones</h4>
              <div className="big">{c.conexiones}</div>
              <div className="detail">
                {conexPorServ.length === 0
                  ? '—'
                  : conexPorServ.map(([s, n]) => `${s}: ${n}`).join(' · ')}
              </div>
            </div>
            <div className="import-counts-card">
              <h4>Tendidos</h4>
              <div className="big">{c.tendidos}</div>
              <div className="detail">
                {tendidosPorNat.length === 0
                  ? '—'
                  : tendidosPorNat.map(([s, n]) => `${s}: ${n}`).join(' · ')}
              </div>
            </div>
            <div className="import-counts-card">
              <h4>Componentes</h4>
              <div className="big">{c.componentes}</div>
            </div>
            <div className="import-counts-card">
              <h4>Atributos técnicos</h4>
              <div className="big">{c.atributos}</div>
            </div>
            <div className="import-counts-card">
              <h4>Pendientes</h4>
              <div className="big">{c.pendientes}</div>
              <div className="detail">
                ERR {c.pendientesPorSeveridad.ERROR ?? 0} ·
                ADV {c.pendientesPorSeveridad.ADVERTENCIA ?? 0} ·
                INFO {c.pendientesPorSeveridad.INFO ?? 0}
              </div>
            </div>
          </div>
        </div>

        {diff && renderDiff(diff, !!prevCatalog)}

        <div className="import-section">
          <h3>
            Hallazgos de validación ({result.issues.length}) ·
            <span style={{ color: '#ff8886', marginLeft: 6 }}>{errorCount} ERROR</span> ·
            <span style={{ color: '#ffcc55', marginLeft: 6 }}>{advCount} ADV</span> ·
            <span style={{ color: '#8ec5ff', marginLeft: 6 }}>{infoCount} INFO</span>
          </h3>
          <div className="import-filters">
            <label>Filtrar</label>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as Severidad | 'ALL')}
            >
              <option value="ALL">Todos</option>
              <option value="ERROR">Solo ERROR</option>
              <option value="ADVERTENCIA">Solo ADVERTENCIA</option>
              <option value="INFO">Solo INFO</option>
            </select>
            <input
              type="text"
              placeholder="Buscar por código, hoja, ID, TAG o texto…"
              value={issueQuery}
              onChange={(e) => setIssueQuery(e.target.value)}
            />
          </div>
          {issuesFiltered.length === 0 ? (
            <p style={{ color: '#8f9ba3', fontSize: 12, padding: '6px 2px' }}>
              {result.issues.length === 0
                ? 'Sin hallazgos. El libro pasó todas las validaciones.'
                : 'Ningún hallazgo coincide con el filtro.'}
            </p>
          ) : (
            <div className="import-issues">
              {issuesFiltered.map((i, idx) => (
                <div key={idx} className={`import-issue import-issue-sev-${i.severity}`}>
                  <span className="import-issue-code">{i.code} {SEV_LABEL[i.severity]}</span>
                  <span>{i.sheet}</span>
                  <span className="import-issue-record">
                    {i.recordId ?? '—'}{i.tag ? ` · ${i.tag}` : ''}
                  </span>
                  <span>{i.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    );
  };

  // Paso 3 — confirmación final ───────────────────────
  const renderStepDone = () => (
    <div style={{ padding: '20px 0', textAlign: 'center' }}>
      <div style={{ fontSize: 15, marginBottom: 6 }}>Catálogo incorporado.</div>
      <div style={{ color: '#8f9ba3', fontSize: 12 }}>
        {result?.counts.equipos ?? 0} equipos · {result?.counts.conexiones ?? 0} conexiones ·{' '}
        {result?.counts.atributos ?? 0} atributos técnicos disponibles en el inspector.
      </div>
    </div>
  );

  // ───── Render shell ────────────────────────────────
  const canConfirm = step === 'preview' && !!result?.catalog && errorCount === 0;

  return (
    <div className="import-wizard-backdrop" role="dialog" aria-modal="true">
      <div className="import-wizard">
        <div className="import-wizard-header">
          <h2>Importar catálogo de equipos y conexiones</h2>
          <button className="import-wizard-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="import-wizard-body">
          <div className="import-wizard-step">
            <span className={step === 'file' ? 'active' : 'done'}>1. Archivo</span>
            <span className={step === 'preview' ? 'active' : step === 'done' ? 'done' : ''}>
              2. Revisión
            </span>
            <span className={step === 'done' ? 'active' : ''}>3. Confirmación</span>
          </div>

          {fileName && step !== 'file' && (
            <div style={{ fontSize: 12, color: '#8f9ba3', marginBottom: 10 }}>
              Archivo: <strong style={{ color: '#e5e9ec' }}>{fileName}</strong>
            </div>
          )}

          {step === 'file' && renderStepFile()}
          {step === 'preview' && renderStepPreview()}
          {step === 'done' && renderStepDone()}
        </div>

        <div className="import-wizard-footer">
          {step === 'preview' && (
            <button onClick={() => { setStep('file'); setResult(null); }}>
              ← Elegir otro archivo
            </button>
          )}
          <button onClick={onClose}>
            {step === 'done' ? 'Cerrar' : 'Cancelar'}
          </button>
          {step === 'preview' && (
            <button
              className="primary"
              disabled={!canConfirm}
              onClick={confirm}
              title={
                !canConfirm
                  ? errorCount > 0
                    ? 'Resolvé los errores en el libro antes de incorporar.'
                    : 'No hay catálogo para aplicar.'
                  : undefined
              }
            >
              Incorporar al proyecto
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function renderDiff(diff: ReimportDiff, hasPrev: boolean) {
  if (!hasPrev) {
    return (
      <div className="import-section">
        <h3>Primera importación en este proyecto</h3>
        <div className="import-diff">
          <div className="import-diff-card">
            <div className="label">Entidades nuevas</div>
            <div className="big">{diff.nuevos.length}</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="import-section">
      <h3>Comparación con el catálogo ya cargado</h3>
      {diff.mismoHash && (
        <div style={{ color: '#ffcc55', fontSize: 12, marginBottom: 8 }}>
          ⚠ El archivo es idéntico al último importado (mismo SHA-256). Confirmar no cambiará nada.
        </div>
      )}
      <div style={{ color: '#8f9ba3', fontSize: 12, marginBottom: 8 }}>{summarizeDiff(diff)}</div>
      <div className="import-diff">
        <div className="import-diff-card">
          <div className="label">Sin cambios</div>
          <div className="big">{diff.sinCambios}</div>
        </div>
        <div className="import-diff-card">
          <div className="label">Nuevos</div>
          <div className="big">{diff.nuevos.length}</div>
        </div>
        <div className="import-diff-card">
          <div className="label">Modificados</div>
          <div className="big">{diff.modificados.length}</div>
        </div>
        <div className="import-diff-card">
          <div className="label">Huérfanos (en proyecto, ausentes en libro)</div>
          <div className="big">{diff.huerfanos.length}</div>
        </div>
        <div className="import-diff-card">
          <div className="label">Conciliaciones por TAG (requiere revisión)</div>
          <div className="big">{diff.conciliacionesPorTag.length}</div>
        </div>
        <div className="import-diff-card">
          <div className="label">Pasaron a RETIRADO</div>
          <div className="big">{diff.pasaronARetirado.length}</div>
        </div>
      </div>
      {(diff.huerfanos.length > 0 || diff.conciliacionesPorTag.length > 0) && (
        <div style={{ fontSize: 11, color: '#8f9ba3', marginTop: 6 }}>
          Nota: los huérfanos NO se eliminan automáticamente. Las conciliaciones por TAG
          requieren revisión manual — distinto equipoId con TAG coincidente puede ser un rename
          externo o un duplicado real; no se aplican de forma automática.
        </div>
      )}
    </div>
  );
}
