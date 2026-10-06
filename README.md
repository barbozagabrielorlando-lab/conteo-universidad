# Conteo Universidad
Aplicación independiente para una estimación interna de votos universitarios a partir del consumo de boletas. **No representa el escrutinio oficial.** Proyecto nuevo: no utiliza archivos, usuarios, configuración, datos ni infraestructura de la maratón.

## Estado del despliegue · 6 de octubre de 2026
- Aplicación publicada: https://barbozagabrielorlando-lab.github.io/conteo-universidad/
- Supabase independiente: fmzjdlmluloonbcjmweq. Migración instalada, cinco tablas con RLS verificadas. No volver a ejecutar la migración inicial en este proyecto.
- Registro público deshabilitado; Site URL y variables de GitHub configuradas.
- Pendiente: contraseña personal del primer administrador, habilitar su perfil, definir mesas reales y asignaciones.
- Probar Auth y Realtime con usuarios reales antes de la jornada.

## Qué incluye
- Acceso por correo y contraseña Supabase; cuentas habilitadas explícitamente por administración.
- Fiscal: mesas asignadas, botones grandes 0–5, cálculo 5-restantes, confirmación de mesa y reposición hasta cinco.
- Cada control conserva fiscal, mesa, restantes, votos calculados en PostgreSQL, hora del servidor y estado.
- Envíos idempotentes con UUID persistido hasta confirmar el resultado; doble clic bloqueado. La mesa se bloquea transaccionalmente y rechaza cargas separadas por menos de 30 segundos.
- Corrección propia durante 15 minutos; administrador sin límite de tiempo. Motivo obligatorio. Original marcado corregido/anulado, reemplazo enlazado y auditoría conservados.
- Dashboard protegido por rol, totales por mesa, reportadas/sin reportar, último control, evolución y ritmo por hora. Realtime y respaldo de actualización cada 20 segundos.
- Historial propio para fiscales, completo para admins. Gatitos discretos, interfaz responsive.
- Sin servidor propio. Vite + TypeScript + Supabase Auth/PostgreSQL/Realtime + GitHub Pages.
- Sin configurar Supabase: demostración explícita, ficticia y solo en memoria. Nunca recibe controles reales.

## Inicio local
Requiere Node 22.12+ y npm.
```powershell
npm ci
Copy-Item .env.example .env
# Completar SOLO los datos del proyecto Supabase nuevo
npm run dev
```
Abrir la dirección que muestra Vite. Para explorar datos ficticios, dejar las variables sin configurar y pulsar “Explorar demostración”.
```
npm test
npm run build
npm run preview
```

## Crear Supabase separado (intervención del titular)
1. Iniciar sesión en Supabase y crear un **proyecto NUEVO**, por ejemplo conteo-universidad. Verificar su referencia: nunca usar la del proyecto de la maratón.
2. En SQL Editor del nuevo proyecto ejecutar una sola vez `supabase/migrations/001_initial.sql`. No ejecutar en una base existente. La transacción evita instalación parcial.
3. En Authentication deshabilitar registro público. Crear usuarios manualmente con correo y contraseña o invitaciones. Para el MVP se recomienda crear usuarios con contraseña temporal y comunicarla por un canal privado; el flujo de recuperación por email debe configurarse antes de habilitarlo.
4. Los nuevos usuarios quedan como fiscal **inactivo**. El rol se toma de la tabla profiles, nunca de metadatos modificables por el usuario.
5. Crear mesas reales, habilitar perfiles y asignar mesas mediante SQL del siguiente apartado. No cargar mesas de ejemplo en una elección real.
6. En Authentication URL Configuration poner Site URL `https://TU-USUARIO.github.io/conteo-universidad/` y la URL local `http://127.0.0.1:5173/` como redirect permitido.
7. Obtener Project URL y la clave **publishable** (o anon legacy). Completar `.env`. Nunca usar service_role, secret key ni contraseña PostgreSQL en frontend, GitHub o este chat.
8. La migración incorpora tablas a supabase_realtime. Verificar que Realtime esté habilitado y probar con dos sesiones reales.
9. Antes de la elección, probar el protocolo completo con datos de ensayo en este proyecto nuevo y luego iniciar la jornada en una base limpia; no borrar datos de una jornada ya iniciada.

