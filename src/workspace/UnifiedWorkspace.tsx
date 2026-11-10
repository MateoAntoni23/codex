import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useTrayStore, toMotorEntrada } from '../tray/store';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useRoutingStore } from './useRoutingStore';
import { WorkspaceScene } from './WorkspaceScene';
import { WorkspaceTree } from './WorkspaceTree';
import { WorkspaceInspector } from './WorkspaceInspector';
import { RoutingStatusBadge } from './RoutingPanel';
import { ProjectControls } from '../project/ProjectControls';
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

function StatusBar() {
  const status               = useTrayStore((s) => s.status);
  const revision             = useTrayStore((s) => s.revision);
  const error                = useTrayStore((s) => s.error);
  const dirty                = useWorkspaceStore((s) => s.dirty);
  const fileName             = useWorkspaceStore((s) => s.fileName);
  const connectionToolActive = useWorkspaceStore((s) => s.connectionToolActive);
  const connectionPortA      = useWorkspaceStore((s) => s.connectionPortA);
  const engine               = useTrayStore((s) => s.engine);

  return (
    <div className="workspace-status" role="status">
      <span>Motor: <strong>{status}</strong> · rev {revision}</span>
      <span data-testid="engine-state" data-engine={engine.state} title={engine.detail ?? undefined}>
        {' '}· Servicio de cálculo: <strong>{engine.state}</strong>
        {engine.state !== 'conectado' && engine.state !== 'desconocido' && engine.detail ? ` — ${engine.detail}` : ''}
      </span>
      {fileName && <span> · {fileName}</span>}
      {connectionToolActive && (
        <span style={{ color: '#00ffcc', fontWeight: 600 }}>
          {' '}● Herramienta de conexión activa — {connectionPortA ? `A: ${connectionPortA[0]}.${connectionPortA[1]} → hacé clic en puerto B` : 'Hacé clic en un puerto (esferas)'}
        </span>
      )}
      <RoutingStatusBadge />
      {dirty && <span className="workspace-dirty"> ● cambios sin copia en archivo</span>}
      {error && <span className="workspace-error"> ⚠ {error}</span>}
    </div>
  );
}

function Toolbar({ onOpenImportWizard }: { onOpenImportWizard: () => void }) {
  return (
    <div className="workspace-toolbar">
      <a href="?legacy=v1">← Editor inicial</a>
      <span className="workspace-toolbar-title">Espacio de trabajo unificado</span>
      <ProjectControls />
      <button onClick={() => void useTrayStore.getState().initialize()}>Reconectar motor</button>
      <button onClick={() => void useTrayStore.getState().calculate()}>Calcular trazado</button>
      <button onClick={onOpenImportWizard} data-testid="open-import-wizard">Importar Excel</button>
      <button
        onClick={() => useWorkspaceStore.getState().loadTestScenario()}
        data-testid="load-test-scenario"
        title="Agrega Tablero Prueba A + Motor Prueba A y una conexión de potencia pendiente. Datos ficticios para pruebas; idempotente y deshacible."
      >
        Cargar escenario de prueba
      </button>
      <button
        onClick={() => {
          const current = useTrayStore.getState().entrada;
          if (!current) return;
          // Carga aditiva: trps300→cups300→trps300 + trps450→cups450→trps450.
          // No toca lo existente; idempotente al segundo click.
          import('./cupsTestChain').then(({ addCupsTestChains }) => {
            const next = addCupsTestChains(current);
            useTrayStore.getState().edit(next);
          });
        }}
        data-testid="load-cups-chains"
        title="Agrega dos cadenas CUPS cerradas (TRPS-300→CUPS-300→TRPS-300 y TRPS-450→CUPS-450→TRPS-450) sin tocar piezas existentes. Idempotente."
      >
        Cargar cadenas CUPS
      </button>
      <button
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
        title="Acción explícita: reemplaza el trazado por el ejemplo trazado_derivacion_pe del motor (deshacible)."
      >
        Cargar ejemplo del motor
      </button>
      <button
        onClick={() => useWorkspaceStore.getState().loadDemoEquipment()}
        data-testid="load-demo-equipment"
        title="Acción explícita: agrega los equipos de demostración (piso, nave, tablero, motor…). Deshacible."
      >
        Cargar equipos de demostración
      </button>
      <a href="?configurator=v1" className="workspace-toolbar-link" data-testid="open-configurator">Configuración de biblioteca</a>
    </div>
  );
}

export function UnifiedWorkspace() {
  const selectEquip    = useWorkspaceStore((s) => s.selectEquip);
  const selectTray     = useWorkspaceStore((s) => s.selectTray);
  const selectedEquipId = useWorkspaceStore((s) => s.selectedEquipId);
  const markDirty      = useWorkspaceStore((s) => s.markDirty);
  const [importWizardOpen, setImportWizardOpen] = useState(false);
  const booted         = useProjectStatusStore((s) => s.booted);

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
    <div className="unified-workspace">
      <Toolbar onOpenImportWizard={() => setImportWizardOpen(true)} />
      <StatusBar />

      {!booted ? (
        <div className="workspace-restoring" data-testid="project-restoring" role="status">
          Restaurando proyecto…
        </div>
      ) : (
      <div className="unified-workspace-body">
        <aside className="unified-workspace-tree">
          <WorkspaceTree />
        </aside>

        <main className="unified-workspace-canvas">
          <Canvas shadows camera={{ position: [15, 12, 15], fov: 45 }} onPointerMissed={clearAll}>
            <SceneBridge />
            <WorkspaceScene />
            <OrbitControls makeDefault />
          </Canvas>
        </main>

        <aside className="unified-workspace-inspector">
          <WorkspaceInspector />
        </aside>
      </div>
      )}

      {importWizardOpen && <ImportWizard onClose={() => setImportWizardOpen(false)} />}
    </div>
  );
}
