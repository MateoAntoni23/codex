// Funciones puras para el editor de posición del inspector.
// Separadas del componente para poder probarse sin React.

export interface PositionDraft {
  x: string;
  y: string;
  z: string;
}

export type PositionErrors = Partial<Record<keyof PositionDraft, string>>;

export interface ParsedPosition {
  x: number;
  y: number;
  z: number;
}

type ParseResult =
  | { ok: true; value: ParsedPosition }
  | { ok: false; errors: PositionErrors };

/** Valida y convierte el borrador de texto a números. */
export function parsePositionDraft(draft: PositionDraft): ParseResult {
  const errors: PositionErrors = {};
  const value: ParsedPosition = { x: 0, y: 0, z: 0 };

  for (const axis of ['x', 'y', 'z'] as const) {
    const raw = draft[axis].trim();
    if (raw === '') {
      errors[axis] = 'El campo no puede estar vacío';
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        errors[axis] = 'Ingresá un número válido';
      } else {
        value[axis] = n;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}

/** Z del centro para que la base del objeto quede sobre el piso (Z_dominio = 0). */
export function snapToFloorZ(heightMm: number): number {
  return heightMm / 2;
}
