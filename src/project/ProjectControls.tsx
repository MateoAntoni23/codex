/**
 * ProjectControls — controles de proyecto agrupados en UN solo componente:
 * Nuevo · Abrir archivo · Guardar copia · indicador de autoguardado.
 *
 * Deliberadamente simple: un hito posterior reorganiza toda la interfaz y
 * reubicará este bloque. Incluye el aviso de biblioteca (seguir con la local /
 * adoptar la del archivo / cancelar).
 *
 * Los `aria-label` conservan el nombre histórico de cada acción ("Exportar JSON",
 * "Importar JSON") para no romper las pruebas E2E existentes que localizan los
 * botones por nombre accesible.
 */
import { useRef, useState } from 'react';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import {
  buildProjectCopy,
  hasProjectContent,
  newProject,
  openProjectText,
  retrySave,
  useProjectStatusStore,
  type LibraryChoice,
  type LibraryConflict,
} from './projectSession';

const PHASE_LABEL: Record<string, string> = {
  restoring: 'Restaurando…',
  idle: 'Sin cambios guardados aún',
  saving: 'Guardando…',
  saved: 'Guardado en este equipo',
  error: 'Error al guardar',
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
}

export function SaveStatusIndicator() {
  const phase = useProjectStatusStore((s) => s.phase);
  const savedAt = useProjectStatusStore((s) => s.savedAt);
  const error = useProjectStatusStore((s) => s.error);
  return (
    <span
      className={`project-save-status project-save-${phase}`}
      data-testid="project-save-status"
      data-phase={phase}
      role="status"
      title={error ?? undefined}
    >
      {PHASE_LABEL[phase] ?? phase}
      {phase === 'saved' && savedAt ? ` · ${formatTime(savedAt)}` : ''}
      {phase === 'error' && (
        <>
          {' '}
          <button type="button" data-testid="project-save-retry" onClick={retrySave}>
            Reintentar
          </button>
        </>
      )}
    </span>
  );
}

interface PendingChoice {
  conflict: LibraryConflict;
  resolve: (c: LibraryChoice) => void;
}

function LibraryConflictDialog({ pending }: { pending: PendingChoice }) {
  const { conflict, resolve } = pending;
  return (
    <div className="project-dialog-backdrop" role="presentation">
      <div
        className="project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-conflict-title"
        data-testid="library-conflict"
      >
        <h3 id="library-conflict-title">La biblioteca del archivo difiere de la de este equipo</h3>
        <p>
          «{conflict.fileName}» trae su propia copia de la biblioteca de calibración. La de este equipo es la
          autoridad: abrir el proyecto no la modifica salvo que elijas adoptar la del archivo.
        </p>
        <ul>
          {conflict.differences.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        {conflict.partial && (
          <p>
            El archivo es de formato 1: sólo trae calibraciones (overrides). Adoptarlas no cambia las
            aprobaciones ni el aporte al trazado locales.
          </p>
        )}
        <p>Al adoptar, se guarda antes una copia de la biblioteca actual bajo otra clave de este navegador.</p>
        <div className="project-dialog-actions">
          <button type="button" autoFocus data-testid="library-keep-local" onClick={() => resolve('local')}>
            Seguir con la biblioteca local
          </button>
          <button type="button" data-testid="library-adopt" onClick={() => resolve('adopt')}>
            Adoptar la del archivo
          </button>
          <button type="button" data-testid="library-cancel" onClick={() => resolve('cancel')}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProjectControls() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingChoice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const notice = useProjectStatusStore((s) => s.notice);

  const chooseLibrary = (conflict: LibraryConflict) =>
    new Promise<LibraryChoice>((resolve) => {
      setPending({
        conflict,
        resolve: (c) => {
          setPending(null);
          resolve(c);
        },
      });
    });

  const handleNew = () => {
    if (hasProjectContent() && !window.confirm('El proyecto actual tiene contenido. ¿Empezar un proyecto vacío? (Se puede volver a abrir una copia guardada.)')) {
      return;
    }
    newProject();
    setMessage(null);
  };

  const handleSaveCopy = () => {
    const { json, name } = buildProjectCopy();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    // Defer revoke: Chrome necesita un respiro antes de despachar la descarga.
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 0);
    useWorkspaceStore.getState().markSaved(name);
    setMessage(null);
  };

  const handleOpen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    if (hasProjectContent()) {
      const dirty = useWorkspaceStore.getState().dirty;
      const q = dirty
        ? `Hay cambios sin guardar en archivo. ¿Reemplazar con "${file.name}"?`
        : `¿Abrir "${file.name}"? Se reemplazará el trabajo actual.`;
      if (!window.confirm(q)) {
        input.value = '';
        return;
      }
    }
    const reader = new FileReader();
    reader.onload = () => {
      void openProjectText(String(reader.result), file.name, chooseLibrary).then((r) => {
        if (r.status === 'error') setMessage(`Error al abrir: ${r.error}`);
        else if (r.status === 'cancelled') setMessage('Apertura cancelada: no se cambió nada.');
        else if (r.libraryAdopted) setMessage(`Biblioteca del archivo adoptada. Copia de la anterior: ${r.backupKey}`);
        else setMessage(null);
        input.value = '';
      });
    };
    reader.onerror = () => {
      setMessage('Error al leer el archivo.');
      input.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="project-controls" data-testid="project-controls">
      <button type="button" data-testid="project-new" onClick={handleNew}>
        Nuevo
      </button>
      <button
        type="button"
        data-testid="project-open"
        aria-label="Abrir archivo (Importar JSON)"
        onClick={() => fileInputRef.current?.click()}
      >
        Abrir archivo
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        data-testid="project-open-input"
        onChange={handleOpen}
      />
      <button
        type="button"
        data-testid="project-save-copy"
        aria-label="Guardar copia (Exportar JSON)"
        onClick={handleSaveCopy}
      >
        Guardar copia
      </button>
      <SaveStatusIndicator />
      {message && (
        <span className="project-message" data-testid="project-message" role="alert">
          {' '}
          {message}
        </span>
      )}
      {notice && (
        <span className="project-message" data-testid="project-notice" role="alert">
          {' '}
          {notice}
        </span>
      )}
      {pending && <LibraryConflictDialog pending={pending} />}
    </div>
  );
}
