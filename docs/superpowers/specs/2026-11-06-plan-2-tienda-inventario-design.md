# Plan 2: tienda en línea, inventario, calendario y pedidos

Fecha: 2026-11-06. Amplía la sección 5.3 a 5.5 y el punto 2 de la sección 6 de `2026-11-05-accionahn-bot-platform-design.md`. Las decisiones marcadas **[Decisión del dueño]** las tomó el dueño de Accionahn en la conversación del 2026-11-06; las marcadas **[Propuesta mía]** son recomendaciones técnicas pendientes de su visto bueno.

## 1. Intención y por qué

El dueño lo resumió así: el cliente final debe **seleccionar correctamente lo que necesita y ver precios reales**. El éxito del plan 2 es que un pedido llegue armado sin errores, con el precio verdadero, sin que una persona tenga que corregirlo a mano.

El primer negocio es Spezia (taqueadas a domicilio y encurtidos artesanales), pero el diseño debe servir a otros: **barberías, salones de belleza y tiendas de ropa con pedido en línea**. Nada de "taqueada" va fijo en el sistema.

## 2. Metas, no metas y antimetas

**Metas**
- Un negocio nuevo configura su catálogo, precios, calendario, envío y cobros desde el panel, sin código.
- El precio que ve el cliente en la tienda, el carrito y el pedido sale de **una sola fuente** (el panel del dueño) y de un solo cálculo, el mismo que usará el bot en el plan 3.
- Un horario o un producto agotado no se puede pedir.
- Cada tienda tiene su propia apariencia.

**No metas (en este plan)**
- Sin pagos en línea ni enlaces de pago (plan 5). El anticipo es transferencia con comprobante que el dueño revisa.
- Sin bot ni WhatsApp (planes 3 y 4). Este plan deja el cálculo de precios, la disponibilidad y los pedidos listos para que el bot los consulte.
- Sin cálculo de distancia con mapa (queda diferido, tiene costo por consulta).
- Sin POS.

**Antimetas**
- Un precio mostrado que luego no coincide con el cobrado. **[Decisión del dueño]**
- Dos pedidos que se cruzan en el mismo horario, o que superan el límite del día.
- Vender stock que no existe.

## 3. Tipos de producto **[Decisión del dueño]**

Tres tipos, que cada negocio combina:

1. **Simple:** precio, fotos, existencias. Con **variantes opcionales** (talla, color), cada una con sus propias existencias. Ejemplos: encurtidos, ropa.
2. **Configurable:** el cliente escoge opciones y el precio sale de reglas. Spezia: la taqueada, con una tabla por **rango de personas** que da el precio base y cuántas carnes (3 tipos disponibles) y complementos (8 disponibles) incluye; el sistema valida que escoja exactamente lo permitido.
3. **Reservable:** ocupa franjas del calendario. Se define con duración de preparación, duración de servicio y un límite por día. Spezia: 1 hora de preparación en sitio + 2 horas de servicio, fijas. Salón o barbería: duración **por servicio** (corte 30 minutos, tinte 2 horas).

Un producto configurable puede ser también reservable (la taqueada lo es).

## 4. Cómo funciona

### 4.1 Precio
Total = **precio base** (producto, variante o rango de personas) **+ recargo por fecha + recargo de envío**, en la moneda de la tienda.
- **Recargo por fecha:** el dueño marca fechas o días de la semana con un recargo (feriados, fines de semana). Se suma solo.
- **Recargo de envío:** cada negocio escoge uno de tres modos **[Decisión del dueño]**: **automático por zonas** (el cliente escoge su zona y el recargo sale solo), **por aprobación** (el dueño fija el recargo mirando la dirección, como hoy en Spezia) o **sin recargo / fijo**. El cálculo por kilómetros con mapa queda diferido. **[Propuesta mía: empezar con zonas.]**
- Con envío por aprobación el cliente ve el precio marcado "envío por confirmar". Hasta que el dueño lo fije, **no existe total final**, y ni la tienda ni el bot pueden inventarlo.
- El cliente siempre ve el desglose completo antes de confirmar.
- Multimoneda: aplica lo definido en la sección 6.1 de la spec original (moneda base por tienda; otras monedas con precio fijo o tipo de cambio que el dueño define). El pedido guarda la moneda y los totales con que se hizo.

### 4.1.1 Reglas del producto configurable y del pedido **[Decisión del dueño]**
- **Rangos de personas:** el rango da un **precio por persona**; el total base es personas × ese precio. Cada rango define cuántas carnes y complementos incluye. **[Propuesta mía]** Con más personas que el último rango, el pedido se arma pero queda "por cotizar" y el dueño fija el precio, igual que el envío por aprobación.
- **Extras con costo:** el cliente puede agregar carnes o complementos por encima de lo incluido, cada opción con su precio extra definido por el dueño.
- **Recargo por fecha:** cada regla es **monto fijo o porcentaje** a elección del dueño, y si coinciden varias reglas en una fecha **se suman**.
- **Pedido con varios productos:** el dueño pidió ambas formas. **[Propuesta mía]** Por defecto un pedido tiene **una fecha y franja** para todo (lo habitual: los encurtidos viajan con la taqueada); cada negocio puede activar **fecha por producto** (útil para citas distintas). Con una sola fecha, el recargo de fecha, el de envío y el anticipo se calculan una vez por pedido; con fecha por producto, el recargo de fecha va por línea y el envío una vez por entrega.

