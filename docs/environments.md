# Entornos: staging y producción

Guía paso a paso para la persona dueña del proyecto. No hace falta saber programar. Las secciones marcadas **Solo la persona dueña** se hacen en los paneles de Supabase y Vercel con tu propia cuenta; ninguna herramienta ni agente automático puede hacerlas por ti.

**Regla de oro: ningún secreto se guarda en el repositorio.** Las claves y contraseñas solo se escriben en los paneles de Vercel y Supabase (o en tu propia terminal). Nunca en un archivo que se suba a GitHub. El archivo `.env.example` solo trae nombres con valores de ejemplo.

## Resumen

| | Staging (pruebas) | Producción (clientes reales) |
|---|---|---|
| Supabase | Proyecto `accionahn-staging` | Proyecto `accionahn-production` |
| Vercel | Entorno Preview | Entorno Production |
| `APP_ENV` | `staging` | `production` |
| Dominio | el que Vercel asigna a Preview | `app.accionahn.com` y `*.accionahn.com` |

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
2. Production: usa la rama `main`. Preview: cualquier otra rama y los pull requests.
3. Ve a **Settings > Environment Variables** y carga las variables de la sección 4. Al crear cada una, marca solo el entorno que corresponde (Production o Preview), de modo que Preview apunte al Supabase de staging y Production al de producción.

## 3. Dominios (Solo la persona dueña)

Los clientes viven en subdominios: `spezia.accionahn.com`, `otro.accionahn.com`, etc. El panel de la agencia vive en `app.accionahn.com`.

1. En Vercel: **Settings > Domains**. Agrega `app.accionahn.com` y `*.accionahn.com` al entorno Production.
2. Vercel mostrará los registros DNS que debes crear. Para un comodín (`*`) normalmente Vercel pide usar sus servidores de nombres (`ns1.vercel-dns.com` y `ns2.vercel-dns.com`) en el registrador donde compraste `accionahn.com`. Cambia los nameservers allí y espera a que Vercel marque el dominio como verificado (puede tardar de minutos a unas horas).
3. Vercel emite el certificado HTTPS del comodín por su cuenta una vez verificado.
4. Staging no necesita dominio propio: usa la dirección `*.vercel.app` que Vercel asigna al Preview.

## 4. Variables de entorno por entorno (solo nombres)

Se cargan en Vercel (sección 2) y nunca se escriben en el repositorio.

| Variable | Preview (staging) | Production |
|---|---|---|
| `APP_ENV` | `staging` | `production` |
| `ROOT_DOMAIN` | dominio de pruebas | `accionahn.com` |
| `SUPABASE_URL` | URL del proyecto staging | URL del proyecto producción |
| `SUPABASE_ANON_KEY` | clave anon de staging | clave anon de producción |
| `SUPABASE_SERVICE_ROLE_KEY` | clave service_role de staging | clave service_role de producción |

Para desarrollo local, copia `.env.example` a `.env.local` (este archivo está ignorado por git) y usa las claves que imprime `supabase start`.

## 5. Crear el primer administrador de la agencia

Solo existe un camino: el script de semilla, que además crea al cliente piloto Spezia. Corre únicamente con `APP_ENV` en `local` o `staging`; en producción se niega a ejecutarse.

1. Elige un correo y una contraseña fuertes para el administrador. Se pasan solo como variables de tu terminal, nunca en un archivo:
   - Variables: `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`.
   - Para staging, además `APP_ENV=staging`, las variables de la sección 4 de staging y `SEED_CONFIRM_URL` con la misma URL de `SUPABASE_URL` (confirmación de que apuntas al proyecto correcto).
2. Ejecuta `pnpm seed:spezia`.
3. El script crea el cliente `spezia` (cohorte `pilot`, moneda base HNL, USD a tasa 25, dominio `spezia.<ROOT_DOMAIN>`) y el administrador. Volver a ejecutarlo no duplica nada.
4. Para el administrador de **producción**, el script no se usa: créalo a mano en el panel de Supabase del proyecto de producción (**Authentication > Users > Add user**, con *Auto Confirm User*) y luego, en **SQL Editor**, ejecuta `insert into public.agency_admins (user_id) select id from auth.users where email = '<correo>';`. Hazlo tú; no compartas la contraseña con nadie.
5. Cambia el número de alerta del dueño de Spezia (el script usa uno falso, `+50400000000`) desde el panel de la agencia.

## Qué hace cada quien

| Paso | Quién |
|---|---|
| Crear proyectos en Supabase, copiar claves | Solo la persona dueña |
| Crear entornos, variables y dominios en Vercel | Solo la persona dueña |
| Cambiar nameservers del dominio | Solo la persona dueña |
| Crear el administrador de producción | Solo la persona dueña |
| Escribir y revisar migraciones y código | El equipo técnico (nunca con claves reales) |
