# Traspaso — biblioteca de conductores

Rama `feat/biblioteca-conductores`, sobre `feat/conexiones-importadas` (PR #12, sin fusionar): la guía
de qué cargar (A6) cuenta tendidos del Excel con el casamiento de ese PR, que todavía no está en `main`.
Worktree `../codex-biblioteca`. E2E con puertos propios (`CI=1 CODEX_WEB_PORT=5273 CODEX_MOTOR_PORT=8865
CODEX_NOMOTOR_WEB_PORT=5283`).

## Encargo (operador, 2026-11-15)

Dos partes. Al cerrar la A, parar y esperar.

**Por qué.** El catálogo de cables del motor (113 cables, dos líneas Prysmian) no cubre lo que usa el
operador: llega hasta 4 conductores y arranca en 1,5 mm² en multipolar y 4 mm² en unipolar. En el Excel de
ejemplo quedan afuera 8 tendidos de potencia 3F+N+PE (5×6 y 5×10) y 117 de 1 mm² (114 de 2 a 4 conductores:
64 de control y 50 de instrumentación; 3 de 7×1 y 27×1). En una bandeja segregada el grupo de mando no tiene
ocupación calculable. Diámetros a cargar: 5×6, 5×10, 2×1, 3×1, 4×1, 7×1 y 27×1.

### Parte A — ver y cargar
- A1. Pestaña de configuración «Biblioteca de conductores», junto a la de modelos: todos los cables, filtro
  por línea, tipo y sección, y buscador.
- A2. De cada cable: designación, línea, tipo, conductores, sección, diámetro exterior, masa por km y su
  ORIGEN: «catálogo del motor» (los 113, solo lectura, dato vendorizado) o «declarado por el operador» (se
  editan y se borran).
- A3. Cargar un cable declarado: designación, tipo, conductores, sección, diámetro exterior y masa por km.
  Diámetro y masa pueden quedar vacíos y la ficha dice qué no se puede calcular (sin diámetro no hay
  ocupación; sin masa no hay carga por pieza ni vanos). No inventar ni estimar desde la sección.
- A4. Duplicar un cable del catálogo como punto de partida: nace declarado por el operador, con esa
  procedencia escrita y de cuál salió.
- A5. La biblioteca es del operador (autoridad localStorage, como la de modelos), pero el proyecto guarda
  los declarados que usa, para que una copia abierta en otra máquina no pierda la ocupación. Resolverlo como
  la biblioteca de modelos y contar cómo quedó.
- A6. Cuántos tendidos del Excel casan con cada cable, y atajo a los tendidos sin cable agrupados por
  naturaleza, conductores y sección, con cuántos de cada combinación: exactamente las siete de arriba y
  cuántos destraba cada una.
- Pruebas: unitarias; E2E que cargue un declarado, recargue y lo encuentre; que uno del catálogo no se pueda
  editar; que uno sin diámetro muestre qué no se puede calcular.

### Parte B — usarlos en el cálculo (después de la aprobación de la A)
- B1. Un tendido casa con un declarado con las mismas reglas que con el catálogo, y se ve que es declarado.
- B2. Al motor no viaja ningún declarado. Las bandejas que lleven alguno: ocupación calculada por la APP
  (mismo mecanismo que la banda divisoria), marcada y distinguible de la del motor.
- B3. Bandeja mixta (catálogo + declarados): manda el cálculo de la app, y se dice por qué, nombrando los
  declarados.
- B4. Declarado sin diámetro: la bandeja sigue sin ocupación calculable y se dice cuál falta completar.
- B5. «N tendidos de potencia sin cable de catálogo» pasa a contar solo los que tampoco tienen declarado.
- Controles negativos: si un declarado viaja al motor, falla; si la ocupación de una bandeja con declarado
  aparece como del motor, falla.

Reglas de trabajo: typecheck + vitest + E2E tocadas; verify completo cuando el operador avise; empujar tras
cada commit; rama y PR propios, sin fusionar; campos nuevos opcionales sin subir la versión del archivo.
