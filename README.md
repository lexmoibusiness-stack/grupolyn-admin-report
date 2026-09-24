# Prueba técnica GrupoLyN: menú Admin y Reporte Comparativo Mensual

Apps Script para la plantilla de plan financiero de GrupoLyN. Tiene tres partes:

1. Un menú **Admin** con código de acceso.
2. El **Reporte Comparativo Mensual**, que puede salir en una pestaña o en un borrador de Gmail.
3. Un script de **despliegue masivo** a las copias de los clientes (bonus).

## Estructura

| Archivo | Responsabilidad |
|---|---|
| `src/Config.gs` | Todo lo que depende de la plantilla o del negocio: pestaña, columnas, umbral, sesión |
| `src/Auth.gs` | Código admin (hash con sal), sesión y límite de intentos |
| `src/Menu.gs` | Menú Admin y funciones públicas. Cada acción vuelve a verificar la sesión |
| `src/BudgetReader.gs` | Lee «Monthly Budget» y la convierte en datos. Función pura |
| `src/ReportBuilder.gs` | Reglas del reporte: desviación, umbral y conceptos responsables. Función pura |
| `src/SheetWriter.gs` | Genera el reporte como pestaña con formato |
| `src/EmailWriter.gs` | Genera el reporte como borrador de Gmail en HTML, listo para el cliente |
| `src/CodeDialog.html` | Diálogo con campo de contraseña oculto |
| `src/Main.gs` | `onOpen`: construye el menú Admin primero y después restaura el menú de la plantilla |
| `src/SelfTest.gs` | `lynSelfTest()`: prueba completa desde el editor (lectura, reporte, pestaña, borrador) sin pasar por el menú |
| `deploy/Deployer.gs` | Despliegue masivo mediante la Apps Script API |
| `tests/report.test.js` | 12 pruebas en Node con los datos reales de enero 2025 |
| `tests/deployer.test.js` | 5 pruebas del despliegue: parcheo del manifiesto (Rhino → V8, versión fijada), URLs, reemplazo de archivos |

Las dos salidas (pestaña y correo) se generan a partir del **mismo modelo de reporte**. Una regla nueva, como otro umbral u otra forma de elegir los conceptos, se cambia en un solo sitio.

## Enfoque

**Hallazgo previo: el proyecto no se ejecutaba.** El script de la plantilla estaba configurado con el runtime **Rhino** (`DEPRECATED_ES5`), que Google ya apagó. Todas las ejecuciones salían como "Inhabilitado" y al ejecutarlas a mano el error era *"The Rhino runtime is deprecated and no longer supported"*. Esto le pasaba a todo el proyecto: ni el menú anterior ni los scripts de `ProsprScript` corrían. El proyecto se migró a **V8**, y el despliegue masivo hace la misma migración en cada copia de cliente.

**Control de acceso.** Mejora sobre el `Code.gs` anterior:

- El código no se guarda en texto plano ni está escrito en el código fuente. Solo existe su hash SHA-256 con sal, guardado en Script Properties. Es un único código para el equipo, no uno por usuario.
- Solo el **propietario** de la hoja puede fijar el código la primera vez. El script anterior creaba y revelaba `PROSPR2025` a cualquiera que pulsara "Unlock".
- Al desbloquear se abre una sesión de 6 horas **por usuario y por hoja** (CacheService). Al terminar, el menú vuelve a bloquearse solo.
- Cada acción de administrador **vuelve a comprobar la sesión en el servidor**. Ocultar las opciones del menú es solo comodidad; la seguridad está en esa comprobación.
- Tras 5 intentos fallidos, el acceso queda bloqueado 15 minutos.
- `onOpen` vuelve a llamar a `ProsprScript.onOpen()`. El script anterior la había quitado y la plantilla perdía su menú estándar.

**Reporte.**

