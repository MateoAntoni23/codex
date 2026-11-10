import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useTrayStore, toMotorEntrada } from '../tray/store';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useRoutingStore } from './useRoutingStore';
import { WorkspaceScene } from './WorkspaceScene';
import { ProjectBar } from './stages/ProjectBar';
import { StageBar } from './stages/StageBar';
import { StageInspector } from './stages/StageInspector';
import { EquiposPanel } from './stages/EquiposPanel';
import { PlantaPanel } from './stages/PlantaPanel';
import { BandejasPanel } from './stages/BandejasPanel';
import { ConexionesPanel } from './stages/ConexionesPanel';
import { ResultadosPanel } from './stages/ResultadosPanel';
import { useUiStore } from './stages/uiStore';
import './stages/stages.css';
import { useStageSync } from './stages/useStageSync';
import { bootProject, startAutosave, useProjectStatusStore } from '../project/projectSession';
import { useCatalogConfigStore } from '../configurator/catalogConfigStore';
import {
  getModelFrameOverride,
  getPortGeometryOverride,
  listOverriddenProductIds,
} from './catalogPortMapping';
import { ImportWizard } from '../import/ImportWizard';
import { elementToRenderProps } from '../scene/v2-adapter';

function SceneBridge() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  useEffect(() => {
    const w = window as typeof window & { __codex?: Record<string, unknown> };
    if (!w.__codex) w.__codex = {};
    w.__codex.scene = scene;
    w.__codex.camera = camera;
    w.__codex.controls = controls;
    w.__codex.focusTray = (opts?: { instanciaId?: string; padding?: number }) => {
      const box = new THREE.Box3();
      let found = false;
      scene.traverse((obj) => {
        const cd = (obj as THREE.Object3D).userData?.codex;
        if (!cd) return;
        if (opts?.instanciaId && cd.instanciaId !== opts.instanciaId) return;
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) {
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          const local = mesh.geometry.boundingBox!.clone();
          local.applyMatrix4(mesh.matrixWorld);
          box.union(local);
          found = true;
        }
      });
      if (!found) return null;
      const pad = opts?.padding ?? 0.5;
      box.expandByScalar(pad);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      const cam = camera as THREE.PerspectiveCamera;
      const dist = Math.max(size * 1.2, 1.0);
      cam.position.set(center.x + dist * 0.6, center.y + dist * 0.6, center.z + dist * 0.6);
      cam.lookAt(center);
      cam.near = 0.01;
      cam.far = 1000;
      cam.updateProjectionMatrix();
      const ctl = controls as { target?: THREE.Vector3; update?: () => void } | undefined;
      if (ctl?.target) ctl.target.copy(center);
      if (ctl?.update) ctl.update();
      return { center: [center.x, center.y, center.z], sizeM: size, distM: dist };
    };
    w.__codex.focusElement = (elementId: string, opts?: { padding?: number }) => {
      // Encuadra la cámara sobre un EquipmentElement colocado. Si el elemento
      // no está colocado o no existe, devuelve null sin tocar la cámara.
      const state = useWorkspaceStore.getState();
      const el = state.elements.find((e) => e.id === elementId);
      if (!el) return null;
      const rp = elementToRenderProps(el, state.elements);
      if (!rp.placed || !rp.positionViewer) return null;
      const [cx, cy, cz] = rp.positionViewer;
      const [sx, sy, sz] = rp.sizeViewer ?? [0.5, 0.5, 0.5];
      // Tamaño mínimo para equipos muy pequeños (sensores de 10 cm) — asegura
      // un encuadre útil sin invadir el equipo.
      const sizeM = Math.max(sx, sy, sz, 0.5);
      const pad = opts?.padding ?? 0.5;
      const dist = Math.max(sizeM * 3 + pad, 2.5);
      const cam = camera as THREE.PerspectiveCamera;
      cam.position.set(cx + dist * 0.6, cy + dist * 0.6, cz + dist * 0.6);
      cam.lookAt(cx, cy, cz);
      cam.near = 0.01;
      cam.far = 1000;
      cam.updateProjectionMatrix();
      const ctl = controls as { target?: THREE.Vector3; update?: () => void } | undefined;
      if (ctl?.target) ctl.target.set(cx, cy, cz);
      if (ctl?.update) ctl.update();
      return { center: [cx, cy, cz], sizeM, distM: dist };
    };
    w.__codex.dumpMeshes = () => {
      const out: Array<Record<string, unknown>> = [];
      const tmp = new THREE.Vector3();
      scene.traverse((obj) => {
        const cd = obj.userData?.codex;
        if (!cd) return;
        obj.updateWorldMatrix(true, false);
        obj.getWorldPosition(tmp);
        out.push({
          ...cd,
          matrixWorld: obj.matrixWorld.toArray(),
          worldPosition: [tmp.x, tmp.y, tmp.z],
        });
      });
      return out;
    };
    return () => {
      if (w.__codex) {
        delete w.__codex.scene;
        delete w.__codex.camera;
        delete w.__codex.controls;
        delete w.__codex.dumpMeshes;
        delete w.__codex.focusTray;
        delete w.__codex.focusElement;
      }
    };
  }, [scene, camera, controls]);
  return null;
}

/**
 * Hito 1b — interfaz por etapas. La barra de herramientas y la barra de estado
 * anteriores se reparten entre la barra de proyecto (ProjectBar), el selector de
 * etapa (StageBar) y los paneles de cada etapa. WorkspaceTree.tsx y
 * WorkspaceInspector.tsx se conservan: sus fichas se reutilizan en StageInspector.
 */
