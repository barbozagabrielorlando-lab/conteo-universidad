# Validación del MVP · 6 de octubre de 2026

Proyecto construido exclusivamente en:
`C:\Users\orlan\OneDrive\Escritorio\Cosas\Trabajo\UPAU\conteo-universidad`

## Resultados
- TypeScript y compilación Vite: correctos.
- 9 pruebas automáticas PostgreSQL embebido: correctas. Se ejecutó la migración SQL real, sustituyendo únicamente Auth y la publicación Realtime por infraestructura local de prueba.
- Auditoría de dependencias completa: 0 vulnerabilidades reportadas.
- Navegador Edge, escritorio 1440 px y móvil 390 px: circuito de confirmación, registro, corrección y anulación correcto.
- Sin desborde horizontal de página en carga y dashboard; botones de cantidad de al menos 48 × 48 px.
- Sin errores de ejecución en navegador.
- Integración con API Supabase simulada: acceso fiscal, panel admin no disponible, servidor confirma un control pero se pierde la respuesta, recarga de página y reintento con el mismo UUID. Resultado: un solo control de +2, sin duplicación y pendiente local eliminado al verificarlo.
- Revisión visual de capturas de carga móvil y dashboard de escritorio.

## Lo pendiente
Repositorio remoto independiente creado: https://github.com/barbozagabrielorlando-lab/conteo-universidad. El código se guarda mediante la interfaz de GitHub.
El repositorio local está inicializado sin commits: este entorno rechazó crear .git/index.lock aun con el permiso concedido. Para una copia local con historial, clonar el remoto en una carpeta nueva desde una terminal propia. El ZIP contiene el código y no los metadatos Git.
El formulario Supabase nuevo está preparado con nombre conteo-universidad. Su creación requiere que el titular defina la contraseña de la base personalmente. Proyecto real y despliegue público pendientes.
No se verificó Auth, correo ni Realtime contra Supabase real. No usar la demostración como sistema de una elección real.

## Prueba previa a la elección (Supabase nuevo)
1. Crear administrador y dos fiscales, asignados a mesas distintas. Desactivar registro público.
2. Como anónimo comprobar que el enlace no muestra datos reales.
3. Fiscal A: cinco restantes suma 0 y marca mesa reportada; tres restantes suma 2. Reposición y confirmación obligatorias.
4. Después de 30 s, cargar otro control: acumulado igual a la suma de vigentes.
5. Fiscal B no puede ver controles de A ni cargar en una mesa no asignada (comprobar también mediante API).
6. Dos cargas simultáneas en mesas diferentes se registran; en la misma mesa la protección de 30 s rechaza la segunda.
7. Reenviar exactamente un request_id: misma fila y mismo total. Cambiar cantidad con ese UUID: rechazado.
8. Corregir con motivo: original corregido, reemplazo vigente y auditoría visible. Anular: total recalculado, original conservado.
9. A los 15 min el fiscal pierde permiso de corrección; administrador puede corregir/anular. Desactivar fiscal: no puede enviar.
10. Con dashboard admin y fiscales en navegadores separados, comprobar actualización Realtime. Cortar WebSocket: actualización periódica de respaldo. Cortar internet: aviso y ningún éxito falso.
11. Simular conexión perdida después de enviar, recargar y verificar/reintentar: no se duplica.
12. Comprobar móvil real, legibilidad, sesión y horario de Argentina.
13. Restringir administradores SQL y acordar respaldo/restauración antes de comenzar.

## Repetir verificaciones locales
```
npm ci
npm test
npm run build
npm run preview
node tests/ui-smoke.mjs
```
Las pruebas de navegador requieren Edge instalado. La prueba de recuperación necesita compilar con las variables ficticias indicadas:
```powershell
$env:VITE_SUPABASE_URL='https://conteo-test.supabase.co'
$env:VITE_SUPABASE_PUBLISHABLE_KEY='test-public-key-not-a-real-secret'
npm run build
node tests/recovery-smoke.mjs
Remove-Item Env:VITE_SUPABASE_URL
Remove-Item Env:VITE_SUPABASE_PUBLISHABLE_KEY
npm run build
```
No usar esas variables en GitHub. Las capturas automáticas se guardan solamente si CONTEO_SCREENSHOTS apunta a una carpeta.
