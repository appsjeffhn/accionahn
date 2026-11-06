# Accionahn: plataforma multi-tenant de tienda en línea + bot de IA

Fecha: 2026-11-05. Autor de la visión: dueño de Accionahn (no técnico, delega las decisiones técnicas). Las decisiones marcadas **[Decisión del dueño]** las tomó él; las marcadas **[Propuesta mía]** son recomendaciones técnicas que aún necesitan su visto bueno.

## 1. Intención y por qué

Accionahn es una agencia de servicios informáticos. Quiere vender un producto recurrente: **una tienda en línea con inventario, más un bot de IA** que atiende a los clientes finales del negocio en la web y en WhatsApp. El cliente de Accionahn (el dueño de un negocio) paga **US$55 al mes**. Meta: **78 clientes** de cualquier país, con diseño que escale hasta 1000.

Hoy el dueño tiene dos sistemas de un solo cliente cada uno (botbotPOS y Hondusport). Este sería su **primer sistema multi-tenant**. Su problema principal con botbotPOS: el bot a veces dice que no tiene información que sí existe, o divaga con datos imprecisos, y corregirlo cliente por cliente sería inmanejable con muchos clientes. Quiere además bajar el costo de IA usando Vertex AI.

**Clientes objetivo:** negocios que venden por internet, tiendas físicas que exploran IA y e-commerce en general.

## 2. Metas, no metas y antimetas

**Metas**
- Un cliente nuevo queda operando con un wizard desde el panel de la agencia, sin que el dueño programe nada por cliente.
- El bot responde con datos reales del inventario del cliente y lo demuestra con pruebas automáticas.
- El dueño de Accionahn ve consumo de IA y de WhatsApp por cliente, y controla topes y alertas.
- Las mejoras se prueban en staging, luego en un cliente piloto, luego se liberan a todos con un clic y se pueden revertir.

**No metas (por ahora)**
- No hay POS (punto de venta). Solo inventario, tienda y bot.
- No se cobra dentro del bot. El flujo termina en la **confirmación del pedido**; el pago se arregla fuera. Los links de pago quedan para una fase posterior.
- No hay departamentos ni varios destinatarios de avisos: solo el dueño del negocio. **[Decisión del dueño]**
- El cobro recurrente de los US$55 y la facturación internacional se diseñan después.

**Antimetas (fracaso aunque técnicamente funcione)**
- Bots que inventan o divagan, o que dicen "no lo tengo" cuando el producto existe. **[Decisión del dueño]** Con muchos clientes, validarlo a mano sería imposible.

## 3. Restricciones

- El dueño no es técnico: el sistema se opera desde paneles, no desde consola.
- Presupuesto de IA: **tope de US$5 al mes por cliente**, con alertas de acercamiento a la cuota y posibilidad de subir el cupo desde el panel.
- Los costos de la API oficial de WhatsApp los paga el cliente; el panel debe mostrar un estimado junto al costo de IA. **[Decisión del dueño]**
- Ya existe un VPS propio del dueño con Evolution API.
- Todo debe estar planteado para múltiples países, con español e inglés y varias monedas (principalmente dólar) desde el primer hito.
- El VPS es de la agencia y un solo Evolution API atiende a todos los clientes (una sesión de WhatsApp por cliente).

## 4. Qué se decidió y cómo

**[Decisión del dueño]**
- Un número de WhatsApp **por cliente**, conectado por el cliente mismo.
- Dos modos de WhatsApp: **Evolution API** (QR, no oficial) y **API oficial de WhatsApp (Cloud API)**.
- Dominios: el cliente trae el suyo, lo compra por medio de Accionahn, o recibe un subdominio gratis de `accionahn.com`.
- Staging/QA y producción separados; poder probar con un cliente y luego liberar a todos.
- El primer hito se prueba con un negocio propio del dueño: **Spezia**.
- Los avisos de traspaso a persona van por WhatsApp, solo al dueño del negocio.

**[Propuesta mía] (el dueño delegó estas decisiones; falta su visto bueno)**
- Una sola aplicación multi-tenant en Vercel (Next.js), con todos los clientes distinguidos por dominio o subdominio, y wildcard de `accionahn.com`.
- **Supabase** como base de datos única, con aislamiento por cliente mediante seguridad a nivel de fila (RLS). Supabase en vez de Neon porque trae autenticación, archivos y RLS integrados.
- **Un solo proyecto de Vertex AI.** El consumo de cada cliente se mide en la base de datos del propio sistema y el tope de US$5 lo aplica el código (no Google). Un proyecto de Google por cliente se descarta: los presupuestos de Google Cloud solo alertan y no cortan el gasto, y habría límites de proyectos por cuenta.
- **Cerebro del bot en Node.js**, una sola pieza que atiende a todos los clientes y lee la configuración de cada uno desde la base de datos. **n8n** solo para tareas secundarias (avisos, recordatorios, reportes), no para el bot.
- Evolution API en VPS, con diseño para repartir clientes entre varios VPS; un solo VPS no aguanta 1000 sesiones. Evolution no corre en Vercel porque necesita proceso persistente.
- Una sola cuenta de Vercel y un solo correo, con todo preconfigurado desde el panel de la agencia.