function LeftPanel({ onOpenImportWizard }: { onOpenImportWizard: () => void }) {
  const stage = useUiStore((s) => s.stage);
  switch (stage) {
    case 'equipos': return <EquiposPanel onOpenImportWizard={onOpenImportWizard} />;
    case 'planta': return <PlantaPanel />;
    case 'bandejas': return <BandejasPanel />;
    case 'conexiones': return <ConexionesPanel />;
    case 'resultados': return <ResultadosPanel />;
  }
}

/** Error del trazado fuera de Resultados (allí se muestra en su panel). */
function ChromeError() {
  const error = useTrayStore((s) => s.error);
  const stage = useUiStore((s) => s.stage);
  if (!error || stage === 'resultados') return null;
  return <div className="workspace-error stage-error" role="alert">⚠ {error}</div>;
}

export function UnifiedWorkspace() {
  const selectEquip    = useWorkspaceStore((s) => s.selectEquip);
  const selectTray     = useWorkspaceStore((s) => s.selectTray);
  const selectedEquipId = useWorkspaceStore((s) => s.selectedEquipId);
  const markDirty      = useWorkspaceStore((s) => s.markDirty);
  const [importWizardOpen, setImportWizardOpen] = useState(false);
  const booted         = useProjectStatusStore((s) => s.booted);
  const theme          = useUiStore((s) => s.theme);
  useStageSync();

  // Restaurar el último proyecto (IndexedDB) y recién entonces suscribir el
  // autoguardado: si se suscribiera antes, un estado vacío podría pisar lo guardado.
  useEffect(() => {
    let alive = true;
    let stop = () => {};
    void bootProject().then(() => {
      if (alive) stop = startAutosave();
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  // Initialize motor connection on mount
  useEffect(() => {
    void useTrayStore.getState().initialize();
    // Hidratar overrides del Configurador para que routingRules y toMotorEntrada
    // reflejen las decisiones guardadas desde que el workspace carga, sin esperar
    // a que el usuario abra la Configuración de biblioteca.
    useCatalogConfigStore.getState().hydrate();
    const tick = setInterval(() => void useTrayStore.getState().initialize(), 30000);
    return () => clearInterval(tick);
  }, []);

  // Dev-only diagnostic hook for Playwright/manual inspection.
  // Why: visual tests need to inject prepared TrayInput and read scene matrices without a UI click sequence.
  // How to apply: available at window.__codex while the workspace is mounted; never guarded by NODE_ENV so e2e works in dev build.
  useEffect(() => {
    const w = window as typeof window & { __codex?: Record<string, unknown> };
    w.__codex = {
      trayStore: useTrayStore,
      workspaceStore: useWorkspaceStore,
      routingStore: useRoutingStore,
      // Exposed for e2e: the acceptance test calibrates a piece in the Configurator,
      // inserts it via routing, and must compare the motor payload. `toMotorEntrada`
      // is the exact transformation used before dispatching to the Python engine.
      catalogConfigStore: useCatalogConfigStore,
      uiStore: useUiStore,
      toMotorEntrada,
      // Same-module bindings for the resolver. See note in ConfiguratorLayout
      // about Vite dev-server double-loading when tests use `await import()`.
      getModelFrameOverride,
      getPortGeometryOverride,
      listOverriddenProductIds,
    };
    return () => { delete w.__codex; };
  }, []);

  // "Cambios sin copia en archivo": sólo cuenta cambios POSTERIORES a la restauración.
  const trayRevision = useTrayStore((s) => s.revision);
  const baseRevision = useRef<number | null>(null);
  useEffect(() => {
    if (!booted) return;
    if (baseRevision.current === null) { baseRevision.current = trayRevision; return; }
    if (trayRevision !== baseRevision.current) {
      baseRevision.current = trayRevision;
      markDirty();
    }
  }, [booted, trayRevision, markDirty]);

  const connectionToolActive     = useWorkspaceStore((s) => s.connectionToolActive);
  const deactivateConnectionTool = useWorkspaceStore((s) => s.deactivateConnectionTool);
  const selectSupport            = useWorkspaceStore((s) => s.selectSupport);
  const selectedSupportId        = useWorkspaceStore((s) => s.selectedSupportId);
  const routingActive            = useRoutingStore((s) => s.active);
  const deactivateRouting        = useRoutingStore((s) => s.deactivate);

  const clearAll = () => {
    if (routingActive) { deactivateRouting(); return; }
    if (connectionToolActive) { deactivateConnectionTool(); return; }
    if (selectedEquipId) selectEquip(null);
    else if (selectedSupportId) selectSupport(null);
    else selectTray(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="unified-workspace" data-theme={theme} data-testid="workspace-root">
      <div className="ws-panel ws-chrome">
        <ProjectBar />
        <StageBar />
        <ChromeError />
      </div>

      {!booted ? (
        <div className="workspace-restoring" data-testid="project-restoring" role="status">
          Restaurando proyecto…
        </div>
      ) : (
      <div className="unified-workspace-body">
        <aside className="unified-workspace-tree ws-panel" aria-label="Lista de la etapa">
          <LeftPanel onOpenImportWizard={() => setImportWizardOpen(true)} />
        </aside>

        <main className="unified-workspace-canvas">
          <Canvas shadows camera={{ position: [15, 12, 15], fov: 45 }} onPointerMissed={clearAll}>
            <SceneBridge />
            <WorkspaceScene />
            <OrbitControls makeDefault />
          </Canvas>
        </main>

        <aside className="unified-workspace-inspector ws-panel" aria-label="Inspector">
          <StageInspector />
        </aside>
      </div>
      )}

      {importWizardOpen && (
        <div className="ws-panel ws-modal-host">
          <ImportWizard onClose={() => setImportWizardOpen(false)} />
        </div>
      )}
    </div>
  );
}