- La hoja se lee **por sus etiquetas, no por números de fila**. Una fila «Total X» cierra la categoría X, y «Total Income» separa ingresos de gastos. Si un cliente agrega o quita conceptos, el reporte sigue funcionando.
- Los totales de cada categoría son los subtotales que ya calcula la plantilla. El script no vuelve a sumar.
- Una categoría se marca cuando la desviación es **≥ 15 % y ≥ $50**. El mínimo en dólares evita ruido como "$5 vs $3 = 67 %". Los dos valores se cambian en `Config.gs`.
- **Conceptos responsables:** los que se desvían **en el mismo sentido** que la categoría y explican al menos el 10 % de la diferencia. Se muestran como máximo 3, de mayor a menor. Un concepto que gastó de menos no explica un exceso de gasto.
- Los ingresos usan su propio texto («below plan / above plan»), porque en ingresos tener más no es un problema.
- Las categorías con $0 planificado y $0 real no aparecen. Así el reporte queda compacto.

Ejemplo real con los datos de enero 2025 de la plantilla:

```
Food & Supplies is over budget by 21.5%.
- Grocery: $3,345.45 (Actual) vs $2,300.00 (Planned)
- Housekeeping Help: $707.00 (Actual) vs $500.00 (Planned)
```

**Salidas.**

- **Pestaña «Admin Report - Jan 2025».** Si se vuelve a generar el mismo mes, se reemplaza la pestaña en lugar de acumular copias.
- **Borrador de Gmail.** Pide el correo del cliente y recuerda el último usado en esa hoja. Nunca envía nada automáticamente: el consultor revisa el borrador y pulsa Enviar.

## Despliegue masivo (bonus)

La plantilla ya usa el patrón correcto: la lógica vive en la biblioteca maestra `ProsprScript` y cada hoja solo tiene wrappers de una línea. El despliegue sigue ese mismo patrón:

1. Los archivos de `src/`, excepto `Main.gs`, se agregan a la biblioteca maestra, y se añade `lynAdminBuildMenu()` al `onOpen` de `ProsprScript`. Después se **publica una versión nueva** de la biblioteca.
2. `Deployer.gs` se ejecuta desde una hoja de control que tiene una pestaña «Clients» con las URLs. Para cada cliente:
   - Comprueba que el archivo abre y que tiene «Monthly Budget».
   - **Si se conoce el ID del script vinculado:** lee su contenido, añade o reemplaza solo `LynAdmin.gs` (los wrappers), fija la versión de la biblioteca en el manifiesto y lo guarda. **No toca ningún otro archivo.**
   - **Si no se conoce:** crea un proyecto vinculado nuevo en la hoja con el manifiesto, los wrappers y un `onOpen` propio. Es un cambio aditivo: el proyecto que ya tiene el cliente no se modifica.
   - Escribe en la fila el estado, la versión y la fecha. Las filas que ya están en la versión objetivo se saltan, así que se puede volver a ejecutar sin riesgo.
   - Antes de llegar al límite de 6 minutos, se detiene y programa su propia continuación.
3. Los wrappers se generan desde la propia biblioteca (`lynClientStubSource`), así la lista de funciones públicas existe en un solo lugar.

Las **actualizaciones futuras** siguen el mismo camino: se publica la versión N+1 de la biblioteca, se cambia `targetVersion` y se vuelve a ejecutar el despliegue.

## Supuestos y limitaciones

- El reporte refleja el **mes seleccionado en `Monthly Budget`** (celdas F3/F2) y la vista «Current».
- La Apps Script API **no permite descubrir** el ID del script vinculado de una hoja a partir de la hoja. Por eso el despliegue acepta una columna con ese ID (lo ideal es que GrupoLyN lo registre al crear cada copia) y, si falta, crea un proyecto vinculado adicional.
- Requisitos del despliegue: la Apps Script API activada en la cuenta, un proyecto de Google Cloud estándar con esa API habilitada y permiso de edición sobre las hojas de los clientes. Aplican las cuotas diarias de la Apps Script API.
- **Qué está probado y qué no:**
  - Probado: la lógica pura (lectura de la hoja, reglas, textos, HTML del correo y generación de wrappers), con los datos reales de enero, mediante `node --test tests/`.
  - Probado en la hoja real: el menú, el diálogo, la pestaña y el borrador.
  - **No probado:** el despliegue masivo contra copias reales, porque requiere acceso a la biblioteca maestra y a las copias de los clientes.
