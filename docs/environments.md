# Entornos: staging y producción

Guía paso a paso para la persona dueña del proyecto. No hace falta saber programar. Las secciones marcadas **Solo la persona dueña** se hacen en los paneles de Supabase y Vercel con tu propia cuenta; ninguna herramienta ni agente automático puede hacerlas por ti.

**Regla de oro: ningún secreto se guarda en el repositorio.** Las claves y contraseñas solo se escriben en los paneles de Vercel y Supabase (o en tu propia terminal). Nunca en un archivo que se suba a GitHub. El archivo `.env.example` solo trae nombres con valores de ejemplo.

## Resumen

| | Staging (pruebas) | Producción (clientes reales) |
|---|---|---|
| Supabase | Proyecto `accionahn-staging` | Proyecto `accionahn-production` |
| Vercel | Entorno Preview | Entorno Production |
| `APP_ENV` | `staging` | `production` |
| Dominio | `app.staging.accionahn.com` y `*.staging.accionahn.com` | `app.accionahn.com` y `*.accionahn.com` |

Se usan dos proyectos de Supabase separados para que una prueba nunca toque datos de clientes.

## 1. Crear los dos proyectos de Supabase (Solo la persona dueña)

1. Entra a https://supabase.com/dashboard e inicia sesión.
2. Pulsa **New project**. Nombre `accionahn-staging`, elige una región cercana (por ejemplo East US) y guarda la contraseña de la base de datos en tu gestor de contraseñas.
3. Repite para `accionahn-production`.
4. En cada proyecto, ve a **Project Settings > API** y copia: la **Project URL**, la clave **anon** y la clave **service_role**. Trata la `service_role` como una contraseña maestra: nunca la pegues en chats ni en archivos del repositorio.
5. Las tablas se crean aplicando las migraciones de la carpeta `supabase/migrations`. Desde una terminal con el proyecto abierto:
   - `pnpm exec supabase login`
   - `pnpm exec supabase link --project-ref <ref-del-proyecto>`
   - `pnpm exec supabase db push`

   Hazlo primero en staging, revisa, y luego en producción. Las migraciones solo agregan; la revisión automática `pnpm check:migrations` rechaza las que borran o renombran datos.

## 2. Los dos entornos de Vercel (Solo la persona dueña)

1. Entra a https://vercel.com, abre el proyecto de Accionahn (o impórtalo desde GitHub con **Add New > Project**).
2. Production: usa la rama `main`. Preview (staging): la rama `staging` (créala en GitHub si no existe); los demás pull requests también generan Previews, pero el dominio de staging se asigna a la rama `staging`.
3. Ve a **Settings > Environment Variables** y carga las variables de la sección 4. Al crear cada una, marca solo el entorno que corresponde (Production o Preview), de modo que Preview apunte al Supabase de staging y Production al de producción.

## 3. Dominios (Solo la persona dueña)

Los clientes viven en subdominios: `spezia.accionahn.com`, `otro.accionahn.com`, etc. El panel de la agencia vive en `app.accionahn.com`.

0. **Antes de tocar nada**: entra al registrador donde compraste `accionahn.com` y copia (captura de pantalla o texto) TODOS los registros DNS que ya existen, sobre todo los de correo (MX y TXT). Si cambias los nameservers sin recrear esos registros en Vercel, el correo del dominio deja de funcionar.
1. En Vercel: **Settings > Domains**. Agrega `app.accionahn.com` y `*.accionahn.com` y asígnalos a Production. Agrega también `app.staging.accionahn.com` y `*.staging.accionahn.com` y asígnalos a la rama `staging` (Preview).
2. Vercel mostrará los registros DNS que debes crear. Para un comodín (`*`) normalmente Vercel pide usar sus servidores de nombres (`ns1.vercel-dns.com` y `ns2.vercel-dns.com`) en el registrador donde compraste `accionahn.com`. Cambia los nameservers allí y espera a que Vercel marque el dominio como verificado (puede tardar de minutos a unas horas).
3. Vercel emite el certificado HTTPS del comodín por su cuenta una vez verificado.
4. Staging usa su propio comodín bajo tu dominio (`*.staging.accionahn.com`), porque cada cliente se reconoce por su subdominio y las direcciones `*.vercel.app` no permiten subdominios por cliente. Los clientes de staging se verán como `spezia.staging.accionahn.com`.

## 4. Variables de entorno por entorno (solo nombres)

Se cargan en Vercel (sección 2) y nunca se escriben en el repositorio.

| Variable | Preview (staging) | Production |
|---|---|---|
| `APP_ENV` | `staging` | `production` |
| `ROOT_DOMAIN` | `staging.accionahn.com` | `accionahn.com` |
| `SUPABASE_URL` | URL del proyecto staging | URL del proyecto producción |
| `SUPABASE_ANON_KEY` | clave anon de staging | clave anon de producción |
| `SUPABASE_SERVICE_ROLE_KEY` | clave service_role de staging | clave service_role de producción |
| `CRON_SECRET` | secreto propio de staging | secreto propio de producción |

