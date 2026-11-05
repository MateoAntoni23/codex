// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { usePreviewStore } from '../usePreviewStore';
import { PREVIEW_ELEMENTS } from '../previewData';
import {
  parseName,
  parsePositionDraft,
  parseBoxSizeDraft,
  parseCylinderSizeDraft,
  globalToLocalPositionMm,
  applyBoxSizeEdit,
  applyCylinderSizeEdit,
  adjustChildLocalZ,
  applyPositionEdit,
  applyNameEdit,
} from '../previewEditor';
import { PreviewInspector } from '../PreviewInspector';
import type { Vec3 } from '../../types/domain-v2';
import { IDENTITY_QUATERNION } from '../../types/domain-v2';

beforeEach(() => {
  usePreviewStore.getState().resetElements();
});

// ─── Validación (funciones puras) ─────────────────────────────────────────────

describe('parseName', () => {
  it('nombre no vacío → ok', () => {
    expect(parseName('Motor A')).toEqual({ ok: true, value: 'Motor A' });
  });
  it('recorta espacios', () => {
    expect(parseName('  Motor  ')).toEqual({ ok: true, value: 'Motor' });
  });
  it('cadena vacía → error', () => {
    expect(parseName('')).toMatchObject({ ok: false });
  });
  it('solo espacios → error', () => {
    expect(parseName('   ')).toMatchObject({ ok: false });
  });
});

