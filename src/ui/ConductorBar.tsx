import { ProjectActions } from './ProjectActions';

export function ConductorBar() {
  return (
    <div className="panel panel-bottom">
      <ProjectActions />
      <div className="conductor-divider" aria-hidden />
      <span className="conductor-placeholder">
        Lista de Conductores — Próximamente
      </span>
    </div>
  );
}
