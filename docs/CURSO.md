# UPAU: Conteo electoral y Curso

Actualización del 30/10/2026. La migración de Curso se instaló en el proyecto existente, después de un respaldo lógico y una prueba de restauración de las tablas electorales en una copia aislada. La interfaz se publica mediante el workflow de GitHub Pages, que exige pruebas SQL y de navegador antes del despliegue.

## Uso previsto

Después del ingreso con la cuenta del operador, UPAU ofrece dos tarjetas: Conteo electoral y Curso. Cada acceso depende de sus propios permisos.

En Curso, agregar nombre y apellido del participante; DNI y teléfono son opcionales. El DNI evita duplicaciones cuando se informa. Los participantes no son cuentas de Auth y no necesitan contraseña. Las personas sin DNI no tienen deduplicación automática por nombre: revisar mediante el buscador antes del alta.

La lista permanece en PostgreSQL y se reutiliza cada día. Elegir la fecha, pulsar “Marcar presente” y esperar la confirmación. “✓ Presente” permite quitar una marca equivocada. La operación modifica únicamente la fecha seleccionada. Una persona sin marca no está confirmada como presente; no se registra automáticamente una ausencia. La fecha inicial usa horario argentino y no se aceptan fechas futuras.

Se puede consultar o corregir un día anterior y editar los datos de una persona sin modificar sus asistencias. Todos los operadores habilitados del curso comparten acceso a la lista y a las asistencias; no hay comisiones separadas en esta primera versión. La lista muestra 30 personas por página y busca nombre, apellido o DNI en servidor.

## Archivos y seguridad

### Exportar asistencia a Excel

En Curso, pulsar **Exportar a Excel**. El formulario permite editar curso, lugar, horario y de 1 a 31 fechas de clase. Propone de lunes a viernes de la semana de la fecha seleccionada, y permite agregar o quitar fechas. Las columnas se ordenan cronológicamente. Las preferencias de curso/lugar/horario se recuerdan solo en ese navegador para el operador actual.

La descarga es un archivo `.xlsx` con título “Planilla de Asistencia”, datos del curso, número de fila, nombre y apellido, teléfono y una columna por clase. “P” indica asistencia confirmada; las celdas vacías no declaran ausencia. Incluye al menos 30 filas, o todas las necesarias. Los teléfonos se guardan como texto. Las fechas son valores de fecha de Excel. Está preparado para impresión en A4 con encabezados repetidos.

Se exportan todos los participantes autorizados, sin limitarse al buscador ni a la página visible, y solo las asistencias de las fechas elegidas. Las consultas usan la sesión y RLS existentes; se vuelve a comprobar la habilitación del operador antes de descargar. Un error interrumpe la descarga en lugar de generar una lista parcial. La generación ocurre en el navegador y no transmite la planilla a servicios externos. No se modifica ninguna tabla ni política.

- `src/curso.ts`: pantalla y operaciones del curso.
- `src/main.ts`: selector de módulos y sesión; conserva el flujo electoral.
- `supabase/migrations/004_curso.sql`: tablas y RPC nuevas. No modifica tablas, perfiles ni funciones electorales.
- `curso_operadores`: permisos del equipo, independientes del rol electoral.
- `curso_participantes`: lista permanente.
- `curso_asistencias`: clave única participante/fecha; se guarda el estado, actor y hora.
- `curso_auditoria`: altas, ediciones y cambios de asistencia con actor y fecha. Para asistencia incluye estado anterior/nuevo. No guarda una copia completa de los datos personales antes de cada edición.

RLS deniega acceso a no habilitados. Las escrituras pasan por funciones que validan al operador. Un administrador electoral no obtiene permiso de curso automáticamente, ni un administrador del curso obtiene facultades electorales. Los operadores no pueden alterar sus roles ni escribir directamente las tablas. La auditoría puede consultarla un administrador del curso en Supabase; no se agregó una pantalla de auditoría.

Las altas se reintentan con el mismo UUID desde el formulario abierto; las ediciones detectan versiones antiguas. Si una asistencia falla, no se muestra un éxito y se pide actualizar antes de volver a marcar. No hay una cola offline. Si se pierde la respuesta de un alta y se cierra el formulario, buscar primero la persona antes de volver a agregarla, especialmente cuando no tiene DNI.

## Instalación en otros entornos y administración

