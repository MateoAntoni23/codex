# Traspaso — orientación de la curva vertical y compatibilidad física (rama `fix/cups-orientacion-compat`)

Base: `9a95b45`. Los pendientes vigentes siguen en `traspaso-recorridos.md`.

## Defecto 1 — la curva vertical ascendente salía hacia abajo
- **Causa:** el perfil medido es el del STEP **CUPS-300-A** (ascendente). El cambio §D6
  (`docs/pattern-models-reconciliation.md`) invirtió el marco de su boca horizontal para homogeneizarlo
  con los rectos. Desde entonces, toda CUPS se colocaba bajando.
- **Corrección, mismo perfil y una sola geometría** (`outlines.ts`, `SentidoVertical`): cambia solo el
  marco de la boca horizontal (P1_horizontal).
  - **sube:** el marco medido (u = −Z, v ≈ −Y);
  - **baja:** el de §D6.

  Al alinear su «arriba» con el del tramo entrante, la boca vertical sale hacia arriba o hacia abajo.
- **Sentido por producto:**
  - CUPS interior (A) sube y CUPS exterior (D) baja, fijo por producto (`sentidoPorTipo`; el maestro lo
    declara en `baseParams.sentido_vertical`).
  - **CUS articulada:** el operador elige «↑ Sube» o «↓ Baja» al colocar. No hay valor por defecto: sin
    elegir no hay previa ni confirmación (`routingPlacementFromState`, `planAddAccessory`).
  - La definición registra `sentido_vertical = 1` cuando sube, y entra en la huella. PB1: 7 huellas
    CUPS-A declaradas.
- **Previa y confirmada:** salen de la misma colocación memorizada (`computeRoutingPlacement`). No es el
  defecto anterior. Dos pruebas comparaban contra `placeRecipe` (colocador viejo, que solo usa la
  migración) y se corrigieron para comparar contra la previa real.
- **Limitación de `masterModels` cerrada** (cadena H → CUPS-D → V descendente):
  - `curvaVerticalSentido.test.ts`: las 7 A suben, las 7 D bajan, la CUS según lo elegido, y sin elegir
    no hay colocación;
  - E2E `curvaVerticalSentido` con gestos reales: A sube, D baja, CUS sube y CUS baja. Las uniones cumplen
    y el tramo siguiente arranca hacia el lado correcto.
  - **Control negativo:** invertir el sentido a propósito hace fallar las 4 pruebas (verificado).

## Defecto 2 — compatibilidad por la regla física
Ver `docs/reporte-compatibilidad.md` (informe para el operador).
- **`compatibilidadFisica.ts`:** misma familia, ancho y ala; el espesor no cuenta; SAM-SMT-ACC contra
  cualquiera; «no compatible» bloquea; la tabla es confirmación.
- **Usan la regla:**
  - el selector de continuación;
  - los candidatos (ya no ofrecen «compat. no documentada»);
  - la verificación al confirmar (`checkDirectCompatibility`);
  - «Unir extremos» (documentada o excepción);
  - la pestaña de continuaciones del configurador.
- **Consecuencia visible:** en la cadena del operador, curva 45–T y curva descendente–T dejaron de ser
  excepciones: cumplen la regla y quedan documentadas.
- **Pruebas:**
  - `compatibilidadFisica.test.ts` (control negativo: ninguna escalera desde ninguna perforada;
    verificado saboteando la regla);
  - E2E `mappingBocas` C5: desde la CPS-300-45-Z no se ofrece la CS-300-45-065-14-G ni ninguna escalera.
