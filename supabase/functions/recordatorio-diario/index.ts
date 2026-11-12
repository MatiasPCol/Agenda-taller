// Agenda del taller: avisa por notificación lo que hay que entregar mañana.
// - Cada hora, el cron llama con el encabezado x-cron-secret y se avisa a quien eligió esa hora.
// - Desde la app, un usuario con sesión puede pedir un aviso de prueba ({"test": true}).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; hour: number };
type Task = { user_id: string; title: string };

let configured = false;
let cronSecret = "";
async function setup() {
  if (configured) return;
  const { data, error } = await sb.rpc("agenda_push_config");
  if (error || !data?.public || !data?.private) throw new Error("config");
  webpush.setVapidDetails("https://github.com/MatiasPCol/agenda-taller", data.public, data.private);
  cronSecret = data.cron_secret;
  configured = true;
}

// Colombia no tiene horario de verano: siempre UTC-5.
function bogota() {
  const now = new Date(Date.now() - 5 * 3600 * 1000);
  const hour = now.getUTCHours();
  const t = new Date(now.getTime() + 24 * 3600 * 1000);
  const tomorrow = t.toISOString().slice(0, 10);
  return { hour, tomorrow };
}

function message(titles: string[]) {
  if (!titles.length) return { title: "Mañana no tienes entregas", body: "Tu agenda está libre para mañana." };
  const n = titles.length;
  const shown = titles.slice(0, 4).join(", ");
  const more = n > 4 ? ` y ${n - 4} más` : "";
  return {
    title: n === 1 ? "Mañana entregas 1 trabajo" : `Mañana entregas ${n} trabajos`,
    body: shown + more,
  };
}

async function send(sub: Sub, payload: { title: string; body: string }) {
  const req = webpush.generateRequestDetails(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify({ ...payload, url: "/" }),
    { TTL: 6 * 3600, urgency: "normal" },
  );
  const res = await fetch(req.endpoint, { method: req.method, headers: req.headers as HeadersInit, body: req.body });
  if (res.status === 404 || res.status === 410) {
    await sb.from("push_subs").delete().eq("id", sub.id); // el celular ya no acepta avisos
    return "gone";
  }
  return res.ok ? "ok" : `error ${res.status}`;
}

async function notify(subs: Sub[], tomorrow: string, sendEmpty: boolean) {
  if (!subs.length) return { sent: 0 };
  const users = [...new Set(subs.map((s) => s.user_id))];
  const { data: tasks, error } = await sb
    .from("tasks").select("user_id,title")
    .in("user_id", users).eq("due", tomorrow).eq("done", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const byUser = new Map<string, string[]>();
  (tasks as Task[]).forEach((t) => byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t.title]));
  const results = await Promise.allSettled(
    subs.map((s) => {
      const titles = byUser.get(s.user_id) ?? [];
      if (!titles.length && !sendEmpty) return Promise.resolve("skip");
      return send(s, message(titles));
    }),
  );
  return { sent: results.filter((r) => r.status === "fulfilled" && r.value === "ok").length, total: subs.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method" });
  try {
    await setup();
    const { hour, tomorrow } = bogota();

    // Llamada del cron
    const secret = req.headers.get("x-cron-secret");
    if (secret) {
      if (secret !== cronSecret) return json(401, { error: "unauthorized" });
      const { data, error } = await sb.from("push_subs").select("id,user_id,endpoint,p256dh,auth,hour").eq("hour", hour);
      if (error) throw error;
      return json(200, { hour, tomorrow, ...(await notify(data as Sub[], tomorrow, false)) });
    }

    // Aviso de prueba desde la app
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u?.user) return json(401, { error: "unauthorized" });
    const { data, error } = await sb.from("push_subs").select("id,user_id,endpoint,p256dh,auth,hour").eq("user_id", u.user.id);
    if (error) throw error;
    if (!data?.length) return json(404, { error: "no_subscription" });
    return json(200, await notify(data as Sub[], tomorrow, true));
  } catch (_e) {
    return json(500, { error: "server" });
  }
});
