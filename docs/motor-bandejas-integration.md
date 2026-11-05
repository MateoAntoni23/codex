# Integración experimental motor_bandejas 0.2.2

## Inicio reproducible (Windows)

Requisitos: Node 24 LTS, Python >= 3.10, Git. No se requiere pip para calcular.
En PowerShell, dentro del repositorio:

```powershell
npm ci
python --version
npm run dev:trays
```

Abrir `http://localhost:5173/?workspace=bandejas`. El comando inicia Vite y Python
juntos. Ctrl+C detiene ambos. Si Python usa otro ejecutable, establecer
`$env:TRAY_PYTHON='py'` (si el launcher selecciona Python >=3.10).
Cerrar previamente Vite u otro proceso que ocupe 5173/8765. strictPort evita
cambiar de puerto y romper el control de origen. No usar --host público.

Linux: `npm ci && npm run dev:trays`; usa python3. Inicio separado:
`python3 server/tray_service.py` y `npm run dev -- --port 5173 --strictPort`.

El editor normal y `?preview=v2` siguen disponibles. El módulo de bandejas está
separado y en memoria: no activa v2, no migra ni guarda proyectos reales.
No hay resultados restaurados que puedan presentarse como vigentes.

## Arquitectura

React + Zustand → `/api/motor/v1/*` → proxy Vite → Python `127.0.0.1:8765`.
El navegador solo usa URLs relativas del mismo origen. Python contiene las
fórmulas y reglas; TypeScript transforma coordenadas y valida contratos.
Se conserva íntegro el paquete original en `vendor/motor_bandejas`.
`server/tray_service.py` hereda su manejador y conserva controles Host, Origin,
Content-Type, límites y errores. Agrega GET catalogos/ejemplos, solo lectura.
Los cambios en decisiones se detectan también mediante SHA-256.
El contexto se carga al iniciar: tras actualizar datos, reiniciar el servicio;
el cliente comprueba salud/versiones al calcular y cada 30 segundos.

Despliegue: usar backend/reverse proxy del mismo origen para `/api/motor/`,
reescribir a `/v1/`, Host a `127.0.0.1:8765` y configurar `--origin` con el origen
HTTPS real. Mantener Python privado; este servidor de biblioteca estándar es
solo para desarrollo/integración experimental. Autenticación/autorización y
operación de producción deben suministrarlas el backend de despliegue.
No exponer http.server ni desactivar verificaciones de acceso.

## Modelo y mapeo

- Clave lógica de trazado: `trazado`; revisión monotónica en Zustand.
- `instancia_id`: pieza física estable. `producto_id`: referencia al catálogo.
  SKU se consulta, nunca se decodifica para inferir medidas.
- `puertos`: posiciones globales mm, direcciones salientes unitarias. El visor
  usa `[x/1000,z/1000,-y/1000]` exclusivamente para mostrar.
- `conexiones`: pares instancia/puerto, no cruces visuales implícitos.
- `circuitos`: cable de catálogo, cantidad y secuencia de piezas.
- `soportes`: entidades propias, posición desde P1. El vano lo calcula Python
  desde apoyos; no se confunde con longitud comercial ni recorrido.
- Tapas, accesorios, PE y equipotencialidad permanecen entidades distintas en
  `trazado/1`. Edición avanzada mediante JSON validado; formularios para piezas,
  puertos, productos, cables/cantidades/recorridos, soportes y modelo candidato PE.
- Solicitud `motor_bandejas/1.0` tipo trazado, entrada `trazado/1`.
- `GestorSolicitudes` original controla eco/revisión; guardas adicionales impiden
  errores de transporte antiguos o cálculos simultáneos de la misma revisión.
- Editar invalida el resultado y su selección asociada; la selección física de pieza
  se conserva para poder continuar editando. Resultados anteriores se conservan
  como NO VIGENTES hasta nuevo cálculo correcto. Versiones cambiadas también
  invalidan. Fallo de salud/desconexión no deja un resultado presentado como vigente.

Los diagnósticos por pieza, boca, conexión y soporte permiten localizar su pieza
en el visor y centrar el objetivo de cámara. Resultados agregados no siempre
poseen una entidad física y se muestran con toda su estructura trazable.

## Uso y límites explícitos

1. Cargar ejemplo **SINTÉTICO** con derivación. No constituye instalación real.
2. Seleccionar pieza; editar producto, longitud y posiciones globales de bocas.
3. Editar circuitos, soportes y modelo candidato de PE. El requisito de proyecto
   sigue siendo 16 mm² verde/amarillo; modelo y montaje NO se dan por definitivos.
4. Calcular; consultar ocupación/reserva (base nominal o útil explícita), cargas,
   exclusiones, compatibilidad, curvatura, vanos, PE, conexiones previstas, BOM
   y fuentes. Todo se devuelve desde Python, no se recalcula en React.
5. Editar → DESACTUALIZADO → recalcular. Probar servicio detenido para ver error.
6. Casos sectoriales 1/2/3 disponibles como cálculos independientes del trazado.

La vista representa ejes y puertos, no dimensiones físicas acreditadas de curvas
ni T. Un recto nuevo comienza con geometría esquemática editable claramente dentro
 del espacio sintético; sus extremos, longitud y conexiones deben ajustarse.
No genera accesorios o terminales por suposición. Edición de conexiones simples
mediante botón; resto de entidades mediante editor JSON. Aún no hay dibujo por
clic, carga de un proyecto real, conversión automática de equipos a circuitos,
validación completa de cableado de máquinas, ni persistencia de bandejas.

El contacto con el ala NO es continuidad eléctrica. Se muestran separadamente
cobertura física, sección/color, conexiones previstas, sistema de protección,
verificación eléctrica de diseño e inspección/medición. Nunca “instalación aprobada”.
La geometría esquemática del PE no demuestra posición exacta contra el ala.

### Decisiones pendientes conservadas

- D-19: hueco PE/potencia y ubicación respecto del ala.
- D-21: modelo definitivo del PE y admisibilidad en bandeja.
- D-30: tolerancia técnica.
- Validez normativa de reserva y otros criterios condicionados.
- Montaje de soportes y conexiones equipotenciales sin fuente suficiente.

Ver `vendor/motor_bandejas/docs/PENDIENTES.md` y `DECISIONES.md`. La interfaz no
resuelve esos puntos por defecto; presenta las condiciones del motor.

## Verificaciones reproducibles

```sh
npm test
npm run typecheck
npm run build
cd vendor/motor_bandejas
python -m unittest discover -s pruebas -p 'test_*.py'
python herramientas/generar_vectores.py --verificar
python herramientas/verificar_snapshot.py
cd ../..
node --experimental-strip-types --test vendor/motor_bandejas/integracion/ts/gestorSolicitudes.test.ts vendor/motor_bandejas/integracion/ts/auditoria_v021.test.ts
npx tsc -p vendor/motor_bandejas/integracion/ts/tsconfig.json
python -m unittest discover -s server -p 'test_*.py'
```

Las verificaciones del Excel requieren openpyxl (`python -m pip install openpyxl`);
el cálculo y el servicio no lo requieren.

Los tests originales TS usan su runner Node (assert), no Vitest: se ejecutan
ambos archivos por separado del patrón `src/**/*.test.*` del editor.
Los archivos originales agrupan varias aserciones; Node informa dos archivos,
no convertir ese conteo en trece tests independientes.

Smoke real opcional: instalar Playwright Python y Chromium, iniciar dev:trays,
y ejecutar `python scripts/smoke-trays.py`. Si se usa navegador del sistema,
configurar CHROMIUM_PATH. Guarda captura en `artifacts/` (ignorado por Git).