## 5. Cómo funciona

### 5.1 Panel de la agencia (Accionahn)
- Alta de clientes: el cliente se registra en la web de Accionahn y pide un bot; la agencia lo aprueba.
- **Wizard de configuración** por cliente: datos de la empresa, dominio o subdominio, canal de WhatsApp (Evolution o Cloud API), campos de confirmación de pedido, número de contacto del dueño para avisos, tope de IA.
- Tablero de consumo: costo de IA y estimado de WhatsApp por cliente, con alertas al 80 % y 100 % del tope y botón para ampliar el cupo.
- **Gestión de versiones:** staging, cliente piloto, liberación a todos, reversión con un clic.
- Tablero de calidad: resultado de pruebas automáticas y lista de conversaciones sospechosas por cliente.

### 5.2 Panel del cliente (dueño del negocio)
- Gestión de inventario y de productos configurables.
- Pedidos confirmados y conversaciones pendientes de atención humana.
- Métricas del bot: conversaciones, pedidos, consumo.

### 5.3 Tienda en línea
- Una tienda por cliente en su dominio o subdominio, sin POS. Estilo Hondusport (referencia visual del dueño).
- El asistente de soporte vive en la propia web de la tienda: busca y recomienda productos.

### 5.4 Productos: simples y configurables
- **Productos simples:** precio, stock, fotos (por ejemplo, los encurtidos artesanales de Spezia).
- **Productos configurables por reglas:** el precio y las opciones cambian según una cantidad. Caso Spezia: taqueadas con **3 tipos de carne y 8 toppings**; una tabla por **rango de personas** define el precio y cuántos toppings van incluidos. El bot pregunta cuántas personas son, ubica el rango, ofrece las opciones que corresponden, calcula el total y deja el pedido listo.
- Esta pieza debe diseñarse genérica (paquetes, catering, servicios), no específica de comida.

### 5.4.1 Carrito **[Decisión del dueño]**
- La tienda tiene **carrito**. El cliente final arma el pedido en la web y pulsa "Confirmar pedido" (sin pago en línea).
- **[Propuesta mía]** El carrito entrega el pedido al bot, en el chat web o abriendo WhatsApp con el resumen ya escrito. El bot valida contra el inventario, pide los campos de confirmación que falten (sección 5.5) y lo deja en estado "confirmado".
- Un pedido hecho solo conversando con el bot y uno hecho con carrito son **la misma entidad "pedido"**, con los mismos estados y avisos. El stock se descuenta al confirmar (mi propuesta).
- Los productos configurables (taqueadas) se arman con un selector guiado en la tienda: personas, carnes y toppings, con el total calculado por las mismas reglas que usa el bot.

### 5.5 Confirmación de pedido
- Los datos que pide el bot **los define cada cliente** en el wizard (activar o desactivar campos). Spezia: lugar, fecha, hora, dirección y anticipo. Otros negocios: dirección y costo de envío, u otros.
- El pedido termina en "confirmado"; no hay cobro dentro del bot.

### 5.6 Bot: no responde de memoria
- Para cualquier pregunta sobre productos, precios o stock, el bot **siempre consulta antes** una búsqueda en el inventario del cliente y responde solo con lo que devuelve.
- Que un producto "exista o no" lo decide una consulta a la base de datos, no el modelo. La búsqueda es **híbrida**: texto exacto, tolerancia a errores de escritura y embeddings (pgvector en Supabase) para búsquedas por significado. Los embeddings solo traen candidatos; precio, stock y disponibilidad siempre salen de la base de datos.
- Si la búsqueda no devuelve resultado, el bot lo dice con honestidad y pasa a una persona. No inventa.
- **Pruebas automáticas por cliente:** un conjunto de preguntas con respuesta conocida que corre solo antes de liberar una mejora. Resultado visible como tablero verde o rojo. **[Decisión del dueño]** El sistema genera las preguntas a partir del inventario y las sugiere; luego la agencia y el dueño del negocio las validan y pueden agregar o quitar. El wizard y el panel del cliente necesitan una pantalla para eso.
- **Alerta de dudas en producción:** el panel marca conversaciones donde el bot dijo "no lo tengo" y existía algo parecido, y las que terminaron en una persona.

