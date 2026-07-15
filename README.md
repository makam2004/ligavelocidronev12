# Liga Velocidrone · versión con Telegram /top, /tracks, /supertop y monitor de mejoras

Esta versión mantiene todo lo que ya te funcionaba y añade una capa nueva para Telegram:

1. `/top` en Telegram con los 2 tracks activos
2. monitor automático de `/top`
3. monitor automático de **mejoras de tiempo**
4. aviso en Telegram cuando un piloto mejora su mejor marca en uno de los tracks activos

## Estructura principal

```text
server/
  app.js                      # rutas Express
  config.js                   # variables de entorno
  index.js                    # arranque del servidor y monitores
  middleware/
    adminAuth.js              # protección por ADMIN_KEY
  services/
    database.js               # Supabase: pilotos, tracks, puntos semanales/anuales simplificados y monitor state
    league.js                 # lectura de tiempos Velocidrone
    rankings.js               # puntos semanales y ranking anual
    telegram.js               # webhook, /top, /tracks, /supertop y monitores automáticos
  utils/
    date.js                   # cálculo de semana ISO
    http.js                   # errores HTTP
    leaderboard.js            # parser y normalización Velocidrone
    normalize.js              # utilidades de limpieza
  public/
    index.html                # web pública con pestañas
    admin.html                # panel admin, solo accesible por /admin
    pilot-signup.html         # alta pública de pilotos
    css/
      style-ui.css
      style-home.css
    js/
      app.js
      admin.js
      pilot-signup.js
supabase/
  schema.sql                  # tablas y policies
  seed.sql                    # datos de ejemplo
scripts/
  smoke-test.mjs              # prueba básica local
render.yaml                   # despliegue en Render
Dockerfile                    # despliegue por Docker si lo prefieres
```

## Tablas de Supabase

### `pilots`
Pilotos de tu liga.

### `tracks`
Tracks configurados. Lo normal para una semana es tener **2 tracks activos**.

### `pilot_week_points`
Foto semanal agregada por piloto. Una fila por piloto y semana.

### `pilot_season_points`
Acumulado anual simplificado. Una fila por piloto y temporada.

### `weekly_points` (legacy, ya no se usa)
Se conserva solo por compatibilidad histórica. El acumulado anual nuevo ya no depende de esta tabla.

### `leaderboard_monitor_state`
Nueva tabla.

Guarda la **mejor marca conocida por piloto y track** para que el monitor pueda comparar cada 15 minutos y detectar si ha habido una mejora real.

La primera vez que corre el monitor:
- guarda el estado base,
- pero **no manda avisos**,
- y a partir de ahí ya solo notifica cuando detecta una mejora real.

## Variables de entorno

### Necesarias
- `ADMIN_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE`
- `VELO_API_TOKEN`

### Telegram necesarias
- `PUBLIC_BASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`

### Telegram para envíos automáticos
- `TELEGRAM_ALLOWED_CHAT_IDS`
- `TELEGRAM_TOP_AUTOPOST_ENABLED`
- `TELEGRAM_TOP_INTERVAL_MINUTES`
- `TELEGRAM_TOP_AUTOPOST_ON_BOOT`
- `TELEGRAM_IMPROVEMENT_MONITOR_ENABLED`
- `TELEGRAM_IMPROVEMENT_INTERVAL_MINUTES`
- `TELEGRAM_IMPROVEMENT_MONITOR_ON_BOOT`

### Otras opcionales
- `ALLOWED_ORIGINS`
- `SIM_VERSION`
- `CACHE_TTL_MS`
- `PORT`

## Valores recomendados para tu caso

```text
TELEGRAM_TOP_AUTOPOST_ENABLED=true
TELEGRAM_TOP_INTERVAL_MINUTES=360
TELEGRAM_TOP_AUTOPOST_ON_BOOT=false
TELEGRAM_IMPROVEMENT_MONITOR_ENABLED=true
TELEGRAM_IMPROVEMENT_INTERVAL_MINUTES=15
TELEGRAM_IMPROVEMENT_MONITOR_ON_BOOT=false
```

## Cómo actualizar Supabase

Como has añadido una función nueva, **sí tienes que ejecutar otra vez** el esquema:

1. Abre Supabase SQL Editor.
2. Ejecuta `supabase/schema.sql`.
3. No hace falta tocar `seed.sql` salvo que quieras datos de ejemplo.

La parte importante es que existan estas tablas:
- `leaderboard_monitor_state`
- `pilot_week_points`
- `pilot_season_points`

## Qué hace el monitor de mejoras

Cada ciclo:
- lee los tracks activos,
- pide el leaderboard filtrado por tus pilotos de liga,
- compara el mejor tiempo actual de cada piloto contra el mejor tiempo guardado en `leaderboard_monitor_state`,
- y si detecta una mejora, manda un mensaje a Telegram.

Formato aproximado:

```text
🏁 Liga Semanal Velocidrone
⏱️ Nueva mejora de tiempo en el Track 2
📍 Nombre del track
👤 Piloto: ArroyaPasto
🔻 Tiempo anterior: 47.44s
✅ Nuevo tiempo: 46.31s
📅 13/3/2026, 16:08:45
```

## Comandos y endpoints de Telegram

### Comando Telegram
- `/top`

### Endpoints admin
- `POST /api/admin/telegram/register-webhook`
- `POST /api/admin/telegram/send-top`
- `POST /api/admin/telegram/check-improvements`

### Panel admin
En `/admin` tienes ahora un botón:
- **Comprobar mejoras ahora**

Eso sirve para probar el monitor sin esperar los 15 minutos.

## Comportamiento importante

### Si todavía no tienes `TELEGRAM_ALLOWED_CHAT_IDS`
- el comando `/top` puede seguir funcionando por webhook en chats entrantes,
- pero los envíos automáticos del monitor necesitan saber a qué chat mandar los mensajes.

### Si usas Render Free
Los monitores viven dentro del proceso Node. Si Render duerme el servicio o lo reinicia, el contador se reinicia con él.

## Alta pública de pilotos

Se mantiene igual:
- el piloto escribe su nombre de Velocidrone,
- se genera un ID interno,
- queda pendiente,
- y tú lo activas desde `/admin`.

## Ranking semanal y anual

Se mantiene igual:
- el semanal se calcula con los tracks activos,
- el anual sale de `pilot_season_points` en Supabase.


## Ajustes del monitor y zona horaria

- El monitor de mejoras ahora **sigue comprobando tiempos aunque todavía no hayas configurado `TELEGRAM_ALLOWED_CHAT_IDS`**.
- Si no hay chats permitidos, actualizará la tabla `leaderboard_monitor_state` pero no intentará enviar avisos.
- La app genera y muestra sus horas en **Europa/Madrid**.
- En Render conviene tener también `TZ=Europe/Madrid`.


## Temas de Telegram

Puedes enrutar mensajes del bot a temas concretos del grupo configurando:

- `TELEGRAM_TOPIC_TOP_THREAD_ID=2` para `/top` y las mejoras de tiempos
- `TELEGRAM_TOPIC_SUPERTOP_THREAD_ID=3` para `/supertop`
- `TELEGRAM_TOPIC_TRACKS_THREAD_ID=4` para `/tracks`

El comando `/tracks` muestra los dos tracks activos con un formato más visual.

El comando `/supertop` publica el ranking anual acumulado leyendo `pilot_season_points` de Supabase. La tabla se reconstruye a partir de `pilot_week_points` cada vez que guardas una semana. También acepta opcionalmente un año, por ejemplo `/supertop 2026`.
