// PUENTE HACIA APPS SCRIPT — Gestor de Expedientes PRIS
// ─────────────────────────────────────────────────────────────
// Este archivo va en la carpeta  api/  del repositorio (api/puente.js).
// La app le pega a /api/puente (mismo dominio de Vercel, nunca bloqueado)
// y este puente reenvía el pedido a script.google.com DESDE los servidores
// de Vercel, esquivando el firewall de la red de la oficina.
// ─────────────────────────────────────────────────────────────

export const config = { maxDuration: 60 };

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwXnUvwLx91Y88AX7wDT9M7sSkp76vJ888aErmcWMT7-E7csttQVho31TZfk1G6lPnk/exec";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Método no permitido" });
    return;
  }
  try {
    // El cuerpo puede llegar ya parseado (objeto) o como texto plano
    const cuerpo = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    const r = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: cuerpo,
      redirect: "follow",
    });

    const texto = await r.text();
    res.status(200).setHeader("Content-Type", "application/json").send(texto);
  } catch (e) {
    res.status(200).json({ ok: false, error: "Puente → Apps Script: " + e.message });
  }
}
