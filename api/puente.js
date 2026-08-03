// PUENTE HACIA APPS SCRIPT — Gestor de Expedientes PRIS
// ─────────────────────────────────────────────────────────────
// Este archivo va en la carpeta  api/  del repositorio (api/puente.js).
// La app le pega a /api/puente (mismo dominio de Vercel, nunca bloqueado)
// y este puente reenvía el pedido a script.google.com DESDE los servidores
// de Vercel, esquivando el firewall de la red de la oficina.
//
// IMPORTANTE: para que el maxDuration de 60s valga en el plan Hobby,
// hay que tener activado FLUID COMPUTE en Vercel
// (Settings → Functions → Fluid Compute → Enable). Sin eso, Vercel
// corta la función a los 10s y devuelve una página HTML de error 504,
// que es lo que hacía explotar el .json() con "Unexpected token '<'".
// ─────────────────────────────────────────────────────────────

export const config = { maxDuration: 60 };

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwXnUvwLx91Y88AX7wDT9M7sSkp76vJ888aErmcWMT7-E7csttQVho31TZfk1G6lPnk/exec";

// Abortamos antes de que Vercel corte la función, así SIEMPRE alcanzamos
// a devolver un JSON legible en vez de la página 504 en HTML.
const TIMEOUT_MS = 55000;

export default async function handler(req, res) {
  // Desde el arranque forzamos que TODO lo que salga de acá sea JSON.
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res
      .status(200)
      .send(JSON.stringify({ ok: false, error: "Método no permitido (usá POST)." }));
  }

  // El cuerpo puede llegar ya parseado (objeto) o como texto plano.
  const cuerpo =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});

  const controller = new AbortController();
  const relojDeCorte = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const r = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: cuerpo,
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(relojDeCorte);

    const texto = (await r.text()) || "";
    const limpio = texto.trimStart();

    // CASO FELIZ: Apps Script devolvió JSON → lo pasamos tal cual.
    if (limpio.startsWith("{") || limpio.startsWith("[")) {
      return res.status(200).send(texto);
    }

    // Apps Script devolvió HTML (login/autorización de Google o página de error).
    // En vez de dejar que el navegador explote con "<!DOCTYPE", devolvemos un
    // JSON con un mensaje que explica qué hacer.
    const esGoogleAuth =
      /accounts\.google\.com|ServiceLogin|Se requiere autorizaci|Authorization is required|requires authorization/i.test(
        texto
      );

    const msg = esGoogleAuth
      ? "El Apps Script pidió iniciar sesión / autorización de Google. Hay que redeployar el script (Implementar → Administrar implementaciones → lápiz → Nueva versión → Implementar) y ejecutar cualquier función una vez para volver a aceptar los permisos."
      : "El Apps Script no devolvió JSON (probable error interno o un deploy viejo). Revisá el doPost y las 'Ejecuciones' en el editor de Apps Script.";

    return res.status(200).send(
      JSON.stringify({
        ok: false,
        error: msg,
        _debugStatus: r.status,
        _debugMuestra: texto.slice(0, 300),
      })
    );
  } catch (e) {
    clearTimeout(relojDeCorte);

    const esTimeout = e && e.name === "AbortError";
    const error = esTimeout
      ? "El Apps Script tardó demasiado (más de 55s) y se cortó. Suele pasar con PDF muy pesados o si el doPost se cuelga: probá comprimir el PDF o revisar el script. (Verificá también que Fluid Compute esté activado en Vercel para tener 60s.)"
      : "Puente → Apps Script: " + (e && e.message ? e.message : String(e));

    return res.status(200).send(JSON.stringify({ ok: false, error }));
  }
}