`CRON_SECRET` es obligatorio en staging y producción (sin él, o con menos de 32 caracteres, la tarea programada no corre: la ruta responde 503 y deja un error en los registros; el resto de la aplicación sigue funcionando): genera uno distinto por entorno, de 32 caracteres o más (por ejemplo con un gestor de contraseñas). Vercel lo envía solo a `/api/cron/expire-orders`, la tarea que cada 15 minutos vence los pedidos sin anticipo y libera existencias y horarios (`vercel.json`). En local es opcional; sin él la ruta responde 401. Ojo: en el plan gratuito (Hobby) de Vercel las tareas programadas solo pueden correr una vez al día; cada 15 minutos requiere el plan Pro.

Para desarrollo local, copia `.env.example` a `.env.local` (este archivo está ignorado por git) y usa las claves que imprime `supabase start`.

### Almacenamiento de comprobantes (staging y producción)

Supabase Storage no corre en local, así que se crea y se prueba a mano en cada proyecto:

1. En Supabase: **Storage > New bucket**, nombre `order-proofs`, **privado** (sin acceso público), límite de 5 MB, tipos permitidos `image/jpeg, image/png, image/webp, application/pdf`.
2. No agregues políticas para `anon` ni `authenticated`: la aplicación sube y firma enlaces con la clave service_role, y cada archivo queda en `<tenant_id>/<order_id>/<uuid>`.
3. Prueba en staging: haz un pedido con anticipo, sube un comprobante desde el enlace del pedido y comprueba que aparece en el bucket y que el panel lo abre con un enlace firmado.

(El bucket privado de comprobantes se llama `order-proofs` en el código, `ORDER_PROOFS_BUCKET`; en algunos documentos del plan aparece como "payment-proofs": es el mismo.)

### Logos e imágenes de las tiendas (staging y producción)

El logo que el dueño sube en **Panel > Apariencia** se guarda en un bucket **público**, porque la tienda lo muestra a cualquier visitante:

1. En Supabase: **Storage > New bucket**, nombre `tenant-assets`, marca **Public bucket**, límite de 1 MB, tipos permitidos `image/png, image/jpeg, image/webp` (sin SVG: puede llevar código).
2. No agregues políticas de escritura para `anon` ni `authenticated`: la aplicación sube con la clave service_role después de comprobar la sesión del dueño. Cada archivo queda en `<tenant_id>/logo-<uuid>.<png|jpg|webp>`.
3. La tienda solo muestra imágenes (logo y fotos de productos) que estén bajo la carpeta de su propia tienda en este bucket: una ruta `<tenant_id>/...` o una URL `https://<proyecto>.supabase.co/storage/v1/object/public/tenant-assets/<tenant_id>/...` del mismo proyecto (`SUPABASE_URL`). Cualquier otra dirección de imagen no se muestra.
4. Prueba en staging (a mano, Storage no corre en local):
   - Entra al panel de una tienda de prueba, abre **Apariencia**, sube un PNG de menos de 1 MB y guarda. Comprueba que aparece `tenant-assets/<tenant_id>/logo-<uuid>.png` en el bucket y que el encabezado de la tienda muestra el logo (texto alternativo: el nombre de la tienda).
   - Intenta subir un SVG y un archivo de más de 1 MB: ambos deben dar error y no crear archivos.
   - Cambia el texto a un color claro sobre fondo claro: debe dar error de contraste y no guardar.
   - Abre la URL pública del logo en el navegador sin sesión: debe verse (bucket público).

### Invitación del dueño y acceso al panel (staging y producción, Solo la persona dueña)

El administrador de la agencia invita al dueño de una tienda **activa** desde **Panel de agencia > Invitar al dueño** (página de la tienda). Supabase le envía un correo; el enlace abre `https://<subdominio>/auth/callback` en la tienda, donde el dueño crea su contraseña y entra a `/panel`. Después entra con correo y contraseña en `https://<subdominio>/login`. La agencia entra en `https://app.<dominio>/login`.

En cada proyecto de Supabase (staging y producción):

