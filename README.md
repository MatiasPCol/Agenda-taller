# Agenda del taller

App para organizar los trabajos del taller: calendario del mes, cajón con las entregas del día elegido, recordatorio de lo que se entrega mañana y lista de pendientes.

- **Datos:** Supabase (proyecto `agenda-taller`). Cada usuario entra con correo y contraseña y solo ve sus propios trabajos.
- **Limpieza:** todos los días se borran los trabajos con más de 3 meses de creados que ya vencieron, y las notas de hace más de 3 meses.
- **Aviso diario:** desde la app se activa una notificación a la hora que elijas con lo que se entrega al día siguiente. La envía la función `supabase/functions/recordatorio-diario`, que un cron llama cada hora. En iPhone hay que instalar la app primero.
- **Instalable:** se puede añadir a la pantalla de inicio del celular y abrir sin la barra del navegador.

Es una página estática: Vercel la publica sin configuración.
