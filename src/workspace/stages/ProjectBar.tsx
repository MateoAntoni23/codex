/**
 * Barra de proyecto (siempre visible, una fila): nombre del proyecto, estado de
 * guardado, Nuevo / Abrir / Guardar copia, Deshacer / Rehacer, tema y acceso a la
 * Biblioteca de modelos. Con `?dev=1`, además, el menú de desarrollo (3e).
 */
import { useTrayStore } from '../../tray/store';
import { useWorkspaceStore } from '../useWorkspaceStore';
import { ProjectControls } from '../../project/ProjectControls';
import { TrayHistoryControls } from '../WorkspaceInspector';
import { isDevMenuEnabled, useUiStore } from './uiStore';

/**
 * Decisión 3e: las cuatro acciones de prueba (escenario, cadenas CUPS, ejemplo
 * del motor, equipos demo) sólo aparecen con `?dev=1`. Conservan sus data-testid;
 * las pruebas que las usan abren la aplicación con ese parámetro.
 */
function DevMenu() {
  return (
    <details className="dev-menu" data-testid="dev-menu">
      <summary>Desarrollo</summary>
      <div className="dev-menu-items">
        <button
          type="button"
          onClick={() => useWorkspaceStore.getState().loadTestScenario()}
          data-testid="load-test-scenario"
          title="Agrega Tablero Prueba A + Motor Prueba A y una conexión de potencia pendiente. Datos ficticios; idempotente y deshacible."
        >
          Cargar escenario de prueba
        </button>
        <button
          type="button"
          onClick={() => {
            const current = useTrayStore.getState().entrada;
            if (!current) return;
            import('../cupsTestChain').then(({ addCupsTestChains }) => {
              useTrayStore.getState().edit(addCupsTestChains(current));
            });
          }}
          data-testid="load-cups-chains"
          title="Agrega dos cadenas CUPS cerradas sin tocar piezas existentes. Idempotente."
        >
          Cargar cadenas CUPS
        </button>
        <button
          type="button"
          onClick={() => {
            const ex = useTrayStore.getState().context?.ejemplos.trazado_derivacion_pe;
            if (!ex) {
              alert('El catálogo estático todavía no terminó de cargar.');
              return;
            }
            if (!confirm('Cargar el ejemplo del motor reemplaza el trazado actual. ¿Continuar?')) return;
            useTrayStore.getState().edit(ex);
          }}
          data-testid="load-motor-example"
          title="Reemplaza el trazado por el ejemplo trazado_derivacion_pe del motor (deshacible)."
        >
          Cargar ejemplo del motor
        </button>
        <button
          type="button"
          onClick={() => useWorkspaceStore.getState().loadDemoEquipment()}
          data-testid="load-demo-equipment"
          title="Agrega los equipos de demostración (piso, nave, tablero, motor…). Deshacible."
        >
          Cargar equipos de demostración
        </button>
        <a href="?legacy=v1">Editor inicial</a>
      </div>
    </details>
  );
}

export function ProjectBar() {
  const fileName = useWorkspaceStore((s) => s.fileName);
  const dirty = useWorkspaceStore((s) => s.dirty);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const name = fileName ? fileName.replace(/\.json$/i, '') : 'Proyecto sin nombre';

  return (
    <header className="project-bar" data-testid="project-bar">
      <span className="project-name" data-testid="project-name" title={fileName ?? undefined}>
        {name}
        {dirty && <span className="workspace-dirty" title="Hay cambios que no están en un archivo"> ● sin copia</span>}
      </span>
      <ProjectControls />
      <TrayHistoryControls />
      <span className="project-bar-spacer" />
      <button
        type="button"
        className="theme-toggle"
        onClick={toggleTheme}
        data-testid="theme-toggle"
        aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
        title={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
      >
        {theme === 'dark' ? '☀ Claro' : '☾ Oscuro'}
      </button>
      <a href="?configurator=v1" className="workspace-toolbar-link" data-testid="open-configurator">
        Biblioteca de modelos
      </a>
      {isDevMenuEnabled() && <DevMenu />}
    </header>
  );
}