describe('parsePositionDraft', () => {
  it('tres números finitos → ok', () => {
    const r = parsePositionDraft({ x: '100', y: '-200', z: '0' });
    expect(r).toEqual({ ok: true, value: { x: 100, y: -200, z: 0 } });
  });
  it('campo vacío → error en ese eje', () => {
    const r = parsePositionDraft({ x: '', y: '0', z: '0' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.errors.x).toBeTruthy();
  });
  it('texto no numérico → error', () => {
    const r = parsePositionDraft({ x: 'abc', y: '0', z: '0' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.errors.x).toBeTruthy();
  });
  it('Infinity → error', () => {
    const r = parsePositionDraft({ x: 'Infinity', y: '0', z: '0' });
    expect(r).toMatchObject({ ok: false });
  });
});

describe('parseBoxSizeDraft', () => {
  it('tres positivos → ok', () => {
    const r = parseBoxSizeDraft({ width: '1000', depth: '600', height: '2000' });
    expect(r).toEqual({ ok: true, value: { width: 1000, depth: 600, height: 2000 } });
  });
  it('cero → error (debe ser positivo)', () => {
    const r = parseBoxSizeDraft({ width: '0', depth: '600', height: '2000' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.errors.width).toBeTruthy();
  });
  it('negativo → error', () => {
    const r = parseBoxSizeDraft({ width: '-100', depth: '600', height: '2000' });
    expect(r).toMatchObject({ ok: false });
  });
  it('campo vacío → error', () => {
    const r = parseBoxSizeDraft({ width: '', depth: '600', height: '2000' });
    expect(r).toMatchObject({ ok: false });
  });
});

describe('parseCylinderSizeDraft', () => {
  it('diámetro y longitud positivos → ok', () => {
    const r = parseCylinderSizeDraft({ diameter: '300', length: '500' });
    expect(r).toEqual({ ok: true, value: { diameter: 300, length: 500 } });
  });
  it('cero en diámetro → error', () => {
    const r = parseCylinderSizeDraft({ diameter: '0', length: '500' });
    expect(r).toMatchObject({ ok: false });
  });
  it('longitud negativa → error', () => {
    const r = parseCylinderSizeDraft({ diameter: '300', length: '-1' });
    expect(r).toMatchObject({ ok: false });
  });
});

// ─── Conversión global ↔ local ────────────────────────────────────────────────

describe('globalToLocalPositionMm', () => {
  it('padre en origen con rotación identidad: local = global', () => {
    const global: Vec3 = { x: 500, y: 300, z: 100 };
    const parentPos: Vec3 = { x: 0, y: 0, z: 0 };
    const result = globalToLocalPositionMm(global, parentPos, IDENTITY_QUATERNION);
    expect(result.x).toBeCloseTo(500, 5);
    expect(result.y).toBeCloseTo(300, 5);
    expect(result.z).toBeCloseTo(100, 5);
  });

  it('padre trasladado con rotación identidad: local = global − padre', () => {
    const global: Vec3 = { x: 2500, y: -4000, z: 500 };
    const parentPos: Vec3 = { x: 2000, y: -5000, z: 400 };
    const result = globalToLocalPositionMm(global, parentPos, IDENTITY_QUATERNION);
    expect(result.x).toBeCloseTo(500, 5);
    expect(result.y).toBeCloseTo(1000, 5);
    expect(result.z).toBeCloseTo(100, 5);
  });

  it('padre rotado 90°Z: offset local queda rotado', () => {
    // Padre en origen, rotado 90°Z → local X mapea a global Y
    const qRot90Z = { x: 0, y: 0, z: Math.SQRT2 / 2, w: Math.SQRT2 / 2 };
    const parentPos: Vec3 = { x: 0, y: 0, z: 0 };
    // global (0, 1000, 0) = padre_rot * local (1000, 0, 0) → local debe ser (1000, 0, 0)
    // Con rot 90°Z: rotate([1000,0,0]) = [0, 1000, 0]
    const global: Vec3 = { x: 0, y: 1000, z: 0 };
    const result = globalToLocalPositionMm(global, parentPos, qRot90Z);
    expect(result.x).toBeCloseTo(1000, 4);
    expect(result.y).toBeCloseTo(0, 4);
    expect(result.z).toBeCloseTo(0, 4);
  });

  it('round-trip: aplicar padre y volver recupera posición local original', () => {
    const SIN_PI8 = Math.sin(Math.PI / 8);
    const COS_PI8 = Math.cos(Math.PI / 8);
    const parentRot = { x: 0, y: 0, z: SIN_PI8, w: COS_PI8 };
    const parentPos: Vec3 = { x: 2000, y: -5000, z: 400 };
    const localOrig: Vec3 = { x: 0, y: 800, z: 0 };

    // Simular cómo el adapter calcula global
    function rotVec(q: typeof IDENTITY_QUATERNION, v: Vec3): Vec3 {
      const tx = 2 * (q.y * v.z - q.z * v.y);
      const ty = 2 * (q.z * v.x - q.x * v.z);
      const tz = 2 * (q.x * v.y - q.y * v.x);
      return {
        x: v.x + q.w * tx + (q.y * tz - q.z * ty),
        y: v.y + q.w * ty + (q.z * tx - q.x * tz),
        z: v.z + q.w * tz + (q.x * ty - q.y * tx),
      };
    }
    const rotated = rotVec(parentRot, localOrig);
    const globalPos: Vec3 = {
      x: parentPos.x + rotated.x,
      y: parentPos.y + rotated.y,
      z: parentPos.z + rotated.z,
    };

    const recovered = globalToLocalPositionMm(globalPos, parentPos, parentRot);
    expect(recovered.x).toBeCloseTo(localOrig.x, 4);
    expect(recovered.y).toBeCloseTo(localOrig.y, 4);
    expect(recovered.z).toBeCloseTo(localOrig.z, 4);
  });
});

// ─── Constructores de elementos ───────────────────────────────────────────────

describe('applyBoxSizeEdit', () => {
  const baseEl = PREVIEW_ELEMENTS.find((e) => e.id === 'panel-1')!;

  it('cambio de alto ajusta positionMm.z para conservar la base', () => {
    expect(baseEl.placementStatus).toBe('placed');
    expect(baseEl.geometry?.kind).toBe('box');
    if (baseEl.placementStatus !== 'placed' || baseEl.geometry?.kind !== 'box') return;

    const oldH = baseEl.geometry.heightMm;
    const newH = oldH + 400; // +400mm
    const { element: updated, childDeltaZ } = applyBoxSizeEdit(baseEl, baseEl.geometry.widthMm, baseEl.geometry.depthMm, newH);

    expect(childDeltaZ).toBeCloseTo(200, 5); // (400)/2
    expect(updated.placementStatus).toBe('placed');
    if (updated.placementStatus !== 'placed') return;
    // La base se conserva: new_z = old_z + 200
    expect(updated.transform.positionMm.z).toBeCloseTo(baseEl.transform.positionMm.z + 200, 5);
    // La base permanece igual: new_z - new_h/2 = old_z - old_h/2
    const oldBase = baseEl.transform.positionMm.z - oldH / 2;
    const newBase = updated.transform.positionMm.z - newH / 2;
    expect(newBase).toBeCloseTo(oldBase, 5);
  });

  it('cambio de ancho/profundidad no altera positionMm.z', () => {
    if (baseEl.placementStatus !== 'placed' || baseEl.geometry?.kind !== 'box') return;
    const { element: updated, childDeltaZ } = applyBoxSizeEdit(baseEl, 1200, 800, baseEl.geometry.heightMm);
    expect(childDeltaZ).toBe(0);
    expect(updated.placementStatus).toBe('placed');
    if (updated.placementStatus !== 'placed') return;
    expect(updated.transform.positionMm.z).toBe(baseEl.transform.positionMm.z);
  });

  it('no modifica el elemento original (inmutabilidad)', () => {
    if (baseEl.placementStatus !== 'placed' || baseEl.geometry?.kind !== 'box') return;
    const origH = baseEl.geometry.heightMm;
    applyBoxSizeEdit(baseEl, baseEl.geometry.widthMm, baseEl.geometry.depthMm, origH + 1000);
    expect(baseEl.geometry.heightMm).toBe(origH);
  });
});

describe('applyCylinderSizeEdit', () => {
  const baseEl = PREVIEW_ELEMENTS.find((e) => e.id === 'motor-1')!;

  it('cambio de longitud ajusta positionMm.z para conservar la base', () => {
    if (baseEl.placementStatus !== 'placed' || baseEl.geometry?.kind !== 'cylinder') return;
    const oldL = baseEl.geometry.lengthMm;
    const newL = oldL + 200;
    const { element: updated, childDeltaZ } = applyCylinderSizeEdit(baseEl, baseEl.geometry.diameterMm, newL);
    expect(childDeltaZ).toBeCloseTo(100, 5);
    expect(updated.placementStatus).toBe('placed');
    if (updated.placementStatus !== 'placed') return;
    const oldBase = baseEl.transform.positionMm.z - oldL / 2;
    const newBase = updated.transform.positionMm.z - newL / 2;
    expect(newBase).toBeCloseTo(oldBase, 5);
  });
});

describe('adjustChildLocalZ', () => {
  it('resta childDeltaZ de la posición local Z del hijo', () => {
    const child = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    if (child.placementStatus !== 'placed') return;
    const origZ = child.transform.positionMm.z;
    const adjusted = adjustChildLocalZ(child, 100);
    expect(adjusted.placementStatus).toBe('placed');
    if (adjusted.placementStatus !== 'placed') return;
    expect(adjusted.transform.positionMm.z).toBeCloseTo(origZ - 100, 5);
  });
});

// ─── Store: updateElement y resetElements ─────────────────────────────────────

describe('usePreviewStore — updateElement', () => {
  it('actualiza el elemento con el id indicado', () => {
    const store = usePreviewStore.getState();
    const original = store.elements.find((e) => e.id === 'motor-1')!;
    const updated = applyNameEdit(original, 'Motor Modificado');
    store.updateElement(updated);
    expect(usePreviewStore.getState().elements.find((e) => e.id === 'motor-1')?.name)
      .toBe('Motor Modificado');
  });

  it('no modifica otros elementos', () => {
    const store = usePreviewStore.getState();
    const original = store.elements.find((e) => e.id === 'motor-1')!;
    const countBefore = store.elements.length;
    store.updateElement(applyNameEdit(original, 'X'));
    expect(usePreviewStore.getState().elements.length).toBe(countBefore);
    expect(usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')?.name)
      .toBe(PREVIEW_ELEMENTS.find((e) => e.id === 'panel-1')?.name);
  });
});

describe('usePreviewStore — resetElements', () => {
  it('restaura todos los elementos a sus valores originales', () => {
    const store = usePreviewStore.getState();
    const motor = store.elements.find((e) => e.id === 'motor-1')!;
    store.updateElement(applyNameEdit(motor, 'Modificado'));
    store.resetElements();
    expect(usePreviewStore.getState().elements.find((e) => e.id === 'motor-1')?.name)
      .toBe(PREVIEW_ELEMENTS.find((e) => e.id === 'motor-1')?.name);
  });

  it('resetea también la selección', () => {
    usePreviewStore.getState().select('motor-1');
    usePreviewStore.getState().resetElements();
    expect(usePreviewStore.getState().selectedId).toBeNull();
  });

  it('no modifica las constantes de PREVIEW_ELEMENTS por referencia', () => {
    const origName = PREVIEW_ELEMENTS.find((e) => e.id === 'motor-1')!.name;
    const storeEl  = usePreviewStore.getState().elements.find((e) => e.id === 'motor-1')!;
    // La copia del store es un objeto distinto
    expect(storeEl).not.toBe(PREVIEW_ELEMENTS.find((e) => e.id === 'motor-1'));
    // Mutar la copia del store no afecta la constante
    usePreviewStore.getState().updateElement(applyNameEdit(storeEl, 'Modificado'));
    expect(PREVIEW_ELEMENTS.find((e) => e.id === 'motor-1')?.name).toBe(origName);
  });
});

// ─── Inspector — interacción con componente ───────────────────────────────────

describe('PreviewInspector — Aplicar nombre', () => {
  it('Aplicar con nombre válido actualiza el store y version', async () => {
    usePreviewStore.getState().select('motor-1');
    render(React.createElement(PreviewInspector));

    const input = screen.getByRole<HTMLInputElement>('textbox', { name: /Nombre/i });
    await userEvent.clear(input);
    await userEvent.type(input, 'Motor Renombrado');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    const updated = usePreviewStore.getState().elements.find((e) => e.id === 'motor-1')!;
    expect(updated.name).toBe('Motor Renombrado');
    expect(updated.version).toBeGreaterThan(
      PREVIEW_ELEMENTS.find((e) => e.id === 'motor-1')!.version,
    );
  });

  it('Aplicar sin cambios no incrementa version', async () => {
    usePreviewStore.getState().select('motor-1');
    const origVersion = usePreviewStore.getState().elements.find((e) => e.id === 'motor-1')!.version;
    render(React.createElement(PreviewInspector));

    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    const updated = usePreviewStore.getState().elements.find((e) => e.id === 'motor-1')!;
    expect(updated.version).toBe(origVersion);
  });

  it('Aplicar con nombre vacío muestra error y no modifica el store', async () => {
    usePreviewStore.getState().select('panel-1');
    const origName = usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')!.name;
    render(React.createElement(PreviewInspector));

    const input = screen.getByRole<HTMLInputElement>('textbox', { name: /Nombre/i });
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(screen.getByText(/El nombre no puede estar vacío/i)).toBeTruthy();
    expect(usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')?.name).toBe(origName);
  });
});

describe('PreviewInspector — Cancelar', () => {
  it('Cancelar revierte el borrador sin modificar el store', async () => {
    usePreviewStore.getState().select('motor-1');
    render(React.createElement(PreviewInspector));

    const input = screen.getByRole<HTMLInputElement>('textbox', { name: /Nombre/i });
    const originalValue = input.value;
    await userEvent.clear(input);
    await userEvent.type(input, 'Nombre temporal');

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(input.value).toBe(originalValue);
    expect(usePreviewStore.getState().elements.find((e) => e.id === 'motor-1')?.name)
      .toBe(originalValue);
  });
});

describe('PreviewInspector — entradas inválidas', () => {
  it('posición no numérica muestra error y no guarda', async () => {
    usePreviewStore.getState().select('panel-1');
    const origPos = { ...usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')!.transform!.positionMm };
    render(React.createElement(PreviewInspector));

    const xInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^X/i });
    await userEvent.clear(xInput);
    await userEvent.type(xInput, 'no-es-numero');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(screen.getByText(/Ingresá un número válido/i)).toBeTruthy();
    const el = usePreviewStore.getState().elements.find((e) => e.id === 'panel-1')!;
    expect(el.transform!.positionMm.x).toBe(origPos.x);
  });

  it('dimensión cero muestra error y no guarda', async () => {
    usePreviewStore.getState().select('panel-1');
    render(React.createElement(PreviewInspector));

    const widthInput = screen.getByRole<HTMLInputElement>('textbox', { name: /Ancho/i });
    await userEvent.clear(widthInput);
    await userEvent.type(widthInput, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(screen.getByText(/Debe ser un número positivo/i)).toBeTruthy();
  });
});

describe('PreviewInspector — conservación de campos técnicos', () => {
  it('Aplicar nombre no altera los datos técnicos del motor', async () => {
    usePreviewStore.getState().select('motor-1');
    const origTechnical = { ...usePreviewStore.getState().elements.find((e) => e.id === 'motor-1')!.technical };
    render(React.createElement(PreviewInspector));

    const input = screen.getByRole<HTMLInputElement>('textbox', { name: /Nombre/i });
    await userEvent.clear(input);
    await userEvent.type(input, 'Nuevo nombre motor');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    const updated = usePreviewStore.getState().elements.find((e) => e.id === 'motor-1')!;
    expect(JSON.stringify(updated.technical)).toBe(JSON.stringify(origTechnical));
    expect(updated.category).toBe('motor');
    expect(updated.id).toBe('motor-1');
  });
});

describe('PreviewInspector — hijo con padre rotado', () => {
  it('editar posición global del hijo guarda posición local correcta', async () => {
    usePreviewStore.getState().select('child-motor-1');
    render(React.createElement(PreviewInspector));

    // El hijo tiene padreId = support-panel-1 (rotado 45°Z)
    // La posición global actual es la calculada por resolveGlobalTransform
    // Cambiamos Z global a un valor arbitrario; verificamos que la local se recalcula
    const zInput = screen.getByRole<HTMLInputElement>('textbox', { name: /^Z/i });
    const globalZActual = parseFloat(zInput.value);

    // Cambiar Z global en +1000mm
    await userEvent.clear(zInput);
    await userEvent.type(zInput, String(globalZActual + 1000));
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    const updated = usePreviewStore.getState().elements.find((e) => e.id === 'child-motor-1')!;
    expect(updated.placementStatus).toBe('placed');
    if (updated.placementStatus !== 'placed') return;

    // La posición local Z debe haber aumentado en ~1000 (padre tiene rot. horizontal, no afecta Z)
    const origChild = PREVIEW_ELEMENTS.find((e) => e.id === 'child-motor-1')!;
    if (origChild.placementStatus !== 'placed') return;
    expect(updated.transform.positionMm.z).toBeCloseTo(origChild.transform.positionMm.z + 1000, 3);
  });
});

describe('PreviewInspector — redimensionar con hijo', () => {
  it('aumentar alto de support-panel preserva posición global del hijo', async () => {
    usePreviewStore.getState().select('support-panel-1');
    render(React.createElement(PreviewInspector));

    const heightInput = screen.getByRole<HTMLInputElement>('textbox', { name: /Alto/i });
    const origHeight = parseFloat(heightInput.value);
    const newHeight = origHeight + 400;

    // Leer posición global del hijo ANTES de resize
    const { resolveGlobalTransform } = await import('../../scene/v2-adapter');
    const elemsBefore = usePreviewStore.getState().elements;
    const childGlobalBefore = resolveGlobalTransform('child-motor-1', elemsBefore);
    expect(childGlobalBefore).not.toBeNull();

    await userEvent.clear(heightInput);
    await userEvent.type(heightInput, String(newHeight));
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    // Leer posición global del hijo DESPUÉS de resize
    const elemsAfter = usePreviewStore.getState().elements;
    const childGlobalAfter = resolveGlobalTransform('child-motor-1', elemsAfter);

    expect(childGlobalAfter).not.toBeNull();
    // La posición global del hijo debe conservarse (dentro de precisión numérica)
    expect(childGlobalAfter!.positionMm.x).toBeCloseTo(childGlobalBefore!.positionMm.x, 3);
    expect(childGlobalAfter!.positionMm.y).toBeCloseTo(childGlobalBefore!.positionMm.y, 3);
    expect(childGlobalAfter!.positionMm.z).toBeCloseTo(childGlobalBefore!.positionMm.z, 3);
  });
});

describe('Restablecer vista de prueba', () => {
  it('resetElements recupera la escena original tras edición', () => {
    const store = usePreviewStore.getState();
    const motor = store.elements.find((e) => e.id === 'motor-1')!;
    store.updateElement(applyNameEdit(motor, 'Modificado'));
    store.updateElement(
      applyPositionEdit(motor, { x: 99999, y: 99999, z: 99999 }, null),
    );

    store.resetElements();

    const restored = usePreviewStore.getState().elements.find((e) => e.id === 'motor-1')!;
    const original = PREVIEW_ELEMENTS.find((e) => e.id === 'motor-1')!;
    expect(restored.name).toBe(original.name);
    if (restored.placementStatus === 'placed' && original.placementStatus === 'placed') {
      expect(restored.transform.positionMm.x).toBe(original.transform.positionMm.x);
    }
    expect(restored.version).toBe(original.version);
  });
});
