import { useRef, useState } from 'react';
import { useSceneStore, type SaveStatus } from '../store/sceneStore';
import { exportProject, importProject, resetProject } from '../persistence/projectManager';

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: '',
  loading: 'Cargando...',
  saving: 'Guardando...',
  saved: 'Guardado localmente',
  error: '', // se usa saveError
};

export function ProjectActions() {
  const saveStatus = useSceneStore((s) => s.saveStatus);
  const saveError = useSceneStore((s) => s.saveError);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  function handleExport() {
    setImportError(null);
    exportProject(useSceneStore);
  }

  function handleImportClick() {
    setImportError(null);
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.currentTarget.value = '';
    if (file == null) return;
    const result = await importProject(useSceneStore, file, window.confirm);
    if (!result.ok && result.error !== 'Importación cancelada') {
      setImportError(result.error);
    } else {
      setImportError(null);
    }
  }

  function handleReset() {
    setImportError(null);
    resetProject(useSceneStore, window.confirm);
  }

  const statusText =
    saveStatus === 'error'
      ? `Error: ${saveError ?? 'desconocido'}`
      : STATUS_LABEL[saveStatus];

  return (
    <div className="project-actions">
      <span
        className={`save-status save-status--${saveStatus}`}
        title={saveStatus === 'saved' ? 'Los datos se guardan en este navegador. Usá Exportar para conservar una copia portátil.' : undefined}
      >
        {statusText}
      </span>

      <div className="project-actions-buttons">
        <button
          className="btn-secondary"
          type="button"
          onClick={handleExport}
          title="Descarga el proyecto como archivo JSON. El origen se expresa en mm respecto del sistema global."
        >
          Exportar
        </button>

        <button
          className="btn-secondary"
          type="button"
          onClick={handleImportClick}
          title="Reemplaza el proyecto con un archivo JSON exportado previamente."
        >
          Importar
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
          data-testid="file-input"
        />

        <button
          className="btn-secondary"
          type="button"
          onClick={handleReset}
          title="Vuelve a la escena de ejemplo. Se perderán los cambios no exportados."
        >
          Restablecer ejemplo
        </button>
      </div>

      {importError != null && (
        <span className="project-import-error" role="alert">
          {importError}
        </span>
      )}
    </div>
  );
}
