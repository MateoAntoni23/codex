# Dudas y datos pendientes — Importación ELS-IMP-EQCX v1.0 (Rev0)

El detalle de cada caso está en la hoja `PENDIENTES` del libro (93 filas: 77 advertencias y 16 INFO, ningún error). Acá quedan solo las dudas que hay que decidir.

## A. Decisiones de método (antes de la Rev1)

1. **¿Qué archivo manda de ahora en adelante?** Los IDs `EQ-`, `CX-`, `CMP-` y `AT-` se asignaron en esta Rev0. Hay dos caminos:
   - **(a)** El libro de importación pasa a ser la fuente que se edita. Los IDs quedan estables sin trabajo adicional.
   - **(b)** El libro se regenera desde el EGT en cada revisión. En ese caso hace falta guardar la tabla de correspondencia TAG/CB → ID. Si no, los IDs pueden cambiar y la reimportación pierde el vínculo con el diseño 3D.
   Recomiendo (a), o (b) con la tabla de correspondencia.
2. **Retirados.** En el EGT lo quitado se borra. En este formato los retirados se conservan con `RETIRADO`, como pediste para la trazabilidad. Hay que confirmar que conviven las dos reglas: el EGT borra y el libro de importación conserva.

## B. Datos técnicos en conflicto

3. **G120X del exhaustor:** ¿es nuevo o existente? APARAMENTA dice "existente (reutiliza)"; TABLEROS y LEEME lo presentan como nuevo. Quedó `A_DEFINIR`.
4. **Potencias que no cierran (se conservaron ambos valores; vigente = kW adoptado):**
   - S1-SOP101: 15 HP contra 7,5 kW.
   - S1-VLC, S1-VEC1, S1-VEC2 y S1-VLF: 10 HP contra 9 kW.
   - EB-GVA101: 7,5 HP contra 11 kW.
   - EB-BBA103: 7,5 HP contra 4 kW.
   - EB-BBA105 a 108 y EB-BBA202: la columna HP dice 5,5, igual al kW. Posiblemente se cargó el kW en la columna de HP.
5. **S1-VEN104/105:** ELEMENTOS los marca "nuevo", pero D-02 dice que Secado no lleva motores nuevos.
6. **Cables CB-055, CB-059, CB-249 y CB-250:** D-43 dice que ya existen, pero el EGT les asigna metraje de compra. Se marcaron `EXISTENTE`.
7. **Numeración de proyectores S1-PR4…PR11:** CARGAS_S1 no coincide con ELEMENTOS ni con CONDUCTORES. Se adoptó ELEMENTOS.

## C. Neumática

8. **EA-VD-CRI, EA-VC101, EA-VC102 y EB-VC102:** figuran mandadas "vía TAB-NA/TAB-N", pero no tienen electroválvula ni tubing en NEUMATICA. Si llevan electroválvula, cambian el conteo de 20/22 EV y la ocupación del multipolar 27×1.
9. **EB-VEA101/103 (doble efecto, 5/2):**
   - El origen prevé 1 tubo por válvula. Un actuador de doble efecto normalmente lleva 2.
   - El texto de marca dice "3/2 NC", que contradice el 5/2.
10. **Tubing Ø 6 mm:** falta saber si es exterior o interior, y definir el material (PU/PA). Presión de trabajo pendiente (RL-07/RL-19).

## D. Extremos de conexión y clasificación

11. **CB-018 (troncal de la guirnalda UPS de Secado):** el destino es "Recorrido Secado". ¿A qué caja llega primero?
12. **Tramos CB-210/211/212:** van de luminaria a luminaria (S1-PREMn). ¿Corresponde que vayan de caja a caja (Caja S1-PREMn, D-36)?
13. **Subárea FM:** 12 equipos mencionan "filtro de manga" en la descripción, pero el origen no los asigna a la subárea (SOP102, MRT01/02/04/05/21, PP101, VEN104/105, VC104, VDM104, TT109). Hay que indicar cuáles van a FM.
14. **Toberas S1-TB1…TB4:** se trasladaron como solenoides dentro de TAB-NTOB. ¿Hace falta un equipo de campo "tobera" con TAG propio para ubicarlo en 3D?
15. **CB-005 (neutro del alimentador de TAB-B):** el origen lo asigna a EVA; el resto del alimentador está en EVB (D-07). Hay que corregirlo en el EGT.

## E. Faltan en el origen (no bloquean la importación)

- Ubicaciones de la mayoría de los equipos de Evaporación (RL-05).
- Rango, conexión a proceso, material e IP de los instrumentos.
- Dimensiones de TAB-B, TAB-C, TAB-N, TAB-NA y de los tableros de servicio.
- Diámetros exteriores de cables (D-51: los define la herramienta nueva).