1. **Correo (SMTP)**: **Authentication > Emails > SMTP Settings**, activa un SMTP propio (por ejemplo el de tu proveedor de correo). Sin SMTP propio Supabase solo envía unos pocos correos por hora y únicamente a miembros del equipo del proyecto, así que las invitaciones a clientes no llegarían.
2. **Plantilla de invitación**: **Authentication > Emails > Templates > Invite user**. Reemplaza el enlace del cuerpo por `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite` (puedes copiar el texto de `supabase/templates/invite.html`). Con la plantilla original el enlace no funciona. Haz lo mismo en **Reset password** con `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery` (texto en `supabase/templates/recovery.html`) para que el cambio de contraseña por correo también funcione.
3. **Direcciones permitidas**: **Authentication > URL Configuration > Redirect URLs**, agrega `https://*.staging.accionahn.com/auth/callback` en staging y `https://*.accionahn.com/auth/callback` en producción. Si falta, el enlace del correo apunta a la *Site URL* y el dueño ve un error.
4. **Registro abierto (obligatorio)**: en **Authentication > Sign In / Providers**, desactiva *Allow new users to sign up*. La aplicación no tiene registro público: los dueños entran solo por invitación y los administradores se crean como indica la sección 5. Las invitaciones siguen funcionando con el registro apagado. Así nadie puede crear por su cuenta una cuenta con el correo de un dueño antes de que lo invites (si aun así existiera una cuenta sin confirmar que no vino de una invitación, la aplicación la borra al invitar y crea una nueva). En local ya está apagado en `supabase/config.toml` (`enable_signup = false`).
5. **Cambio de contraseña**: la página para crear la contraseña solo funciona durante 15 minutos después de abrir el enlace del correo; pasado ese tiempo hay que pedir una invitación nueva.
6. Los intentos de inicio de sesión los limita Supabase Auth por IP (**Authentication > Rate Limits**); la aplicación no lleva su propio contador.

En local no hace falta SMTP: los correos quedan en el buzón de prueba del Supabase local (Inbucket/Mailpit), en http://127.0.0.1:54324 (si arrancas Supabase con `-x` como en CI, no excluyas `mailpit`). La plantilla y las direcciones permitidas locales (`http://*.accionahn.com:3000/auth/callback` y, con `ROOT_DOMAIN=localhost`, `http://*.localhost:3000/auth/callback`, que no necesita tocar el archivo hosts) ya están en `supabase/config.toml`; tras cambiarlos hay que reiniciar con `pnpm exec supabase stop` y `pnpm exec supabase start`.

## 5. Crear el primer administrador de la agencia

Hay dos caminos. En local y staging se usa el script de semilla, que además crea al cliente piloto Spezia; corre únicamente con `APP_ENV` en `local` o `staging` y en producción se niega a ejecutarse. En producción el administrador se crea a mano (paso 4).