### 5.7 Traspaso a persona y avisos por WhatsApp
- Se activa un aviso cuando: el bot no encontró respuesta, el cliente final pidió hablar con alguien o hubo reclamo/duda fuera del alcance del bot; cuando hay un **pedido confirmado** (con el resumen completo); y cuando una conversación se atasca (misma pregunta repetida sin resolver).
- Al traspasar, el bot **se pone en pausa solo en esa conversación**. El aviso llega por WhatsApp **solo al dueño**, con el nombre o número del cliente final, un resumen de una línea y el motivo. Se manda a un número de contacto aparte que el dueño define en el wizard, no desde el número del bot al cliente final.
- El panel del cliente lista las conversaciones pendientes; si nadie responde en cierto tiempo el aviso se repite y la agencia lo ve en su panel. Una persona puede devolverle la conversación al bot.

### 5.8 Canales
- **Web:** asistente de soporte en la tienda.
- **WhatsApp:** Evolution API (QR, riesgo de baneo del número) y Cloud API oficial (estable, Meta cobra por conversación al cliente). El cerebro del bot es el mismo; el modo de canal es un detalle de conexión por cliente.

## 6. Orden de construcción (varios proyectos, uno tras otro)

1. Base multi-tenant y panel de agencia: clientes, planes, wizard, versiones, staging/producción.
2. Tienda e inventario con panel del cliente (productos simples y configurables).
3. Cerebro del bot: asistente web, búsqueda híbrida, medición de costo, tope de US$5, alertas, pruebas automáticas.
4. WhatsApp: Evolution y Cloud API, reparto entre VPS, avisos al dueño.
5. Cobro recurrente de US$55 y facturación internacional.

**Primer hito (proyectos 1 a 3 con un solo cliente de prueba):** Spezia funcionando de punta a punta con tienda, inventario, taqueadas configurables, campos de pedido configurables y bot web, ya con forma multi-tenant (el cliente número 2 se agrega con un registro).

## 6.1 Decisiones que tomé tras la revisión (**[Propuesta mía]**, a verificar por el dueño)

- **Dónde corre el bot:** en funciones de Vercel (recibe webhooks de WhatsApp y atiende el chat web). Solo Evolution API vive en el VPS. El VPS actual se usa en producción; staging usa una instancia de Evolution aparte (puede ser un contenedor adicional en el mismo VPS).
- **Tope de US$5 al llegar al 100 %:** el bot deja de usar IA para ese cliente y pasa a modo "traspaso a persona" con un mensaje amable. La tienda y el inventario siguen funcionando. El tope cuenta chat y embeddings, y se reinicia por **mes calendario**. El dueño de la agencia puede subir el cupo desde el panel.
- **Versiones en una app compartida:** se versionan el **código** (feature flags por cliente y por grupo piloto) y los **prompts y la configuración del bot** (con historial y reversión). Las migraciones de base de datos son siempre compatibles hacia atrás, así que no se revierten: se corrigen hacia adelante.
- **Roles:** agencia, dueño del negocio (puede haber varios usuarios por negocio, sin departamentos; un usuario pertenece a un solo negocio al inicio) y cliente final (sin cuenta, como invitado).
- **Hito 1 y dominios:** solo subdominios de `accionahn.com`. Dominio propio y compra de dominios se difieren a un proyecto posterior.
- **Idiomas [Decisión del dueño]:** español e inglés desde el hito 1, para ofrecer opciones a los clientes y poder captar clientes en otro idioma. Aplica a la tienda, el bot, el panel del cliente y el panel de la agencia. El bot responde en el idioma en que le escribe el cliente final.
- **Multimoneda [Decisión del dueño]:** varias monedas para varios países, principalmente el dólar. Entra en el hito 1. **[Propuesta mía]** Cada tienda tiene una moneda base (Spezia: lempira) y puede activar otras (dólar primero). Para cada moneda adicional el dueño del negocio elige entre fijar el precio a mano o convertirlo con un tipo de cambio que él mismo define; no se usa un tipo de cambio automático externo en el hito 1. El pedido guarda la moneda y el total con que se hizo, y el bot siempre cotiza en la moneda del cliente final cuando la tienda la ofrece.
- **Privacidad:** el hito 1 guarda conversaciones con retención configurable por cliente (por defecto 12 meses) y permite borrar datos de un cliente final a solicitud. Normativa por país se revisa antes de vender fuera de Honduras.
- **Datos de Spezia:** el dueño aporta el menú real, la tabla de rangos de personas y precios; con eso se define el modelo de productos configurables y el criterio de "hito cumplido".

## 7. Qué queda para quien construya

- Esquema concreto de base de datos, RLS, y estructura del repositorio.
- Elección de modelo de Vertex AI y del modelo de embeddings, según costo y calidad medidos en pruebas.
- Mecanismo exacto de feature flags / liberación por grupos y reversión.
- Cómo estructurar la traducción de textos y los precios por moneda.
- Detalle del reparto de clientes entre varios VPS de Evolution.
- Diseño visual de la tienda y de los paneles.
- Cómo cobrar la suscripción internacional (proyecto 5).