### Mesas, usuarios y asignaciones
En SQL Editor, reemplazar UUID por los IDs de Authentication > Users:
```sql
-- Elegir el número y nombre de las mesas reales:
insert into public.electoral_tables(id,label) values (25,'025'),(26,'026');
-- Primer administrador:
update public.profiles set display_name='Administración',role='admin',active=true
where id='UUID-ADMIN';
-- Fiscal:
update public.profiles set display_name='Nombre del fiscal',active=true
where id='UUID-FISCAL';
insert into public.assignments(user_id,table_id) values ('UUID-FISCAL',25);
-- Deshabilitar usuario / cerrar mesa:
update public.profiles set active=false where id='UUID-FISCAL';
update public.electoral_tables set active=false where id=25;
```
Por ahora la gestión de usuarios y mesas se realiza desde Supabase, no desde la interfaz. Evitar cambios directos en controls/audit_log: usar las funciones de corrección.

## GitHub y Pages independientes
Repositorio independiente creado: [barbozagabrielorlando-lab/conteo-universidad](https://github.com/barbozagabrielorlando-lab/conteo-universidad). El código se guarda desde la interfaz de GitHub porque el entorno local bloquea la escritura de metadatos Git.

Para obtener una copia local versionada en una carpeta nueva:
```
git clone https://github.com/barbozagabrielorlando-lab/conteo-universidad.git
cd conteo-universidad
npm ci
```

1. Settings > Secrets and variables > Actions > Variables: agregar `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` del proyecto Supabase nuevo. Ambas son públicas; su seguridad depende de RLS, roles y funciones.
2. Settings > Pages > Source: GitHub Actions. El workflow prueba, compila y publica. Falla si faltan las variables: nunca publica una demo accidentalmente.
3. El sitio usa base `/conteo-universidad/` y no requiere rutas del servidor. Si cambia el nombre del repositorio, ajustar vite.config.mjs.
4. GitHub Pages sirve los archivos públicamente; los **datos y operaciones** permanecen protegidos por Supabase.
5. Probar usuarios reales fiscal/admin y sesión anónima antes de utilizarlo en una jornada real.

## Modelo y confiabilidad
- `controls`: fuente de verdad. `votes` es columna generada, no un valor aceptado del navegador.
- `audit_log`: creación, actor, motivo y referencia al reemplazo.
- `profiles` / `assignments`: roles y autorización de mesas.
- Totales calculados a partir de controles vigentes mediante RPC, sin acumulador mutable que pueda perder incrementos concurrentes.
- `submit_control` y `revise_control` ejecutan transacciones, validan auth.uid(), toman bloqueos y fijan search_path vacío.
- El cliente authenticated tiene SELECT bajo RLS y EXECUTE específico; sin INSERT/UPDATE/DELETE directos. Anónimos sin acceso.
- Un total de 0 puede pertenecer a una mesa reportada con cinco boletas restantes. “Sin reportar” significa ningún control, incluso si se anularon todos.
- Correcciones reemplazan el registro: la curva reconstruye controles vigentes usando la hora del reemplazo. No es una gráfica histórica del total que el dashboard mostraba antes de cada corrección.
- Sin conexión: no se confirma ni se simula un registro exitoso. Un envío incierto conserva su UUID local y se reintenta igual; logout no lo borra. Usar el mismo dispositivo para recuperarlo. No es una cola offline automática.
- Una actualización fallida muestra aviso; los valores anteriores no deben interpretarse como recién sincronizados.
- No hay eliminación de registros desde la aplicación. Operadores con acceso SQL elevado siguen pudiendo modificar la base: restringir ese acceso y conservar respaldos.
- 30 s por mesa y 15 min para correcciones son reglas iniciales; cambiar solo con acuerdo operativo.
- Múltiples jornadas no están modeladas en este MVP. Usar un proyecto separado por jornada o añadir election_id antes de reutilizarlo.
- Carga completa paginada para el MVP. Si crece a decenas de miles de controles, agregar consultas agregadas por período/paginación visible del historial.
- Fuentes tipográficas con fallback local. No se necesita esa conexión para registrar.
- No incluye resultados oficiales, padrón, boletas de otras agrupaciones ni identificación de votantes.

## Validación
Pruebas PostgreSQL embebido (PGlite): cálculo completo, 7 votos del ejemplo, idempotencia, permisos RLS, bloqueo de escritura directa, mesas asignadas/cerradas, ventana de corrección, auditoría, anulación, usuario inactivo y anónimo.
Estas pruebas ejecutan la migración real con un esquema de Auth simulado; no sustituyen la validación de Auth y Realtime en Supabase real.
Consultar `docs/VALIDACION.md` para resultados y prueba manual previa a la elección.

Documentación de referencia: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [funciones](https://supabase.com/docs/guides/database/functions), [GitHub Pages con Vite](https://vite.dev/guide/static-deploy.html).