1. Elige un correo y una contraseña fuerte (12 caracteres o más) para el administrador. Se pasan solo como variables de la terminal donde ejecutas el script, nunca en un archivo (el script no lee `.env.local`). Define cada variable en esa misma terminal, antes de ejecutar el script.
   - PowerShell (Windows): `$env:SEED_ADMIN_EMAIL='<correo>'` y `$env:SEED_ADMIN_PASSWORD='<contraseña>'`
   - bash (Mac/Linux/Git Bash): `export SEED_ADMIN_EMAIL='<correo>'` y `export SEED_ADMIN_PASSWORD='<contraseña>'`
   - Define de la misma forma `APP_ENV`, `ROOT_DOMAIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. Para staging: `APP_ENV` = `staging`, `ROOT_DOMAIN` = `staging.accionahn.com`, las claves del proyecto staging y, además, `SEED_CONFIRM_URL` con exactamente la misma URL que `SUPABASE_URL` (confirmación de que apuntas al proyecto correcto).
2. Ejecuta `pnpm seed:spezia`.
3. El script crea el cliente `spezia` (cohorte `pilot`, moneda base HNL, USD a tasa 25, dominio `spezia.<ROOT_DOMAIN>`; en staging será `spezia.staging.accionahn.com`) y el administrador. Volver a ejecutarlo no duplica nada.
   Además carga un **catálogo de ejemplo** para que la tienda se pueda probar de punta a punta: la taqueada (por persona, 3 carnes, 8 complementos, preparación 60 min y servicio 120 min, anticipo del 50 %), dos frascos de encurtidos con variantes y existencias, zonas de envío, dos recargos por fecha, envío "por aprobación", horario de 08:00 a 20:00 todos los días y datos de transferencia. **Todos esos valores son de ejemplo y llevan la palabra `EJEMPLO`** (en nombres, zonas, recargos, datos de transferencia y en el subtítulo de la tienda): no son los precios ni la cuenta reales de Spezia. El script solo crea lo que falta; si el dueño ya cambió algo (ajustes, horario, un producto, una zona), volver a ejecutarlo no lo pisa.
4. Para el administrador de **producción**, el script no se usa: créalo a mano en el panel de Supabase del proyecto de producción (**Authentication > Users > Add user**, con *Auto Confirm User*) y luego, en **SQL Editor**, ejecuta `insert into public.agency_admins (user_id) select id from auth.users where email = '<correo>';`. Hazlo tú; no compartas la contraseña con nadie.
5. Cambia el número de alerta del dueño de Spezia: el script usa uno falso (`+50400000000`). Por ahora el panel de la agencia no tiene un editor de ajustes para una tienda ya activa (llega en un plan posterior), así que el cambio se hace en el **SQL Editor** de Supabase del proyecto que corresponda. Reemplaza `<telefono-e164>` por el número real en formato E.164 (por ejemplo `+504` seguido de 8 dígitos) y `<slug>` por el subdominio de la tienda (`spezia`):

   ```sql
   update public.tenants
   set settings = jsonb_set(settings, '{ownerAlertPhone}', to_jsonb('<telefono-e164>'::text))
   where slug = '<slug>';
   ```

   Debe decir `UPDATE 1`. Esto cambia solo el número de alerta; el resto de los ajustes de la tienda queda igual.

## 6. Lista de verificación de staging (tienda)

Antes de abrir la tienda de Spezia a clientes reales, en el proyecto de **staging** y después en el de producción:

1. **Buckets de Storage** (sección 4):
   - `tenant-assets`: **público**, 1 MB, tipos `image/png, image/jpeg, image/webp` (sin SVG).
   - `order-proofs`: **privado**, 5 MB, tipos `image/jpeg, image/png, image/webp, application/pdf`. En el plan aparece como "payment-proofs"; en el código se llama `order-proofs` (`ORDER_PROOFS_BUCKET`) y ese es el nombre que hay que usar.
2. **`CRON_SECRET`** en Vercel (Preview y Production, uno distinto en cada uno, 32 caracteres o más). La tarea de vencimiento corre cada 15 minutos, y eso **requiere el plan Pro de Vercel** (en Hobby solo corre una vez al día y los pedidos sin anticipo tardarían hasta un día en liberarse). Comprueba en **Vercel > Settings > Cron Jobs** que aparece `/api/cron/expire-orders` y, tras 15 minutos, que su última ejecución respondió 200.
3. **Correo y acceso** (sección 4, "Invitación del dueño"): SMTP propio, plantilla de invitación con `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite`, la dirección `https://*.<dominio>/auth/callback` en **Redirect URLs** y *Allow new users to sign up* **apagado**. Prueba una invitación real: el correo llega y, al abrir el enlace, la barra de direcciones debe quedar en `https://<subdominio de la tienda>/auth/set-password?next=%2Fpanel` (por ejemplo `https://spezia.staging.accionahn.com/auth/set-password?next=%2Fpanel`), nunca en otro dominio; ahí se crea la contraseña y se entra a `/panel`. Haz la misma prueba con un correo de cambio de contraseña (*Reset password*): debe llegar a la misma página de la tienda. Abre el mismo enlace otra vez: debe mostrar "El enlace no es válido o ya venció".
4. **Tipo de los archivos guardados**: sube un logo PNG en **Panel > Apariencia** y abre su URL pública. En las herramientas del navegador (pestaña Red) o con `curl -I <url>` revisa que la respuesta traiga `Content-Type: image/png` y `X-Content-Type-Options: nosniff`. Si falta `nosniff` o el tipo no es el correcto, avisa al equipo técnico antes de abrir la tienda.
5. **Comprobante de pago de punta a punta** (no se puede probar en local porque Storage no corre allí): haz un pedido de prueba, pon el costo de envío en el panel, sube una foto como comprobante desde el enlace del pedido, comprueba que aparece en `order-proofs/<tenant_id>/<order_id>/...`, que el panel la abre con un enlace firmado, y aprueba el pedido. Prueba también rechazar uno y que el cliente pueda subir otro.
6. **Datos reales de Spezia**: el dueño entra a su panel y reemplaza todo lo que dice `EJEMPLO`: precios por persona y rangos, carnes y complementos con sus extras, anticipo, frascos y existencias (**Productos**); horario y días cerrados (**Calendario**); modo de envío, zonas, recargos por fecha y **datos de transferencia** (**Ajustes**); subtítulo de la tienda (**Apariencia**). Revisa la tienda pública y busca la palabra `EJEMPLO`: no debe quedar ninguna. En producción el script de semilla no corre, así que allí los datos se cargan directamente desde el panel.
7. Borra los pedidos y usuarios de prueba que hayas creado en staging.

## Qué hace cada quien

| Paso | Quién |
|---|---|
| Crear proyectos en Supabase, copiar claves | Solo la persona dueña |
| Crear entornos, variables y dominios en Vercel | Solo la persona dueña |
| Cambiar nameservers del dominio | Solo la persona dueña |
| Crear el administrador de producción | Solo la persona dueña |
| Escribir y revisar migraciones y código | El equipo técnico (nunca con claves reales) |