### 4.2 Cobro **[Decisión del dueño]**
Cada negocio escoge cuándo se cobra: **anticipo parcial** (porcentaje o monto fijo, definido por producto), **pago completo adelantado** o **pago al recibir**. **[Propuesta mía]** Se puede combinar: producto pagado antes y envío cobrado al entregar, o adelanto del envío; el negocio lo configura en el asistente.
- **Envío automático:** el total ya es final, así que el cliente ve de inmediato cuánto debe adelantar y cómo pagarlo.
- **Envío por aprobación:** el cliente espera la confirmación del recargo y entonces ve el monto a adelantar.
- **Comprobante:** el cliente ve los datos de transferencia del negocio y sube la foto del comprobante. El pedido queda "pendiente de revisión"; el dueño lo revisa en el panel y lo marca **pagado** (queda en firme) o **rechazado con motivo** (el cliente puede subir otro). Nadie, ni el bot, dice "pago recibido" hasta que el dueño lo marque.

### 4.3 Calendario de disponibilidad
- Cada producto reservable tiene un **límite de reservas por día** y el dueño puede cerrar fechas.
- Cada reserva ocupa una franja (preparación + servicio, más un margen opcional). **Las franjas no se pueden cruzar**: el cliente solo ve horarios libres, y la base de datos lo impide aunque dos clientes pidan el mismo horario a la vez.
- **Recursos opcionales** **[Decisión del dueño]**: un salón o barbería puede tener personas (barbero, estilista), cada una con su calendario. Al reservar, el cliente escoge una persona o "cualquiera disponible", y el sistema asigna a quien esté libre. Cada negocio activa lo que use; Spezia tiene un solo equipo.
- La reserva aparta el horario al entrar el pedido y **se libera si el anticipo no llega a tiempo**. **[Propuesta mía]** Plazo por defecto 24 horas, ajustable por negocio.

### 4.4 Pedido y estados
Un solo tipo de pedido, creado desde el carrito (y más adelante desde el bot). **[Propuesta mía]** Estados: `borrador`, `pendiente de envío por confirmar`, `pendiente de anticipo`, `pendiente de revisión de comprobante`, `confirmado`, `cancelado`. Cada cambio queda registrado con quién y cuándo.
- **Existencias:** se reservan al crear el pedido y se descuentan al quedar `confirmado`; se liberan si se cancela o vence el plazo. Un producto agotado deja de poder pedirse. **[Propuesta mía]**
- Los campos de confirmación (lugar, fecha, hora, dirección, etc.) los define cada negocio en el asistente, como en la sección 5.5 de la spec original.

### 4.5 Tienda y carrito
- Una tienda por cliente, en su subdominio, con **carrito**. Selector guiado para los configurables (personas, carnes, complementos) y selector de fecha y hora para los reservables, que solo ofrece lo disponible.
- **Apariencia personalizada por cliente** **[Decisión del dueño]**: logo, colores y textos configurables desde el panel del cliente, en español e inglés. **[Propuesta mía]** Se logra con un conjunto de temas y variables (colores, tipografía, logo) sobre las mismas pantallas, no con diseños distintos por cliente; así una mejora llega a todos.

### 4.6 Panel del cliente (dueño)
Catálogo (los tres tipos, variantes, existencias, fotos), reglas de precio y recargos, zonas de envío, calendario y recursos, datos de transferencia, revisión de comprobantes, lista de pedidos, apariencia de la tienda.

### 4.7 Decisiones menores que tomé yo (**[Propuesta mía]**, a verificar)
- **Horario del calendario:** cada negocio y cada recurso tiene horario de atención por día de la semana; las franjas se ofrecen en pasos que el negocio define (por defecto 30 minutos); cada tienda tiene su zona horaria y se puede definir anticipación mínima y máxima para reservar. Un recurso puede limitarse a ciertos servicios.
- **Cliente invitado:** sin cuenta. Al pedir deja nombre y teléfono, y recibe un **enlace secreto** a su pedido para ver el estado y subir el comprobante. Para frenar pedidos falsos que bloquean horarios: límite de pedidos pendientes por teléfono y por dirección de red, y el dueño puede cancelar y bloquear.
- **Vencimiento:** el plazo corre desde que existe un total final (con envío por aprobación, desde que el dueño fija el recargo). En "pago al recibir" no hay anticipo: la reserva queda apartada hasta que el dueño la confirme o la rechace, y un proceso programado libera lo vencido.
- **Anticipos:** si el pedido tiene varios productos con anticipo, se suman. Modificar o cancelar un pedido confirmado y los reembolsos los maneja el dueño a mano en este plan (cambio de estado con motivo); no hay reembolsos automáticos.
- **Multimoneda:** el esquema de precios soporta moneda base más otras con precio fijo o tipo de cambio definido por el dueño (sección 6.1 de la spec original); redondeo a la unidad menor de cada moneda; los datos de transferencia se muestran tal como el negocio los escribe.

## 5. Restricciones heredadas
Aislamiento por negocio con RLS probado con pgTAP; español e inglés; multimoneda; el panel se opera sin consola; las migraciones son compatibles hacia atrás (regla del plan 1). Los ajustes que solo debe cambiar la agencia siguen protegidos como en el plan 1.

## 6. Qué queda para quien construya
- Esquema de base de datos, índices y restricciones que impidan los cruces de horario y el sobreventa de existencias, incluso con pedidos simultáneos.
- Módulo único de cálculo de precio, puro y con pruebas, reutilizable por el bot.
- Almacenamiento de fotos y comprobantes con acceso por negocio.
- Diseño visual de la tienda y del panel, y el conjunto de temas.
- Datos reales de Spezia: menú, tabla de rangos de personas y precios, zonas, fechas con recargo, límite diario y datos de transferencia (los aporta el dueño; sin ellos el hito no se puede validar).
- Fuera de este plan, para otro: bot, WhatsApp, pagos en línea, cálculo de distancia con mapa.