1. Seguir el procedimiento de respaldo y recuperación del informe técnico. La copia del código NO contiene la base de datos ni archivos de Storage. Verificar la restauración en un entorno aislado antes de alterar producción.
2. Verificar que las migraciones electorales 001–003 ya están aplicadas. NO volver a ejecutarlas sobre la base existente.
3. Probar `004_curso.sql` primero en un entorno aislado con el esquema original. Revisar el plan de despliegue y conservar métricas de integridad antes/después.
4. Solo tras aprobación, aplicar la migración 004 una vez al proyecto correcto. No incluye datos de ejemplo ni habilita usuarios automáticamente.
5. Habilitar explícitamente las cuentas que tomarán asistencia. Usar el UUID de una cuenta real de Supabase Auth; no el DNI de un participante. Plantilla para revisar y completar:

```sql
-- No ejecutar con el marcador sin reemplazar. Concede acceso a todos los datos del curso.
insert into public.curso_operadores(user_id,display_name,role,active)
values ('UUID-DE-LA-CUENTA-AUTH','Nombre del operador','operador',true);
```

Para un administrador del curso, el rol es `admin`. No cambiar `public.profiles` para habilitar el curso. Las cuentas se crean por el procedimiento existente de Supabase Auth; no se incorporó creación de cuentas de operadores desde la web.

6. Configurar solo `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` públicas. Nunca usar claves administrativas en el navegador. Las credenciales reales no están incluidas en esta entrega.
7. Probar con cuentas reales de curso, electoral, inactiva y anónima. Confirmar lista y asistencias después de cerrar sesión y desde otro dispositivo; confirmar que el acceso denegado también se cumple por API.
8. Revisar en computadora y celular, verificar correo/Auth/Realtime electoral y publicar únicamente con autorización. El workflow de GitHub Pages publica ante push a `main`.

Si la tabla de operadores del curso todavía no existe o no se puede consultar, la portada indica que el curso no está disponible y el acceso electoral mantiene sus reglas.

## Ejecución y comprobaciones

En una terminal con Node y npm: `npm ci`, `npm test`, `npm run build`. Para vista local: `npm run dev`. Sin `.env` aparece “Explorar demostración”. Esa demostración conserva participantes/asistencias ficticias únicamente en el navegador, bajo `upau-demo-curso-v1`; no debe usarse para datos reales.

Se ejecutaron correctamente TypeScript, compilación Vite y 18 pruebas de Vitest/PGlite. Las 11 pruebas electorales existentes siguen pasando; las siete nuevas cubren permisos independientes, persistencia de registros, DNI duplicado, asistencia por fecha, reintentos, corrección, edición concurrente, revocación y conservación de las cinco tablas y funciones electorales. También se restauró una copia lógica de las cinco tablas electorales reales en un entorno local aislado y se compararon sus registros antes y después de probar la migración nueva, sin diferencias. El respaldo incluye datos de Auth, pero esta prueba local usa Auth simulado: no certifica una recuperación integral del servicio y su configuración externa.

PGlite usa Auth simulado y no reemplaza Supabase real. La instalación aditiva en el servidor real se autorizó explícitamente; la línea de base y las comprobaciones de integridad se conservan en documentación privada, fuera del repositorio público.

La prueba nueva `tests/curso-ui-smoke.mjs` recorre selector, alta, fechas, recarga, duplicados, edición, móvil y regresión electoral. Para ejecutarla localmente, levantar el servidor de demostración sin variables Supabase en el puerto 4173 (`node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort --configLoader native`) y ejecutar `node tests/curso-ui-smoke.mjs`. Usa Edge localmente y Chromium en CI. Solo usa datos ficticios. El workflow instala Chromium y ejecuta este recorrido antes de publicar; si falla, no despliega. Las capturas son opcionales con `CONTEO_SCREENSHOTS`. En CI, `CONTEO_URL` contempla la base `/conteo-universidad/`. Los scripts anteriores `ui-smoke.mjs` y `recovery-smoke.mjs` corresponden a un flujo electoral anterior, como se documenta en el diagnóstico.

## Recuperación

Para retirar la nueva interfaz, volver al código original conservado, sin borrar tablas del curso ni electorales. La restauración de una base completa requiere conciliación de datos posteriores al respaldo; no sobrescribir producción automáticamente. El módulo electoral no se traslada ni se eliminan sus funciones.
