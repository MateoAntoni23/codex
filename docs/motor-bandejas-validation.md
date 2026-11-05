# Registro de validación de la integración experimental

Fecha: 2026-11-05. No implica certificación de instalaciones.

- 190 pruebas originales Python: aprobadas, incluidos tests HTTP y regresiones.
- Dos archivos originales TypeScript: ejecutados con Node strip-types, ambos
  aprobados (el runner informa dos archivos; no inventar otro conteo).
- Verificación de tipos del cliente original TS: aprobada con tipos Node 22.
- Vectores originales: idénticos (`generar_vectores.py --verificar`).
- Snapshot: 11 tablas idénticas al Excel fuente.
- 547 tests Vitest: 541 existentes + 6 del adaptador/invalidation/asynchrony.
- 3 pruebas del servidor de integración: catálogo real, cuatro ejemplos mediante
  HTTP, Origin no permitido rechazado.
- TypeScript y build Vite: aprobados. Persiste aviso de tamaño de bundle.
- Chromium real, frontend + proxy Vite + Python: cálculo del ejemplo con
  derivación, edición de longitud, cantidad, producto, recorrido, soporte y PE;
  invalidación y recálculo; selección de R2 desde diagnóstico; tres casos
  sectoriales; caída de red simulada y reconexión. Sin errores JS de página.
- Archivos originales del vendor: cotejados byte por byte con el ZIP recibido.
  Hashes en `motor-bandejas-vendor-manifest.json`.

Los tests de asincronía usan promesas controladas: fallo antiguo tras edición,
fallos fuera de orden en la misma revisión, y cambio de versiones de servidor.
La prueba de desconexión de navegador corta las solicitudes mediante Playwright;
no simula un proyecto aprobado ni una verificación de campo. El servidor Python
ha sido probado como proceso real, no sustituido por un mock en el smoke.

No verificado en esta sesión: Windows real, despliegue productivo, proxy HTTPS
productivo, instalación eléctrica real ni geometrías acreditadas de accesorios.
Los datos y resultados nuevos son efímeros; proyectos guardados de equipos no
se modifican. La corrección previa pendiente de evidencia compartida al duplicar
un equipo no forma parte de esta integración y no se declara resuelta.

## Cambios de comportamiento y archivos

- `vendor/motor_bandejas`: paquete original versionado, sin cambiar reglas.
- `server/tray_service.py`: servicio privado y consultas de solo lectura.
- `src/tray/{model,client,store}.ts`: contrato runtime, HTTP, revisión y vigencia.
- `src/tray/TrayWorkspace.tsx`: visor y editor experimental de trazados.
- `vite.config.ts`: proxy de mismo origen y tests del editor limitados a src;
  tests originales del motor corren con su runner Node.
- `scripts/dev-trays.mjs`: inicio conjunto frontend/backend y cierre coordinado.
- `scripts/smoke-trays.py`: prueba de navegador reproducible opcional.
- `src/App.tsx`: ruta experimental por query; editor y preview anteriores intactos.
- `package.json` y lock: comando de inicio y tipos Node para tests originales TS.
- README y documentos de integración/validación: instrucciones y límites.
