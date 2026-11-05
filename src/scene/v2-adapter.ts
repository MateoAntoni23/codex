import type { Id, Vec3, Quaternion, Geometry, Category, EquipmentElement } from '../types/domain-v2';

/** Rotation -90° around X: maps domain Z-up to viewer Y-up. */
const Q_BASE: Quaternion = { x: -Math.SQRT2 / 2, y: 0, z: 0, w: Math.SQRT2 / 2 };

function multiplyQuaternions(p: Quaternion, q: Quaternion): Quaternion {
  return {
    x:  p.w * q.x + p.x * q.w + p.y * q.z - p.z * q.y,
    y:  p.w * q.y - p.x * q.z + p.y * q.w + p.z * q.x,
    z:  p.w * q.z + p.x * q.y - p.y * q.x + p.z * q.w,
    w:  p.w * q.w - p.x * q.x - p.y * q.y - p.z * q.z,
  };
}

function rotateVec3ByQuaternion(q: Quaternion, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

type GlobalTransform = { positionMm: Vec3; rotation: Quaternion };

function resolveFromMap(
  id: Id,
  elemMap: Map<Id, EquipmentElement>,
  visited: Set<Id>,
): GlobalTransform | null {
  if (visited.has(id)) return null; // cycle
  const element = elemMap.get(id);
  if (element == null) return null; // not found
  if (element.placementStatus === 'unplaced') return null;

  const { positionMm, rotation } = element.transform;

  if (element.parentId === null) {
    return { positionMm, rotation };
  }

  const nextVisited = new Set(visited);
  nextVisited.add(id);
  const parentTransform = resolveFromMap(element.parentId, elemMap, nextVisited);
  if (parentTransform === null) return null;

  const rotatedLocal = rotateVec3ByQuaternion(parentTransform.rotation, positionMm);
  return {
    positionMm: {
      x: parentTransform.positionMm.x + rotatedLocal.x,
      y: parentTransform.positionMm.y + rotatedLocal.y,
      z: parentTransform.positionMm.z + rotatedLocal.z,
    },
    rotation: multiplyQuaternions(parentTransform.rotation, rotation),
  };
}

/**
 * Resolves the global transform for an element, traversing the parentId hierarchy.
 * Returns null if the element or any ancestor is unplaced, a parentId is not found,
 * or a cycle is detected.
 */
export function resolveGlobalTransform(
  id: Id,
  elements: EquipmentElement[],
  visited: Set<Id> = new Set(),
): GlobalTransform | null {
  const elemMap = new Map(elements.map((e) => [e.id, e]));
  return resolveFromMap(id, elemMap, visited);
}

function geometrySizeViewer(geometry: Geometry): [number, number, number] {
  switch (geometry.kind) {
    case 'box':
      return [geometry.widthMm / 1000, geometry.heightMm / 1000, geometry.depthMm / 1000];
    case 'cylinder':
      return [geometry.diameterMm / 1000, geometry.lengthMm / 1000, geometry.diameterMm / 1000];
    case 'plane':
      return [geometry.widthMm / 1000, 0, geometry.depthMm / 1000];
    case 'asset':
      return [geometry.boundsMm.x / 1000, geometry.boundsMm.z / 1000, geometry.boundsMm.y / 1000];
  }
}

export interface ElementRenderProps {
  id: Id;
  name: string;
  category: Category;
  /** false when the element or any ancestor is unplaced, or a parent is missing/cyclic. */
  placed: boolean;
  /** Three.js position in meters [x, y, z]. null when placed=false. */
  positionViewer: [number, number, number] | null;
  /** Three.js quaternion [x, y, z, w]. null when placed=false. */
  rotationViewer: [number, number, number, number] | null;
  /** Three.js size [width, height, depth] in meters. null when placed=false or geometry unknown. */
  sizeViewer: [number, number, number] | null;
  geometryKind: 'box' | 'cylinder' | 'plane' | 'asset' | 'unknown';
  /** True for planar floor-mounted elements (renders flat on the ground). */
  isFloor: boolean;
}

/**
 * Converts an EquipmentElement to viewer-ready render props.
 * Coordinate system: domain mm Z-up → Three.js meters Y-up.
 * Position mapping: viewer = [x/1000, z/1000, -y/1000].
 * Rotation mapping: Q_viewer = Q_base × Q_domain_global (Q_base = -90° around X).
 */
export function elementToRenderProps(
  element: EquipmentElement,
  allElements: EquipmentElement[],
): ElementRenderProps {
  const elemMap = new Map(allElements.map((e) => [e.id, e]));
  const globalTransform = resolveFromMap(element.id, elemMap, new Set());

  const geometryKind = element.geometry?.kind ?? 'unknown';
  const isFloor = element.geometry?.kind === 'plane' && element.mounting === 'floor';

  if (globalTransform === null) {
    return {
      id: element.id,
      name: element.name,
      category: element.category,
      placed: false,
      positionViewer: null,
      rotationViewer: null,
      sizeViewer: null,
      geometryKind,
      isFloor,
    };
  }

  const { positionMm, rotation } = globalTransform;

  const positionViewer: [number, number, number] = [
    positionMm.x / 1000,
    positionMm.z / 1000,
    -(positionMm.y / 1000),
  ];

  const viewerQuat = multiplyQuaternions(Q_BASE, rotation);
  const rotationViewer: [number, number, number, number] = [
    viewerQuat.x,
    viewerQuat.y,
    viewerQuat.z,
    viewerQuat.w,
  ];

  const sizeViewer = element.geometry != null ? geometrySizeViewer(element.geometry) : null;

  return {
    id: element.id,
    name: element.name,
    category: element.category,
    placed: true,
    positionViewer,
    rotationViewer,
    sizeViewer,
    geometryKind,
    isFloor,
  };
}
