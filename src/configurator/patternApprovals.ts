/**
 * patternApprovals — aprobaciones del Configurador separadas del mapping.
 *
 * Por qué un dict aparte y no un flag en `ProductPortMapping`:
 *   - Aprobar un patrón NO requiere override — un producto puede quedar
 *     aprobado con la calibración por defecto (si el usuario validó que esa
 *     calibración es correcta tal cual). Embedir aprobación en override
 *     obligaría a crear overrides vacíos sólo para aprobar.
 *   - Export/import: el payload del configurador lleva ambos sub-dicts por
 *     separado (`overrides`, `approvals`). Un archivo viejo sin `approvals`
 *     se interpreta como "sin aprobaciones", sin romper nada.
 *
 * Invalidación automática:
 *   - `approvedAtRevision` fija la revisión del maestro al aprobar. Si el
 *     maestro cambia de revisión (geometría, bocas canónicas, regla de
 *     variación), la aprobación queda `outdated`.
 *   - `approvedAtCalibrationHash` fija el hash de la calibración efectiva
 *     al aprobar. Si el usuario edita el mapping o la geometría de bocas
 *     después, la aprobación queda `outdated`.
 *   - `revokeApproval` borra la entrada por completo — vuelve a `none`.
 *
 * Snapshot (hito 3):
 *   `approvedMapping` congela el `ProductPortMapping` efectivo al momento de
 *   aprobar. Sirve como baseline "confirmado" para que el Configurador muestre
 *   el diff campo a campo contra el mapping "preview" actual cuando el estado
 *   es `outdated`. Es opcional porque:
 *     - En tests y en aprobaciones legacy (archivos previos a hito 3) puede
 *       faltar — la UI debe caer en modo "sin snapshot" sin romper nada.
 *     - La aprobación sigue siendo válida sin snapshot: `approvedAtCalibrationHash`
 *       basta para decidir vigencia. El snapshot sólo habilita el diff visual.
 */
import type { ProductPortMapping } from '../workspace/catalogPortMapping';

export interface PatternApproval {
  /** Revisión del maestro al momento de aprobar. */
  readonly approvedAtRevision: number;
  /** Hash de la calibración relevante al momento de aprobar. */
  readonly approvedAtCalibrationHash: string;
  /** Timestamp ISO del momento de aprobación. */
  readonly approvedAt: string;
  /**
   * Snapshot del mapping efectivo al aprobar. Opcional: aprobaciones legacy
   * carecen de este campo y la UI lo muestra como "sin baseline — re-aprobar
   * para habilitar diff". Clonado deeply al congelarse para que ediciones
   * posteriores del store no muten la referencia.
   */
  readonly approvedMapping?: ProductPortMapping;
  /**
   * B-2.5: calibración de bocas que aplicaba al producto al aprobar (corrección
   * del patrón o excepción de la variante). Ausente en aprobaciones anteriores.
   */
  readonly approvedCalibracion?: unknown;
  /**
   * B-2 (decisión 3): definición efectiva aprobada. La aprobación sigue
   * valiendo mientras la vigente dé la MISMA geometría (dentro de las
   * tolerancias de las fuentes), aunque cambie la huella o la revisión.
   */
  readonly approvedDefinicion?: unknown;
}

/**
 * Estado efectivo de aprobación para un producto. Lo computa el Configurador
 * comparando la aprobación persistida con la revisión actual del maestro y el
 * hash actual de la calibración.
 *
 *   - 'none'     — sin aprobación persistida.
 *   - 'current'  — aprobación vigente (revisión y calibración coinciden).
 *   - 'outdated' — aprobación persistida pero quedó obsoleta por un cambio.
 */
export type ApprovalStatus = 'none' | 'current' | 'outdated';

export interface ApprovalInfo {
  readonly status: ApprovalStatus;
  /** Aprobación persistida, si existe. Ausente cuando status === 'none'. */
  readonly stored?: PatternApproval;
  /** Revisión actual del maestro. Útil para mostrar "aprobado en rev X — ahora Y". */
  readonly currentRevision?: number;
  /** Hash actual de la calibración. Útil para diagnóstico. */
  readonly currentCalibrationHash?: string;
  /**
   * Motivo concreto de obsolescencia cuando status === 'outdated'.
   *   - 'revision-changed'   — cambió la revisión del maestro.
   *   - 'calibration-changed' — cambió la calibración (bocas, geometría, marco).
   *   - 'both'               — ambos.
   */
  readonly outdatedReason?: 'revision-changed' | 'calibration-changed' | 'both';
}

export function computeApprovalInfo(
  stored: PatternApproval | undefined,
  currentRevision: number | undefined,
  currentCalibrationHash: string | undefined,
): ApprovalInfo {
  if (!stored) {
    return { status: 'none', currentRevision, currentCalibrationHash };
  }
  const revisionChanged =
    currentRevision !== undefined && currentRevision !== stored.approvedAtRevision;
  const calibrationChanged =
    currentCalibrationHash !== undefined &&
    currentCalibrationHash !== stored.approvedAtCalibrationHash;
  if (!revisionChanged && !calibrationChanged) {
    return { status: 'current', stored, currentRevision, currentCalibrationHash };
  }
  const outdatedReason: 'revision-changed' | 'calibration-changed' | 'both' =
    revisionChanged && calibrationChanged
      ? 'both'
      : revisionChanged
        ? 'revision-changed'
        : 'calibration-changed';
  return {
    status: 'outdated',
    stored,
    currentRevision,
    currentCalibrationHash,
    outdatedReason,
  };
}
