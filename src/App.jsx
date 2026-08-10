import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot,
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import { PACIENTES_USUARIOS } from "./usuarios.js";

/* ================================================================
   CONSTANTES CRÍTICAS — VERIFICAR SIEMPRE ANTES DE REEMPLAZAR ESTE ARCHIVO
   ================================================================ */

// Configuración Firebase (proyecto visitas-siprosa, colecciones propias gexp_)
const firebaseConfig = {
  apiKey: "AIzaSyCDFcb5B7swNnetMOxXhVNQWaDxa1LVRF4",
  authDomain: "visitas-siprosa.firebaseapp.com",
  projectId: "visitas-siprosa",
  storageBucket: "visitas-siprosa.firebasestorage.app",
  messagingSenderId: "957519453967",
  appId: "1:957519453967:web:e6c2bfac7a4da10fed287a",
  measurementId: "G-GHDRCXE81C"
};

// Apps Script del Gestor de Expedientes (Gmail + Drive)
// La app habla con el puente /api/puente (mismo dominio de Vercel, no lo bloquea
// la red de la oficina). El puente reenvía todo al Apps Script desde Vercel.
// La URL real del Apps Script está en api/puente.js.
const APPS_SCRIPT_URL = "/api/puente";
const APPS_SCRIPT_CLAVE = "GESTORPRIS2026";

// Contraseña de acceso (la misma del panel admin de visitas-siprosa)
const ADMIN_PASSWORD = "gerenciapris626";

// Logos (copiá los archivos desde la carpeta /public de visitas-siprosa)
const LOGO_PRIS = "/logo-pris.png";
const LOGO_GOBIERNO = "/logo-gobierno.png";

// Usuarios del equipo: nombre corto (para el tablero) y firma completa (para los mails)
const USUARIOS = [
  { id: "Jorge", firma: "Dipl. Jorge Barone" },
  { id: "Yamila", firma: "Yamila Avila" },
  { id: "Paula", firma: "Paula Facchin" },
  { id: "Julieta", firma: "Julieta Aguirre" },
];
const FIRMANTES = USUARIOS.map((u) => u.firma);

/* ================================================================ */

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const COL_EXPEDIENTES = "gexp_expedientes";
const COL_PROVEEDORES = "gexp_proveedores";

const ETAPAS = [
  "Cotización enviada",
  "Presupuestos",
  "Cuadro comparativo",
  "Nota afectación",
  "Pase a Auditoría Médica",
  "Asesoría Letrada",
  "Resolución",
  "Tribunal de Cuentas",
  "Orden de compra",
];

const PROVEEDORES_INICIALES = [
  { nombre: "SIAD (SIVKA)", emails: "cioc-siad@outlook.com", activo: true },
  { nombre: "NUTRIHOME", emails: "juanignacio.kairuz@nutrihome.com.ar, maximiliano.kaplan@fresenius-kabi.com, gabriela.leal@nutrihome.com.ar", activo: true },
  { nombre: "QUIMUR", emails: "arcissalud@gmail.com", activo: true },
  { nombre: "CUIDARTE", emails: "cuidartecomunicacion@gmail.com", activo: true },
  { nombre: "OMNES", emails: "gestionfinanciadoresomnes@gmail.com", activo: true },
  { nombre: "DYNAMIC", emails: "nutricion@dynamicsa.com.ar, rdecima@dynamicsa.com.ar", activo: true },
];

/* ---------- utilidades ---------- */

function calcularEdad(fnStr) {
  if (!fnStr) return "";
  const fn = new Date(fnStr + "T00:00:00");
  if (isNaN(fn)) return "";
  const hoy = new Date();
  let edad = hoy.getFullYear() - fn.getFullYear();
  const m = hoy.getMonth() - fn.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < fn.getDate())) edad--;
  return edad;
}

function formatearFecha(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function formatearFechaCorta(fnStr) {
  if (!fnStr) return "";
  const [a, m, d] = fnStr.split("-");
  return `${d}/${m}/${a}`;
}

// Días hábiles (lunes a viernes) transcurridos desde una fecha, sin contar el día de envío
function diasHabilesDesde(iso) {
  if (!iso) return 0;
  const desde = new Date(iso);
  desde.setHours(0, 0, 0, 0);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  let count = 0;
  const cursor = new Date(desde);
  while (cursor < hoy) {
    cursor.setDate(cursor.getDate() + 1);
    const dia = cursor.getDay();
    if (dia !== 0 && dia !== 6) count++;
  }
  return count;
}

function generarCuerpoMail(exp, firmante) {
  return (
`*Estimados:* Desde la Gerencia Administrativa del Programa Integrado de Salud, se solicita presupuesto para la provisión de un Módulo: *${exp.modulo}* Domiciliaria por el *período de ${exp.periodoMeses} (${numeroEnLetrasSimple(exp.periodoMeses)}) meses*, destinado al siguiente paciente:

• Paciente: ${exp.paciente.toUpperCase()}
• DNI: ${exp.dni}
• Expediente: ${exp.nroExpediente}
• Edad: ${exp.edad} años
• Fecha de Nacimiento: ${formatearFechaCorta(exp.fechaNacimiento)}
• Domicilio: ${exp.domicilio}
• Teléfono: ${exp.telefono}
• Receta y Síntesis de Historia Clínica: Se adjunta en archivo.

*Diagnóstico:* ${exp.diagnostico}

El módulo a cotizar, conforme a lo autorizado por el Departamento de Auditoría Médica, debe contemplar los siguientes servicios mensuales:

• ${exp.detalleServicios}

*Condiciones obligatorias de la presentación:*
*Detalle de costos:* El presupuesto (y la facturación posterior, de corresponder) debe estar detallado por provisión, indicando claramente el *precio unitario y el precio total de cada ítem*. Debe enviarse en formato PDF y contener CUIT, condición frente al IVA, nombre y apellido del paciente, y dirección y teléfono del proveedor. Caso contrario, se desestima el presupuesto por no ajustarse a normativas administrativas.

*Plazo de respuesta:* Se otorgará un *tiempo máximo de 5 (cinco) días hábiles* a partir de la recepción del presente correo.

Quedamos a la espera de su pronta respuesta.

Atentamente,

--
Confirmar Recepción
Atte. ${firmante}

Internaciones Domiciliarias.
Oficina de Compras y Contrataciones.
Gerencia Administrativa.`
  );
}

function numeroEnLetrasSimple(n) {
  const letras = ["cero","uno","dos","tres","cuatro","cinco","seis","siete","ocho","nueve","diez","once","doce"];
  return letras[n] || n;
}

function formatoPesos(n) {
  return "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function leerArchivoBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("No se pudo leer " + file.name));
    r.readAsDataURL(file);
  });
}

/* ---------- descarga directa de documentos (Word + PDF) ---------- */

function descargarBase64(b64, nombre, mime) {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Llama al Apps Script y descarga a la máquina los dos archivos: PDF + Word
async function llamarYDescargar(payload, descargarDoc = true, descargarPdf = true) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ clave: APPS_SCRIPT_CLAVE, ...payload }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Error desconocido en Apps Script");
  if (data.pdfBase64 && descargarPdf) descargarBase64(data.pdfBase64, data.nombreArchivo + ".pdf", "application/pdf");
  if (data.docBase64 && descargarDoc) {
    // pequeña pausa para que el navegador no bloquee la segunda descarga
    await new Promise((r) => setTimeout(r, 500));
    descargarBase64(data.docBase64, data.nombreArchivo + (data.docExt || ".doc"), data.docMime || "application/msword");
  }
  return data;
}

/* ================================================================
   PLANTILLAS DE DOCUMENTOS (vista previa editable → PDF)
   Calcadas de los modelos oficiales reales de la oficina.
   ================================================================ */

const LOGO_PRIS_ABS = "https://gestor-expedientes-pris.vercel.app/logo-pris.png";
const LOGO_GOB_ABS = "https://gestor-expedientes-pris.vercel.app/logo-gobierno.png";
const AZUL = "#5B9BD5";
const PIE_ANIO = '"2026 Año de la Memoria por: Golpe de Estado Cívico Militar de 1976, Cierre Masivo de los Ingenios en 1966 y Cierre de los Talleres Ferroviarios de Tafí Viejo en 1980"';

// Monto en letras (pesos argentinos) — misma lógica que en el servidor
function enteroALetras(n) {
  if (n === 0) return "cero";
  const u = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
    "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte"];
  const d = ["", "", "veinti", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
  const c = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
  function centenas(x) {
    if (x === 0) return "";
    if (x === 100) return "cien";
    let s = "";
    const ce = Math.floor(x / 100), resto = x % 100;
    if (ce) s += c[ce] + (resto ? " " : "");
    if (resto) {
      if (resto <= 20) s += u[resto];
      else {
        const de = Math.floor(resto / 10), un = resto % 10;
        if (de === 2) s += "veinti" + (un ? u[un] : "");
        else s += d[de] + (un ? " y " + u[un] : "");
        if (de === 2 && !un) s = s.replace("veinti", "veinte");
      }
    }
    return s;
  }
  const partes = [];
  const millones = Math.floor(n / 1000000);
  const miles = Math.floor((n % 1000000) / 1000);
  const resto = n % 1000;
  if (millones) partes.push(millones === 1 ? "un millón" : enteroALetras(millones) + " millones");
  if (miles) partes.push(miles === 1 ? "mil" : centenas(miles) + " mil");
  if (resto) partes.push(centenas(resto));
  return partes.join(" ").replace(/\s+/g, " ").trim();
}

function numeroALetras(n) {
  n = Math.round(Number(n) * 100) / 100;
  const entero = Math.floor(n);
  const centavos = Math.round((n - entero) * 100);
  let letras = enteroALetras(entero);
  if (/mill(ón|ones)$/.test(letras)) letras += " de";
  letras = letras.replace(/veintiuno$/, "veintiún").replace(/ uno$/, " un");
  letras = letras.charAt(0).toUpperCase() + letras.slice(1);
  return letras + " pesos con " + ("0" + centavos).slice(-2) + "/100";
}

function esc(t) {
  return String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Logos como data URI (para que salgan incrustados en el PDF)
let _logosCache = null;
async function obtenerLogos() {
  if (_logosCache) return _logosCache;
  const aDataUri = (url) =>
    fetch(url).then((r) => r.blob()).then((b) => new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(b);
    }));
  const [pris, gob] = await Promise.all([aDataUri("/logo-pris.png"), aDataUri("/logo-gobierno.png")]);
  _logosCache = { pris, gob };
  return _logosCache;
}

// El Word (.doc) no acepta imágenes incrustadas: se reemplazan por las URL públicas
function logosAUrl(body) {
  if (!_logosCache) return body;
  return body.split(_logosCache.pris).join(LOGO_PRIS_ABS).split(_logosCache.gob).join(LOGO_GOB_ABS);
}

function encabezadoDoc(logos) {
  return (
    '<table style="width:100%; border-collapse:collapse; margin-bottom:4pt;"><tr>' +
    '<td style="vertical-align:middle; border:none; padding:0;"><img src="' + logos.pris + '" style="height:34pt;"></td>' +
    '<td style="vertical-align:middle; text-align:right; border:none; padding:0;"><img src="' + logos.gob + '" style="height:44pt;"></td>' +
    "</tr></table>" +
    '<div style="border-bottom:2.2pt solid ' + AZUL + '; margin-bottom:6pt;"></div>'
  );
}

const lineaAzulDoc = (m) => '<div style="border-bottom:2.2pt solid ' + AZUL + '; margin-top:' + m + 'pt; margin-bottom:6pt;"></div>';

const envolverHtml = (css, body, apaisado) =>
  '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
  "@page { size: A4" + (apaisado ? " landscape" : "") + "; margin: 0; } body { margin:0; padding:0; } " +
  ".pagina { page-break-after: always; } .pagina.ultima { page-break-after: auto; } " +
  css + "</style></head><body>" + body + "</body></html>";

/* ---------- NOTA DE AFECTACIÓN (Times New Roman 12, formato del Word original) ---------- */

function plantillaNota(d, logos) {
  const letras = numeroALetras(d.monto);
  const moduloLimpio = limpiarModulo(d.modulo);
  const lineaModulo = /^m[oó]dulo/i.test(moduloLimpio) ? esc(moduloLimpio) : "Modulo de " + esc(moduloLimpio);
  // Prestaciones del módulo (sin precios): "Enfermería: 24hs por día", etc.
  const itemsNota = (d.items || []).filter((it) => it && it.nombre);
  const prestacionesHtml = itemsNota
    .map((it) => '<p style="margin-left:176pt; margin-top:2pt;">' + esc(it.nombre) + (it.cantTexto ? ": " + esc(it.cantTexto) : "") + "</p>")
    .join("");
  const impHtml = esc(d.imputacion)
    .replace(/Subp:\s*3\d\d/g, "<b>$&</b>")
    .replace(/Presupuesto\s*\d{4}/, "<b>$&</b>");
  const css =
    ".hoja { font-family:'Times New Roman', Times, serif; font-size:12pt; color:#000; } " +
    ".hoja .pagina { padding: 26pt 79pt 30pt 80pt; } .hoja p { margin:0; }";
  const body =
    '<div class="pagina ultima">' +
    encabezadoDoc(logos) +
    '<p style="margin-left:176pt; margin-top:14pt;">San Miguel de Tucumán, ' + esc(d.fechaTexto) + "</p>" +
    '<p style="margin-left:5pt; margin-top:20pt; line-height:1.5;">A la Sra. Directora<br>Programa Integrado de Salud<br>' +
    esc(d.directora) + '<br><b><span style="border-bottom:1.5pt solid #000;">Presente</span></b></p>' +
    '<p style="text-align:justify; text-indent:135pt; margin-left:5pt; line-height:1.5; margin-top:16pt;">' +
    "Me dirijo a usted a fines de informarle la afectación presupuestaria, en virtud de la prestación del servicio " +
    esc(moduloLimpio) + " correspondiente al paciente<b>; " + esc(d.paciente) + " </b>la cual solicita:</p>" +
    '<p style="margin-left:146pt; margin-top:12pt;">' + lineaModulo + (itemsNota.length ? ":" : "") + "</p>" +
    prestacionesHtml +
    '<p style="text-align:justify; text-indent:135pt; line-height:1.5; margin-top:14pt;">' +
    "Para los periodos de <b>" + esc(d.periodoTexto) + "</b>, por el importe total por " + esc(d.periodoMeses) +
    " meses de <b>" + esc(d.montoFormato) + "</b> (" + letras + ") a la " + impHtml + ".</p>" +
    ((Array.isArray(d.aclaracion) ? d.aclaracion : (d.aclaracion ? [d.aclaracion] : []))
      .map((_a) => '<p style="text-align:justify; text-indent:135pt; line-height:1.5; margin-top:10pt; font-family:Arial, Helvetica, sans-serif; font-style:italic;">«' + esc(_a) + '»</p>').join("")) +
    '<p style="margin-left:145pt; margin-top:22pt;">Sin otro motivo saludo atentamente.</p>' +
    '<p style="margin-left:5pt; margin-top:34pt; line-height:1.5; font-weight:bold;">Firmado digitalmente:<br>' +
    "C.P.N Mariela Agustina Castillo<br>Gerente Administrativo<br>Dirección Gral. Prog. Integrado de Salud<br>SI.PRO.SA</p>" +
    lineaAzulDoc(12) +
    '<p style="font-size:10pt; line-height:1.2; text-align:justify;">' + PIE_ANIO + "</p>" +
    "</div>";
  return {
    titulo: "NOTA AFECTACION PRESUPUESTARIA " + d.nroExpediente.replace(/\//g, "-"),
    css, body, montoLetras: letras,
  };
}

/* ---------- PASES (Auditoría Médica / Asesoría Letrada / Tribunal de Cuentas) ---------- */

function plantillaPase(d, logos) {
  const tipo = d.tipo;
  let css, cuerpo, titulo;

  if (tipo === "auditoria") {
    css =
      ".hoja { font-family: Arial, Helvetica, sans-serif; font-size:12pt; color:#000; } " +
      ".hoja .pagina { padding: 26pt 85pt 30pt 85pt; } .hoja p { margin:0; }";
    cuerpo =
      '<p style="text-align:right; margin-top:16pt;">San Miguel de Tucumán, ' + esc(d.fechaTexto) + "</p>" +
      '<p style="font-weight:bold; margin-top:26pt; line-height:1.6;">A la Jefa del Departamento<br>De Auditoria Médica<br>' +
      esc(d.destinataria) +
      '<br><span style="border-bottom:1.5pt solid #000;">S&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;D</span></p>' +
      '<p style="font-weight:bold; margin-left:135pt; margin-top:22pt; line-height:1.6;">REF: Expte. ' + esc(d.nroExpediente) +
      "<br>Paciente: " + esc(d.paciente) + "<br>" + esc(d.asunto || "Renovación Internación Domiciliaria") + "</p>" +
      '<p style="text-align:justify; text-indent:120pt; line-height:1.6; margin-top:24pt;">Me dirijo a usted a fin de solicitar intervención de competencia.</p>' +
      '<p style="text-align:justify; text-indent:120pt; line-height:1.6; margin-top:10pt;">Sin otro particular, saludo a Ud. atentamente.</p>' +
      '<p style="font-weight:bold; line-height:1.6; margin-top:70pt; margin-left:14pt;">Firmado digitalmente:<br>C.P.N. Mariela Agustina Castillo<br>Gerente Administrativo<br>Dirección Gral. Prog. Integrado de Salud<br>SI.PRO.SA.</p>' +
      lineaAzulDoc(14) +
      '<p style="font-family: Calibri, Arial, sans-serif; font-size:11pt; line-height:1.3; text-align:justify;">' + PIE_ANIO + "</p>";
    titulo = "PASE AUDITORIA MEDICA EXPTE " + d.nroExpediente.replace(/\//g, "-") + " " + d.paciente.toUpperCase();
  } else if (tipo === "letrada") {
    css =
      ".hoja { font-family: Arial, Helvetica, sans-serif; font-size:12pt; color:#000; } " +
      ".hoja .pagina { padding: 26pt 73pt 30pt 80pt; } .hoja p { margin:0; }";
    cuerpo =
      '<p style="text-align:right; margin-top:16pt;">San Miguel de Tucumán, ' + esc(d.fechaTexto) + "</p>" +
      '<p style="font-weight:bold; margin-top:30pt; line-height:1.6;">Oficina Asesoría Letrada<br>' +
      '<span style="border-bottom:2pt solid ' + AZUL + '; padding-bottom:1pt;">Presente</span></p>' +
      '<p style="text-align:justify; text-indent:100pt; line-height:1.18; margin-top:28pt;">' +
      "Pase a Asesoría Letrada para su intervención, de competencia, dicho gasto será imputado con cargo al presupuesto " +
      esc(d.anioPresupuesto) + "</p>" +
      '<p style="text-indent:150pt; line-height:1.18; margin-top:32pt;">Sin otro particular, saludo a Ud. atentamente.</p>' +
      '<p style="font-family:\'Times New Roman\', Times, serif; font-weight:bold; line-height:1.18; margin-top:245pt;">Firmado digitalmente:<br>C.P.N Mariela Agustina Castillo<br>Gerente Administrativo<br>Dirección Gral. Prog. Integrado de Salud<br>SI.PRO.SA</p>' +
      lineaAzulDoc(10) +
      '<p style="font-family:\'Times New Roman\', Times, serif; font-size:10pt; line-height:1.2; text-align:justify;">' + PIE_ANIO + "</p>";
    titulo = "PASE ASESORIA LETRADA " + d.nroExpediente.replace(/\//g, "-") + " " + d.paciente.toUpperCase();
  } else {
    css =
      ".hoja { font-family: Arial, Helvetica, sans-serif; font-size:12pt; color:#000; } " +
      ".hoja .pagina { padding: 30pt 80pt 30pt 85pt; } .hoja p { margin:0; }";
    cuerpo =
      '<p style="text-align:right; margin-top:22pt;">San Miguel de Tucumán, ' + esc(d.fechaTexto) + "</p>" +
      '<p style="font-weight:bold; margin-top:44pt; line-height:1.75;">Al Honorable Tribunal de Cuentas<br>De Gerencia Administrativa Contable</p>' +
      '<p style="font-weight:bold; line-height:1.75;"><span style="border-bottom:2pt solid ' + AZUL + '; padding-bottom:1pt;">Presente</span></p>' +
      '<p style="text-align:justify; text-indent:202pt; line-height:1.75; margin-top:36pt;">Me dirijo a Ud. a fin de solicitar intervención de competencia referente al <b>Expediente ' +
      esc(d.nroExpediente) + "</b>.</p>" +
      '<p style="text-align:justify; text-indent:202pt; line-height:1.75; margin-top:8pt;">Sin otro particular, saludo a Ud. atentamente.</p>' +
      '<p style="font-weight:bold; font-size:11pt; line-height:1.72; margin-top:64pt; margin-left:14pt;">Firmado digitalmente:<br>C.P.N. Mariela Agustina Castillo<br>Gerente Administrativo<br>Dirección Gral. Prog. Integrado de Salud<br>SI.PRO.SA.</p>' +
      lineaAzulDoc(14) +
      '<p style="font-family: Calibri, Arial, sans-serif; font-size:11pt; line-height:1.3; text-align:justify;">' + PIE_ANIO + "</p>";
    titulo = "PASE TRIBUNAL DE CUENTAS " + d.nroExpediente.replace(/\//g, "-") + " " + d.paciente.toUpperCase();
  }

  return { titulo, css, body: '<div class="pagina ultima">' + encabezadoDoc(logos) + cuerpo + "</div>" };
}

/* ---------- RESOLUCIÓN INTERNA (Times New Roman 12) ----------
   Dos modelos calcados de las resoluciones reales:
   - subModo "una": una subpartida (322 o 342), una tabla — modelo RES 3123
   - subModo "dos": subpartidas 322 y 342, dos firmas y dos tablas — modelo RES 3004
   El bloque POR ELLO y la firma cambian según quién firma (Directora o Gerente). */

function porElloHtml(firmante) {
  if (firmante === "gerente") {
    return (
      '<p style="text-align:center; font-weight:bold; margin-top:14pt;">POR ELLO:</p>' +
      '<p style="text-align:center; font-weight:bold;">LA GERENCIA ADMINISTRATIVA</p>' +
      '<p style="text-align:center; font-weight:bold;">DEL PROGRAMA INTEGRADO DE SALUD.</p>' +
      '<p style="text-align:center; font-weight:bold; text-decoration:underline;">RESUELVE:</p>'
    );
  }
  return (
    '<p style="text-align:center; font-weight:bold; margin-top:14pt;">POR ELLO: LA DIRECCION</p>' +
    '<p style="text-align:center; font-weight:bold;">DEL PROGRAMA INTEGRADO DE SALUD.</p>' +
    '<p style="text-align:center; font-weight:bold; text-decoration:underline;">RESUELVE:</p>'
  );
}

function firmaResolucionHtml(firmante) {
  const lineas = firmante === "gerente"
    ? "Firmado digitalmente:<br>C.P.N Mariela Agustina Castillo<br>Gerente Administrativo<br>Dirección Gral. Prog. Integrado de Salud<br>SI.PRO.SA."
    : "Firmado digitalmente:<br>Dra. Noelia Bottone<br>Dirección Gral. Prog. Integrado de Salud<br>SI.PRO.SA";
  return '<p style="font-weight:bold; line-height:1.75; margin-top:90pt; margin-left:5pt;">' + lineas + "</p>";
}

function plantillaResolucion(d, logos) {
  const q = "margin:0; text-align:justify; text-indent:105pt; line-height:1.18;";
  // Aclaración 30/31: va al final de los considerandos, entre comillas y con
  // tipografía distinta (Arial itálica) para que se identifique del resto.
  const aclara = (Array.isArray(d.aclaracionDias) ? d.aclaracionDias : (d.aclaracionDias ? [d.aclaracionDias] : []))
    .map((_a) => '<p style="' + q + ' font-family:Arial, Helvetica, sans-serif; font-style:italic;">«' + esc(_a) + '»</p>')
    .join("");
  const css =
    ".hoja { font-family:'Times New Roman', Times, serif; font-size:12pt; color:#000; } " +
    ".hoja .pagina { padding: 26pt 79pt 30pt 85pt; } .hoja p { margin:0; } .hoja td { font-size:12pt; }";
  const pac = esc(d.paciente).toUpperCase();
  const per = esc(d.periodoTexto || d.periodoMeses + " meses");
  const meses = esc(d.periodoMeses);

  let n = 1;
  const art = (texto, mt) =>
    '<p style="text-align:justify; line-height:1.18; margin-top:' + (mt || 14) + 'pt;"><b>ARTICULO ' + (n++) + 'º)</b> ' + texto + "</p>";

  const encabezadoRes =
    '<p style="text-align:right; margin-top:10pt;">San Miguel de Tucumán, ' + esc(d.fechaTexto) + "</p>" +
    '<p style="text-align:center; font-weight:bold; margin-top:14pt;">Resolución Interna: Nº ' + esc(d.nroResolucion) + "</p>" +
    '<p style="text-align:center; font-weight:bold; margin-top:14pt;">PROGRAMA INTEGRADO DE SALUD</p>';

  const cierreArticulos = () =>
    art("Pase a Control Pertinente del Honorable Tribunal de Cuentas en el Si.Pro.Sa.-") +
    art("Emitir la orden de compra respectiva.") +
    art("Comunicar y archivar.-", 20);

  const pieFinal =
    firmaResolucionHtml(d.firmante) +
    lineaAzulDoc(12) +
    '<p style="font-size:10pt; line-height:1.2; text-align:justify;">' + PIE_ANIO + "</p>";

  /* ========== MODELO MISMO PROVEEDOR, DOS SUBPARTIDAS (una firma, una tabla, imputación dividida) ========== */
  if (d.subModo === "dosMismo") {
    const meses6 = Number(d.periodoMeses || 6);
    const mensualUnico = Number(d.mensualUnico || 0) || (Number(d.mensualA || 0) + Number(d.mensualB || 0));
    const total = mensualUnico * meses6;
    const letras = numeroALetras(total);
    // Imputación SEPARADA: lo de internación va a la subpartida A (342) y lo de
    // alimentación a la B (322). Si no vinieran cargados, todo cae en la A.
    const mensualSubA = Number(d.mensualA || 0);
    const mensualSubB = Number(d.mensualB || 0);
    const totalSubA = (mensualSubA || mensualUnico) * meses6;
    const totalSubB = mensualSubB * meses6;
    const letrasSubA = numeroALetras(totalSubA);
    const letrasSubB = numeroALetras(totalSubB);
    const adj = esc(d.firmaA).toUpperCase();
    const mod = esc(moduloSinPeriodo(d.modulo, d.periodoTexto));

    const filaSrv = (detalle, mensual, totalM) =>
      "<tr>" +
      '<td style="border:1pt solid #000; padding:5pt 4pt 10pt;">' + esc(detalle).replace(/\n/g, "<br>") + "</td>" +
      '<td style="border:1pt solid #000; padding:5pt 4pt 10pt; text-align:center; font-weight:bold;">' + formatoPesos(mensual) + "</td>" +
      '<td style="border:1pt solid #000; padding:5pt 4pt 10pt; text-align:center; font-weight:bold;">' + formatoPesos(totalM) + "</td>" +
      "</tr>";

    const pag1 =
      '<div class="pagina">' + encabezadoDoc(logos) + encabezadoRes +
      '<p style="font-weight:bold; text-decoration:underline; margin-top:4pt;">VISTO:</p>' +
      '<p style="text-align:justify; text-indent:52pt; line-height:1.18;">El <b>Expediente N° ' + esc(d.nroExpediente) +
      "</b>, en el que se solicita " + esc(d.tipoTramite) + " de servicios de " + mod +
      ", para el paciente; <b>" + pac + "</b> según lo indicado a fs. " + esc(d.fsSolicitud) + ". Y,</p>" +
      '<p style="font-weight:bold; text-decoration:underline; margin-top:14pt;">CONSIDERANDO:</p>' +
      '<p style="' + q + '">Que se solicita ' + esc(d.tipoTramite) + " de servicios de " + mod +
      ", para el paciente; <b>" + pac + "</b>; por el <b>periodo de " + per + "</b>.</p>" +
      '<p style="' + q + '">Que a fs. ' + esc(d.fsPresupuesto) + " se adjunta presupuesto del proveedor, correspondiente al <b>periodo de " +
      per + "</b> (" + meses + " meses). --------------------------------------</p>" +
      '<p style="' + q + '">Que a fs. ' + esc(d.fsCuadro) + " se adjunta Cuadro Comparativo, con la Adjudicación al Proveedor <b>" + adj +
      "</b> (módulos de internación domiciliaria y módulo de alimentación domiciliaria), correspondiente a los periodos de <b>" + per + "</b>.</p>" +
      '<p style="' + q + '">Que a fs. ' + esc(d.fsDictamen) + " se adjunta dictamen de auditoría médica, autorizando la prestación.</p>" +
      '<p style="' + q + '">Que obra informe jurídico favorable a la contratación. ---------------</p>' +
      '<p style="' + q + '">Que por lo expuesto, no existen objeciones legales que formular para que la Gerencia Administrativa Contable del Programa Integrado de Salud, en virtud de razones de urgencia invocadas, contrate con la firma <b>' +
      adj + "</b>, la adquisición del servicio de Internación Domiciliaria y Módulo de alimentación domiciliaria, bajo la figura de Contratación Directa de conformidad a lo normado por la Res. N°388/SPS/-05.</p>" +
      aclara + porElloHtml(d.firmante) +
      art("ADJUDICAR a la firma <b>" + adj + "</b>, la provisión de los siguientes servicios:") +
      '<table style="width:100%; border-collapse:collapse; margin-top:8pt;"><tr>' +
      '<td style="border:1pt solid #000; padding:2pt 4pt; width:52%;">SERVICIO</td>' +
      '<td style="border:1pt solid #000; padding:2pt 4pt; width:22%;">PRECIO POR MES</td>' +
      '<td style="border:1pt solid #000; padding:2pt 4pt; width:26%;">PRECIO TOTAL POR ' + meses + " MESES</td>" +
      "</tr>" +
      filaSrv(d.detalleUnico || d.detalleA, mensualUnico, total) +
      "</table></div>";

    const pag2 =
      '<div class="pagina ultima">' + encabezadoDoc(logos) +
      '<p style="text-align:justify; line-height:1.18; margin-top:12pt;">Por un monto total por ' + meses + " meses <b>" +
      formatoPesos(total) + "</b> (" + letras + "). Dicho servicio comprenderá a partir de la fecha de la orden de compra, comprendiendo desde los Meses de <b>" + per + "</b>.</p>" +
      '<p style="text-align:justify; line-height:1.18; margin-top:14pt;"><b>ARTICULO ' + (n++) + 'º)</b> ' +
      "Imputar a <b>Subpartida " + esc(d.subA) + "</b> la suma de <b>" + formatoPesos(totalSubA) + "</b> (" + letrasSubA +
      ") correspondiente al servicio de Internación Domiciliaria, para la firma <b>" + adj + "</b> (por " + meses + " meses).</p>" +
      '<p style="text-align:justify; line-height:1.18; margin-top:0; text-indent:88pt;">' +
      "Imputar a <b>Subpartida " + esc(d.subB) + "</b> la suma de <b>" + formatoPesos(totalSubB) + "</b> (" + letrasSubB +
      ") correspondiente al Módulo de Alimentación domiciliaria, para la firma <b>" + adj + "</b> (por " + meses + " meses)" +
      "; a Jurisdicción 67 - Unid. Org. 965 - Recurso 10 - Finalidad/Función 314 - Programa 19 - Actividad 01 - Partida 300 - con cargo al <b>Presupuesto del año " + esc(d.anioPresupuesto) + "</b>.</p>" +
      cierreArticulos() +
      pieFinal +
      "</div>";

    return {
      titulo: "RESOLUCION " + String(d.nroResolucion || "").replace(/\//g, "-") + " EXPTE " +
        d.nroExpediente.replace(/\//g, "-") + " " + d.paciente.toUpperCase(),
      css, body: pag1 + pag2, montoLetras: letras,
    };
  }

  /* ===================== MODELO DOBLE (322 y 342 — RES 3004) ===================== */
  if (d.subModo === "dos") {
    const totalA = Number(d.mensualA || 0) * Number(d.periodoMeses || 6);
    const totalB = Number(d.mensualB || 0) * Number(d.periodoMeses || 6);
    const total = totalA + totalB;
    const letras = numeroALetras(total);
    const letrasA = numeroALetras(totalA);
    const firmas = esc(d.firmaA).toUpperCase() + " Y " + esc(d.firmaB).toUpperCase();

    const tabla = (titulo, detalle, mensual, totalM) =>
      '<table style="width:100%; border-collapse:collapse; margin-top:10pt;"><tr>' +
      '<td style="border:1pt solid #000; padding:2pt 4pt; width:52%;">' + esc(titulo) + "</td>" +
      '<td style="border:1pt solid #000; padding:2pt 4pt; width:22%;">PRECIO POR MES</td>' +
      '<td style="border:1pt solid #000; padding:2pt 4pt; width:26%;">PRECIO TOTAL POR ' + meses + " MESES</td>" +
      "</tr><tr>" +
      '<td style="border:1pt solid #000; padding:6pt 4pt 12pt;">' + esc(detalle).replace(/\n/g, "<br>") + "</td>" +
      '<td style="border:1pt solid #000; padding:6pt 4pt 12pt; text-align:center; font-weight:bold;">' + formatoPesos(mensual) + "</td>" +
      '<td style="border:1pt solid #000; padding:6pt 4pt 12pt; text-align:center; font-weight:bold;">' + formatoPesos(totalM) + "</td>" +
      "</tr></table>";

    const pag1 =
      '<div class="pagina">' + encabezadoDoc(logos) + encabezadoRes +
      '<p style="font-weight:bold; text-decoration:underline; margin-top:4pt;">VISTO:</p>' +
      '<p style="text-align:justify; text-indent:52pt; line-height:1.18;">El <b>Expediente N° ' + esc(d.nroExpediente) +
      "</b>, en cual se solicita la <b>" + esc(d.tipoTramite) + "</b> de las prestaciones brindadas de " + esc(d.detalleVisto) +
      " para el paciente, <b>" + pac + "</b>. Y,</p>" +
      '<p style="font-weight:bold; text-decoration:underline; margin-top:14pt;">CONSIDERANDO:</p>' +
      '<p style="' + q + '">Que se solicita la provisión de Servicio de Internación Domiciliaria, modulo: ' + esc(d.detalleModulo) +
      " para el paciente, <b>" + pac + "</b> para los <b>periodos de " + per + "</b>.</p>" +
      '<p style="' + q + '">Que a fs. ' + esc(d.fsSolicitud) +
      " se adjunta copia del pedido y recetas médicas del Expediente, en el cual se especifican Solicitud del servicio, Recetas.</p>" +
      '<p style="' + q + '">Que a fs ' + esc(d.fsPresupuesto) + " se adjunta presupuestos proveedores (" +
      esc(d.firmaA).toLowerCase() + "-" + esc(d.firmaB).toLowerCase() + ").</p>" +
      '<p style="' + q + '">Que a fs ' + esc(d.fsCuadro) + " se adjunta cuadro comparativo de adjudicación al proveedor " +
      esc(d.firmaA) + " y " + esc(d.firmaB) +
      " (módulos de internación domiciliaria y módulo de alimentación domiciliaria; para los periodos comprendidos <b>" + per + "</b>).</p>" +
      '<p style="' + q + '">Que a fs ' + esc(d.fsDictamen) + " obra Informe de Auditoría Médica.</p>" +
      '<p style="' + q + '">Que obra informe jurídico favorable a la contratación.</p>' +
      '<p style="' + q + '">Que, por lo expuesto, no existen objeciones legales que formular para que la Gerencia Administrativa ' +
      "Contable del Programa Integrado de Salud, en virtud de razones de urgencia invocadas, contrate con la firma <b>" + firmas +
      "</b>., la adquisición del servicio de Internación Domiciliaria y Modulo de alimentación domiciliaria, bajo la figura de " +
      "Contratación Directa de conformidad a lo normado por la Res. N°388/SPS/-05.</p>" +
      aclara + porElloHtml(d.firmante) +
      art("ADJUDICAR a las firmas comerciales <b>" + firmas + "</b>, la provisión de los siguientes servicios:") +
      tabla(d.tituloA, d.detalleA, d.mensualA, totalA) +
      "</div>";

    const pag2 =
      '<div class="pagina ultima">' + encabezadoDoc(logos) +
      tabla(d.tituloB, d.detalleB, d.mensualB, totalB) +
      '<p style="text-align:justify; line-height:1.18; margin-top:14pt;">Por un monto total por ' + meses + " meses <b>" +
      formatoPesos(total) + "</b> (" + letras + "). Dicho servicio comprenderá a partir de la fecha de la orden de compra, " +
      "comprendiendo desde los Meses de <b>" + per + "</b>.</p>" +
      art("Imputar a <b>Subpartida " + esc(d.subA) + "</b> la suma de <b>" + formatoPesos(totalA) + "</b> (" + letrasA +
        ") para <b>" + esc(d.firmaA).toUpperCase() + "</b> (por " + meses + " meses).<br>" +
        "Imputar a <b>Subpartida " + esc(d.subB) + "</b> la suma de <b>" + formatoPesos(totalB) + "</b> para <b>" +
        esc(d.firmaB).toUpperCase() + "</b> (por " + meses + " meses); a Jurisdicción 67 - Unid. Org. 965 - Recurso 10 - " +
        "Finalidad/Función 314 - Programa 19 - Actividad 01 - Partida 300 - con cargo al <b>Presupuesto del año " + esc(d.anioPresupuesto) + "</b>.") +
      cierreArticulos() +
      pieFinal +
      "</div>";

    return {
      titulo: "RESOLUCION " + String(d.nroResolucion || "").replace(/\//g, "-") + " EXPTE " +
        d.nroExpediente.replace(/\//g, "-") + " " + d.paciente.toUpperCase(),
      css, body: pag1 + pag2, montoLetras: letras,
    };
  }

  /* ===================== MODELO SIMPLE (una subpartida — RES 3123) ===================== */
  const letras = numeroALetras(d.total);
  const mod = esc(moduloSinPeriodo(d.modulo, d.periodoTexto));
  const adj = esc(d.adjudicado).toUpperCase();
  const monto = formatoPesos(d.total);

  const pag1 =
    '<div class="pagina">' + encabezadoDoc(logos) + encabezadoRes +
    '<p style="font-weight:bold; text-decoration:underline; margin-top:4pt;">VISTO:</p>' +
    '<p style="text-align:justify; text-indent:52pt; line-height:1.18;">El <b>Expediente N° ' + esc(d.nroExpediente) +
    "</b>, en el que se solicita " + esc(d.tipoTramite) + " de servicios de " + mod +
    ", para el paciente; <b>" + pac + "</b> según lo indicado a fs. " + esc(d.fsSolicitud) + ". Y,</p>" +
    '<p style="font-weight:bold; text-decoration:underline; margin-top:14pt;">CONSIDERANDO:</p>' +
    '<p style="' + q + '">Que se solicita ' + esc(d.tipoTramite) + " de servicios de " + mod +
    ", para el paciente; <b>" + pac + "</b>; por el <b>periodo de " + per + "</b>.</p>" +
    '<p style="' + q + '">Que a fs. ' + esc(d.fsPresupuesto) + " se adjunta presupuesto del proveedor, correspondiente al <b>periodo de " +
    per + "</b> (" + meses + " meses). --------------------------------------</p>" +
    '<p style="' + q + '">Que a fs. ' + esc(d.fsCuadro) + " se adjunta Cuadro Comparativo, con la Adjudicación al Proveedor <b>" + adj +
    "</b>, correspondiente a los periodos de <b>" + per + "</b>.</p>" +
    '<p style="' + q + '">Que a fs. ' + esc(d.fsDictamen) + " se adjunta dictamen de auditoría médica, autorizando la prestación.</p>" +
    '<p style="' + q + '">Que obra informe jurídico favorable a la contratación. ---------------</p>' +
    '<p style="' + q + '">Que por lo expuesto, no existen objeciones legales que formular para que la Gerencia Administrativa Contable del Programa Integrado de Salud, en virtud de razones de urgencia invocadas, contrate con la firma <b>' +
    adj + "</b>, la adquisición del servicio de " + mod +
    ", bajo la figura de Contratación Directa de conformidad a lo normado por la Res. N°388/SPS/-05.</p>" +
    aclara + porElloHtml(d.firmante) +
    art("ADJUDICAR a la firma <b>" + adj + "</b>, la provisión del siguiente servicio:") +
    '<table style="width:100%; border-collapse:collapse; margin-top:8pt;"><tr>' +
    '<td style="border:1pt solid #000; padding:2pt 4pt; width:52%;">SERVICIO</td>' +
    '<td style="border:1pt solid #000; padding:2pt 4pt; width:22%;">PRECIO POR MES</td>' +
    '<td style="border:1pt solid #000; padding:2pt 4pt; width:26%;">PRECIO TOTAL POR ' + meses + " MESES</td>" +
    "</tr><tr>" +
    '<td style="border:1pt solid #000; padding:6pt 4pt 14pt;">' + mod + "</td>" +
    '<td style="border:1pt solid #000; padding:6pt 4pt 14pt; text-align:center; font-weight:bold;">' + formatoPesos(d.mensual) + "</td>" +
    '<td style="border:1pt solid #000; padding:6pt 4pt 14pt; text-align:center; font-weight:bold;">' + monto + "</td>" +
    "</tr></table></div>";

  const pag2 =
    '<div class="pagina ultima">' + encabezadoDoc(logos) +
    '<p style="text-align:justify; line-height:1.18; margin-top:12pt;">Por un monto total por ' + meses +
    " meses <b>" + monto + "</b> (" + letras + "). Dicho servicio comprenderá a partir de la fecha de la orden de compra, comprendiendo desde los Meses de <b>" + per + "</b>.</p>" +
    art("Imputar dicha suma <b>" + monto + "</b> (" + letras + ") a " + esc(d.imputacion) +
      ", con cargo al <b>Presupuesto del año " + esc(d.anioPresupuesto) + "</b>.") +
    cierreArticulos() +
    pieFinal +
    "</div>";

  return {
    titulo: "RESOLUCION " + String(d.nroResolucion || "").replace(/\//g, "-") + " EXPTE " +
      d.nroExpediente.replace(/\//g, "-") + " " + d.paciente.toUpperCase(),
    css, body: pag1 + pag2, montoLetras: letras,
  };
}

/* ---------- CUADRO COMPARATIVO: PDF fabricado en el navegador con pdf-lib ----------
   Sin conversor de por medio: los grises del ganador y los logos quedan grabados
   en los bytes del archivo. Requiere /public/pdf-lib.min.js cargado en index.html. */

// GENERADOR DEL PDF DEL CUADRO COMPARATIVO CON pdf-lib
// (idéntico en Node para pruebas y en el navegador vía window.PDFLib)
async function crearPdfCuadro(PDFLib, d, prisBytes, gobBytes) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  const page = doc.addPage([842, 595]); // A4 apaisado
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold);
  const timesB = await doc.embedFont(StandardFonts.TimesRomanBold);

  const NEGRO = rgb(0, 0, 0);
  const GRIS_GANA = rgb(231 / 255, 230 / 255, 230 / 255);   // #E7E6E6
  const GRIS_GANA_H = rgb(217 / 255, 217 / 255, 217 / 255); // #D9D9D9
  const GRIS_ENC = rgb(242 / 255, 242 / 255, 242 / 255);    // #F2F2F2
  const GRIS_MOD = rgb(226 / 255, 232 / 255, 240 / 255);    // encabezado de módulo

  const MX = 30;              // margen izquierdo
  let y = 595 - 26;           // cursor vertical (desde arriba)

  // ---- logos a la par ----
  const pris = await doc.embedPng(prisBytes);
  const gob = await doc.embedPng(gobBytes);
  const hP = 26, wP = (pris.width / pris.height) * hP;
  const hG = 32, wG = (gob.width / gob.height) * hG;
  const topLogos = Math.max(hP, hG);
  page.drawImage(pris, { x: MX, y: y - topLogos + (topLogos - hP) / 2, width: wP, height: hP });
  page.drawImage(gob, { x: MX + wP + 16, y: y - topLogos + (topLogos - hG) / 2, width: wG, height: hG });
  y -= topLogos + 9;

  // ---- helpers de texto ----
  const partir = (texto, font, size, maxW) => {
    const palabras = String(texto || "").split(/\s+/).filter(Boolean);
    const lineas = [];
    let actual = "";
    palabras.forEach((p) => {
      const prueba = actual ? actual + " " + p : p;
      if (font.widthOfTextAtSize(prueba, size) <= maxW || !actual) actual = prueba;
      else { lineas.push(actual); actual = p; }
    });
    if (actual) lineas.push(actual);
    return lineas.length ? lineas : [""];
  };
  const centrado = (texto, font, size, cx, cy) => {
    page.drawText(texto, { x: cx - font.widthOfTextAtSize(texto, size) / 2, y: cy, size, font, color: NEGRO });
  };
  // Achica el texto hasta que entre en el ancho pedido (para nombres largos)
  const encoger = (texto, font, size, maxW) => {
    let s = size;
    while (s > 5 && font.widthOfTextAtSize(String(texto), s) > maxW) s -= 0.25;
    return s;
  };

  // ---- título en dos líneas (la fecha de adjudicación abajo, alineada con el EXPTE) ----
  const tituloL1 = "EXPTE : " + d.nroExpediente + " - PTE " + d.paciente.toUpperCase() +
    (d.periodoTexto ? " (Periodo que corresponde a " + d.periodoTexto + ")" : "");
  const lineasTitulo = partir(tituloL1, helvB, 8.5, 640);
  lineasTitulo.push("fecha de Adjudicacion " + d.fechaCorta);
  lineasTitulo.forEach((l) => {
    page.drawText(l, { x: MX, y: y - 8.5, size: 8.5, font: helvB, color: NEGRO });
    y -= 11.5;
  });
  y -= 4;

  // ---- datos de módulos y adjudicación ----
  const items = d.items && d.items.length ? d.items : [{ nombre: d.modulo || "", cantTexto: "", cantNum: "" }];
  const modulos = modulosDeItems(items);
  const multi = modulos.length > 1;
  const adjs = d.adjudicaciones && d.adjudicaciones.length
    ? d.adjudicaciones
    : [{ modulo: modulos[0], proveedor: (d.adjudicado && d.adjudicado.nombre) || "", mensual: 0 }];
  const ganadorDe = (mod) => { const a = adjs.find((x) => x.modulo === mod); return a ? a.proveedor : ""; };
  const ganaAlgo = (nombre) => adjs.some((a) => a.proveedor === nombre);

  // ---- geometría de la tabla (los anchos se achican si hay muchos proveedores) ----
  const responden = (d.proveedores || []).filter((p) => p.estado !== "sin_respuesta");
  const ANCHO_UTIL = 842 - MX * 2;
  const wDetalle = [88, 42, 30];
  const wPar = Math.max(30, Math.min(50, Math.floor((ANCHO_UTIL - 160) / (2 * Math.max(responden.length, 1)))));
  const anchos = wDetalle.slice();
  responden.forEach(() => { anchos.push(wPar, wPar); });
  const xCols = [MX];
  anchos.forEach((a) => xCols.push(xCols[xCols.length - 1] + a));
  const anchoTabla = xCols[xCols.length - 1] - MX;

  const F = 8;          // fuente de la tabla
  const LH = 9.6;       // alto de línea

  const celda = (col, yTop, alto, lineas, font, fondo) => {
    const x = xCols[col], w = anchos[col];
    if (fondo) page.drawRectangle({ x, y: yTop - alto, width: w, height: alto, color: fondo });
    page.drawRectangle({ x, y: yTop - alto, width: w, height: alto, borderColor: NEGRO, borderWidth: 0.75 });
    const totalTxt = lineas.length * LH;
    let ty = yTop - (alto - totalTxt) / 2 - LH + 2.4;
    lineas.forEach((l) => {
      const s = encoger(l, font, F, w - 3);
      page.drawText(String(l), { x: x + w / 2 - font.widthOfTextAtSize(String(l), s) / 2, y: ty, size: s, font, color: NEGRO });
      ty -= LH;
    });
  };
  const celdaCombinada = (colIni, nCols, yTop, alto, texto, font, fondo, alineIzq) => {
    const x = xCols[colIni];
    let w = 0;
    for (let k = 0; k < nCols; k++) w += anchos[colIni + k];
    if (fondo) page.drawRectangle({ x, y: yTop - alto, width: w, height: alto, color: fondo });
    page.drawRectangle({ x, y: yTop - alto, width: w, height: alto, borderColor: NEGRO, borderWidth: 0.75 });
    const s = encoger(texto, font, F, w - 8);
    const ty = yTop - alto / 2 - 2.8;
    if (alineIzq) page.drawText(String(texto), { x: x + 4, y: ty, size: s, font, color: NEGRO });
    else page.drawText(String(texto), { x: x + w / 2 - font.widthOfTextAtSize(String(texto), s) / 2, y: ty, size: s, font, color: NEGRO });
  };

  // ---- fila 1: DETALLE SOLICITADO + proveedores ----
  const h1 = 12;
  celdaCombinada(0, 3, y, h1, "DETALLE SOLICITADO", helvB, GRIS_ENC);
  responden.forEach((p, i) => {
    celdaCombinada(3 + i * 2, 2, y, h1, p.nombre.toUpperCase(), helvB, ganaAlgo(p.nombre) ? GRIS_GANA_H : GRIS_ENC);
  });
  y -= h1;

  // ---- fila 2: encabezados de columnas ----
  const h2 = 30;
  celda(0, y, h2, ["PRESTACION"], helvB, null);
  celda(1, y, h2, ["CANTIDAD"], helvB, null);
  celda(2, y, h2, partir("CANT DE HS/SES.", helvB, F, anchos[2] - 4), helvB, null);
  responden.forEach((p, i) => {
    const g = ganaAlgo(p.nombre) && !multi;
    celda(3 + i * 2, y, h2, ["P.", "UNITARIO"], helvB, g ? GRIS_GANA : null);
    celda(4 + i * 2, y, h2, ["P.", "MENSUAL"], helvB, g ? GRIS_GANA : null);
  });
  y -= h2;

  // ---- filas de ítems, agrupadas por módulo ----
  const nCols = anchos.length;
  const dibujarItem = (it, idx, mod) => {
    const lN = partir(it.nombre, helv, F, anchos[0] - 6);
    const lC = partir(it.cantTexto || "", helv, F, anchos[1] - 6);
    const alto = Math.max(lN.length, lC.length, 1) * LH + 6;
    celda(0, y, alto, lN, helv, null);
    celda(1, y, alto, lC, helv, null);
    celda(2, y, alto, [String(it.cantNum || "")], helv, null);
    const primeroDelModulo = itemsDelModulo(items, mod)[0];
    const esPrimero = primeroDelModulo && primeroDelModulo.i === idx;
    responden.forEach((p, i) => {
      const gana = ganadorDe(mod) === p.nombre;
      const fondo = gana ? GRIS_GANA : null;
      const inf = infoModulo(p, mod);
      if (p.estado !== "cotizo" || inf.noCotiza) {
        celda(3 + i * 2, y, alto, [esPrimero ? "NO COTIZÓ" : ""], helvB, fondo);
        celda(4 + i * 2, y, alto, [""], helv, fondo);
      } else if (inf.modo === "modulo") {
        celda(3 + i * 2, y, alto, esPrimero ? partir(inf.leyenda || "COTIZA POR MODULO", helv, F, anchos[3] - 4) : [""], helv, fondo);
        celda(4 + i * 2, y, alto, [""], helv, fondo);
      } else {
        const pi = (p.items || [])[idx] || {};
        celda(3 + i * 2, y, alto, [pi.unitario != null && pi.unitario !== "" ? d.fmt(pi.unitario) : ""], helvB, fondo);
        celda(4 + i * 2, y, alto, [pi.mensual != null && pi.mensual !== "" ? d.fmt(pi.mensual) : ""], helvB, fondo);
      }
    });
    y -= alto;
  };

  if (!multi) {
    // ---- comportamiento de siempre: un solo bloque ----
    items.forEach((it, idx) => dibujarItem(it, idx, modulos[0]));
    if (items.length > 1) {
      const hT = 13;
      celdaCombinada(0, 3, y, hT, "TOTAL MENSUAL", helvB, null);
      responden.forEach((p, i) => {
        const fondo = ganaAlgo(p.nombre) ? GRIS_GANA : null;
        const st = subtotalModulo(p, items, modulos[0]);
        celda(3 + i * 2, y, hT, [""], helv, fondo);
        celda(4 + i * 2, y, hT, [st != null ? d.fmt(st) : ""], helvB, fondo);
      });
      y -= hT;
    }
  } else {
    // ---- un bloque por módulo, con su subtotal y su firma adjudicada ----
    modulos.forEach((mod) => {
      const hM = 13;
      const gan = ganadorDe(mod);
      celdaCombinada(0, nCols, y, hM,
        "MODULO: " + (mod || "SIN MODULO").toUpperCase() + (gan ? "   —   ADJUDICADO A: " + gan.toUpperCase() : ""),
        helvB, GRIS_MOD, true);
      y -= hM;
      itemsDelModulo(items, mod).forEach(({ it, i }) => dibujarItem(it, i, mod));
      const hS = 13;
      celdaCombinada(0, 3, y, hS, "SUBTOTAL MENSUAL", helvB, null);
      responden.forEach((p, i) => {
        const fondo = gan === p.nombre ? GRIS_GANA : null;
        const st = subtotalModulo(p, items, mod);
        celda(3 + i * 2, y, hS, [""], helv, fondo);
        celda(4 + i * 2, y, hS, [st != null ? d.fmt(st) : ""], helvB, fondo);
      });
      y -= hS;
    });
    const hTot = 14;
    const totalAdj = adjs.reduce((s, a) => s + (Number(a.mensual) || 0), 0);
    celdaCombinada(0, nCols, y, hTot, "TOTAL MENSUAL ADJUDICADO:  " + d.fmt(totalAdj), helvB, GRIS_GANA_H, true);
    y -= hTot;
  }

  // ---- bloque final: adjudicación(es), constancia y firma ----
  // Se mide todo antes de dibujar y, si no entra, se comprimen los espacios
  // (con un solo módulo sobra lugar y no se comprime nada: sale igual que siempre).
  const textos = (d.textosAdjudicacion && d.textosAdjudicacion.length)
    ? d.textosAdjudicacion.filter(Boolean)
    : [d.textoAdjudicacion].filter(Boolean);
  const wAdj = Math.min(Math.max(anchoTabla, 300), 460);
  const bloques = textos.map((t) => partir(t, helv, F, wAdj - 10));
  const lConst = partir(d.textoConstancia, helv, F, Math.min(Math.max(anchoTabla, 300), 460));
  const lFirma = ["Firmado digitalmente:", "C.P.N Mariela Agustina Castillo", "Gerente Administrativo",
                  "Dirección Gral. Prog. Integrado de Salud", "SI.PRO.SA"];

  let gapTop = 14, gapAdj = 9, gapConst = 2, gapFirma = 16, firmaPaso = 16, firmaSize = 11;
  const altoPie = () =>
    gapTop + bloques.reduce((s, b) => s + b.length * LH + 8 + gapAdj, 0) +
    gapConst + lConst.length * LH + gapFirma + lFirma.length * firmaPaso;
  const entra = () => y - altoPie() >= 6;
  while (!entra() && firmaPaso > 11.5) { firmaPaso -= 0.5; firmaSize = Math.max(8.5, firmaSize - 0.12); }
  while (!entra() && gapFirma > 6) { gapFirma -= 1; }
  while (!entra() && gapAdj > 3) { gapAdj -= 0.5; }
  while (!entra() && gapTop > 5) { gapTop -= 1; }

  y -= gapTop;
  bloques.forEach((lAdj) => {
    const hAdj = lAdj.length * LH + 8;
    page.drawRectangle({ x: MX, y: y - hAdj, width: wAdj, height: hAdj, color: GRIS_ENC });
    let ty = y - LH + 1;
    lAdj.forEach((l) => { page.drawText(l, { x: MX + 5, y: ty - 3, size: F, font: helv, color: NEGRO }); ty -= LH; });
    y -= hAdj + gapAdj;
  });
  y -= gapConst;

  lConst.forEach((l) => { page.drawText(l, { x: MX, y: y - 6, size: F, font: helv, color: NEGRO }); y -= LH; });

  y -= gapFirma;
  lFirma.forEach((l) => {
    page.drawText(l, { x: MX, y: y - 9, size: firmaSize, font: timesB, color: NEGRO });
    y -= firmaPaso;
  });

  return doc.save();
}

// Bytes de los logos para el generador de PDF (con caché)
let _logosBytesCache = null;
async function obtenerLogosBytes() {
  if (_logosBytesCache) return _logosBytesCache;
  const [pris, gob] = await Promise.all([
    fetch("/logo-pris.png").then((r) => r.arrayBuffer()),
    fetch("/logo-gobierno.png").then((r) => r.arrayBuffer()),
  ]);
  _logosBytesCache = { pris, gob };
  return _logosBytesCache;
}

function descargarBytes(bytes, nombre) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Convierte los bytes de un PDF (Uint8Array de pdf-lib) a base64, por bloques
// para no reventar la pila con archivos grandes. Se usa para adjuntar el
// cuadro comparativo en el mail al proveedor.
function bytesABase64(bytes) {
  let binario = "";
  const bloque = 0x8000;
  for (let i = 0; i < bytes.length; i += bloque) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + bloque));
  }
  return btoa(binario);
}

/* ---------- Datos por defecto de cada documento (para generar y para revisar de nuevo) ---------- */

// Saca el "Solicita / Solicita Renovación de" inicial del módulo al citarlo en los documentos
const limpiarModulo = (m) => String(m || "").replace(/^solicita\s+(la\s+)?/i, "").trim();

// Quita del nombre del módulo el período que ya se menciona en la misma frase
const moduloSinPeriodo = (m, periodo) => {
  let t = limpiarModulo(m);
  const p = String(periodo || "").trim();
  if (p) {
    const escapado = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
    t = t.replace(new RegExp("\\s*[-–(]?\\s*" + escapado + "\\s*\\)?", "i"), " ");
  }
  return t.replace(/\s{2,}/g, " ").replace(/[\s,;-]+$/, "").trim();
};

const imputacionNotaPorSubpartida = (sub) => {
  const subTxt = sub === "342" ? "Subp: 342" : sub === "ambas" ? "Subp: 322 y Subp: 342" : "Subp: 322";
  return "Jur: 67, U.O: 965, Fin/Fun: 314, Proy: 00, Subp: 00, Progr: 19, A/OB: 01, Part. Ppal.: 300, " + subTxt +
    " – Fuente de financiamiento Nº 10 – Recursos Tesoro General de la Provincia – Presupuesto " + new Date().getFullYear();
};

const IMPUTACION_NOTA_DEFECTO =
  "Jur: 67, U.O: 965, Fin/Fun: 314, Proy: 00, Subp: 00, Progr: 19, A/OB: 01, Part. Ppal.: 300, Subp: 322 – Fuente de financiamiento Nº 10 – Recursos Tesoro General de la Provincia – Presupuesto " + new Date().getFullYear();
const imputacionResolucionPorSubpartida = (sub) =>
  "Jurisdicción 67 - Unid. Org. 965 - Recurso 10 - Finalidad/Función 314 - Programa 19 - Actividad 01 - Partida 300 - Subpartida " + (sub || "322");

const IMPUTACION_RESOLUCION_DEFECTO =
  "Jurisdicción 67 - Unid. Org. 965 - Recurso 10 - Finalidad/Función 314 - Programa 19 - Actividad 01 - Partida 300 - Subpartida 322";

function fechaCortaHoy() {
  const d = new Date();
  return ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" + d.getFullYear();
}

function fechaLargaHoy() {
  const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const d = new Date();
  return d.getDate() + " de " + meses[d.getMonth()] + " de " + d.getFullYear();
}

// Días en letras (rango realista de un mes) para la aclaración 30/31.
function diasEnLetras(n) {
  const m = { 28: "veintiocho", 29: "veintinueve", 30: "treinta", 31: "treinta y uno" };
  return m[n] || String(n);
}

// ¿El texto refiere al módulo de Alimentación? (tolerante a acentos/mayúsculas)
function _esAlim(s) {
  return _norm(s || "").includes("aliment");
}
// Primer número entero que aparece en un texto ("31 días" → 31; "Enteral" → null).
function _enteroDe(s) {
  const m = String(s || "").match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/* ---------- Derivación automática del cálculo de afectación ----------
   Arma el objeto que la nota y la resolución necesitan (mismo shape que el
   viejo Paso 3), a partir del DICTAMEN (días de Alimentación) y de lo ADJUDICADO
   en el cuadro (precio diario de Alimentación + mensual de Internación). No pide
   panel: se calcula solo. Si hay un cálculo guardado a mano, ese SIEMPRE gana.
   Convención: Alimentación se paga por día → mensual = precio diario × días del
   dictamen (tope 31); Internación = resto del total adjudicado, mensual fijo. */
function derivarCalculoAfectacion(exp) {
  if (!exp) return null;
  const items = exp.itemsPrestacion || [];
  if (!items.length) return null;

  // 1) Ubicar el ítem de Alimentación (por nombre o por módulo).
  const iAlim = items.findIndex((it) => _esAlim(it?.nombre) || _esAlim(it?.modulo));
  if (iAlim < 0) return null; // sin Alimentación → no hay cálculo por días (cae a mensual × meses)
  const itAlim = items[iAlim];
  const modAlim = (itAlim.modulo && String(itAlim.modulo).trim()) || MODULO_SIN_NOMBRE;
  const meses = Number(exp.periodoMeses || 6) || 6;

  // 2) Días autorizados: de la fila Alimentación del dictamen (tope 31). Si no hay
  //    número, del cantTexto del ítem. Si tampoco, no podemos afirmar los días.
  const filaDict = (exp.dictamen?.prestaciones || []).find((p) => _esAlim(p?.nombre));
  let dias = _enteroDe(filaDict?.cantidad);
  if (dias == null) dias = _enteroDe(itAlim?.cantTexto);
  if (dias != null) dias = Math.min(dias, 31);

  // 3) Proveedor adjudicado del módulo de Alimentación → su precio por ítem.
  const adjs = exp.cuadro?.adjudicaciones || [];
  const adjAlim = adjs.find((a) => (a.modulo || MODULO_SIN_NOMBRE) === modAlim);
  const provAlim = (adjAlim && adjAlim.proveedor) || exp.cuadro?.adjudicado || "";
  const filaPrecio = ((exp.presupuestos || {})[provAlim]?.items || [])[iAlim] || {};
  const precioDiario = Number(filaPrecio.unitario) || 0;
  const alimCotizadoMensual = Number(filaPrecio.mensual) || 0;

  // 4) Mensual de Alimentación recalculado sobre los días del dictamen.
  let mensualAlim;
  if (precioDiario > 0 && dias != null) mensualAlim = precioDiario * dias;
  else if (alimCotizadoMensual > 0) mensualAlim = alimCotizadoMensual;
  else return null; // sin datos de precio de Alimentación no derivamos nada

  // 5) Internación = total adjudicado − lo cotizado de Alimentación (mensual fijo).
  const totalMensualAdj = Number(exp.cuadro?.mensual) > 0
    ? Number(exp.cuadro.mensual)
    : adjs.reduce((s, a) => s + (Number(a.mensual) || 0), 0);
  const precioMensual = Math.max(0, totalMensualAdj - alimCotizadoMensual);

  const totalAlim = mensualAlim * meses;
  const totalInt = precioMensual * meses;
  return {
    diasAlim: dias || 0,
    precioDiario,
    mensualAlim,
    totalAlim,
    precioMensual,
    totalInt,
    totalAfectar: totalAlim + totalInt,
    meses,
    _derivado: true,
  };
}

// Núcleo de la aclaración cuando la afectación de Alimentación se calcula sobre
// una cantidad de días distinta de 30 (el presupuesto suele venir por 30).
const aclaracionDiasCore = (exp) => {
  const c = exp.calculoAfectacion || derivarCalculoAfectacion(exp);
  if (!c || !(Number(c.totalAlim) > 0)) return "";
  const dias = Number(c.diasAlim);
  if (!dias || dias === 30) return "";
  return "el presupuesto fue cotizado sobre la base de 30 (treinta) días; no obstante, la afectación presupuestaria correspondiente al Módulo de Alimentación Domiciliaria se calcula sobre los " +
    dias + " (" + diasEnLetras(dias) + ") días efectivamente autorizados por el Departamento de Auditoría Médica, conforme al dictamen obrante en autos.";
};

/* ================================================================
   DICTAMEN DEFINITIVO (el que vuelve del SIGEDIG con la tabla de
   Cant. autorizada / Valor unitario / Valor total) → OBJETO CANÓNICO
   de valores autorizados. Del canónico derivan cuadro, nota y resolución:
   un solo número, no dos copias. Lectura LIBRE (no depende del formato de
   la tabla): por cada prestación reconocida toma los dos importes con
   formato de miles (unitario y total) y deriva la cantidad autorizada
   como total / unitario. Todo queda editable antes de aplicar.
   ================================================================ */

// Bucket (módulo canónico) al que pertenece una prestación, según su nombre.
// Solo dos posibles, como los nombra la resolución: Internación o Alimentación.
function bucketDeNombre(nombre) {
  return _esAlim(nombre) ? "Alimentación Domiciliaria" : "Internación Domiciliaria";
}

// Fragmento «al Módulo de X» / «a los Módulos de X y Y» para la aclaración.
function moduloFraseLista(mods) {
  const bases = (mods || []).map((m) => String(m).replace(/\s*domiciliaria\s*/i, "").trim()).filter(Boolean);
  if (bases.length >= 2) return "a los Módulos de " + bases.slice(0, -1).join(", ") + " y " + bases[bases.length - 1] + " Domiciliaria";
  return "al Módulo de " + (bases[0] || "") + " Domiciliaria";
}

// Texto de la aclaración según el escenario. comoNota=true → «Se deja constancia
// que…»; comoNota=false (resolución) → «Que…». El módulo es dinámico.
function textoAclaracionObj(a, comoNota) {
  const pref = comoNota ? "Se deja constancia que " : "Que ";
  const modTxt = moduloFraseLista(a.modulos);
  if (a.tipo === "dias") {
    const n = Number(a.dias) || 31;
    return pref + "el presupuesto fue cotizado sobre la base de 30 (treinta) días; no obstante, la afectación presupuestaria correspondiente " +
      modTxt + " se calcula sobre los " + n + " (" + diasEnLetras(n) +
      ") días efectivamente autorizados por el Departamento de Auditoría Médica, conforme al dictamen obrante en autos.";
  }
  return pref + "las prestaciones y cantidades consignadas en la presente, correspondientes " + modTxt +
    ", se ajustan a lo efectivamente autorizado por el Departamento de Auditoría Médica conforme al dictamen obrante en autos, difiriendo de lo oportunamente cotizado por la firma adjudicada.";
}

// Días base que fija Auditoría en el dictamen. Cubre las variantes reales:
// "(31) días", "treinta y un (31) días", "período de 31 días", y el caso de López
// con dos períodos ("31 días para Bomba y 15 días para Set") → prioriza 31.
function diasBaseDeTextoDictamen(texto) {
  const t = _norm(texto).replace(/[.\-–,;]/g, " ").replace(/\s+/g, " ");
  let m = t.match(/\((\d{2})\)\s*dias/);                       // "(31) dias"
  if (m) return parseInt(m[1], 10);
  const map = { "veintiocho": 28, "veintinueve": 29, "treinta y uno": 31, "treinta y un": 31, "treinta": 30 };
  m = t.match(/(treinta y uno|treinta y un|treinta|veintinueve|veintiocho)\s*(?:\(\d{2}\)\s*)?dias/);
  if (m) return map[m[1]];                                     // en letras
  const nums = [...t.matchAll(/per[ií]odo de (\d{2}) d[ií]as/g)].map((x) => parseInt(x[1], 10));
  if (nums.includes(31)) return 31;                            // varios períodos → base general 31
  if (nums.length) return nums[0];                             // "periodo de NN dias"
  m = t.match(/\b(2[89]|3[01])\s*dias\b/);                     // último recurso: "NN dias" (28-31)
  if (m) return parseInt(m[1], 10);
  return null;
}

// Lee el dictamen definitivo (texto ya extraído del PDF) sin depender del formato
// de la tabla. Las celdas que envuelven ("1 visita x / semana") parten la fila en
// varios renglones y, según el motor de PDF, los valores caen en un renglón sin el
// nombre. Por eso agrupamos por FILA: cada disciplina abre una fila y se traga los
// renglones siguientes hasta la próxima disciplina o un terminador; recién ahí
// tomamos los dos importes con separador de miles (unitario + total) y derivamos
// la cantidad autorizada = total / unitario.
function parsearDictamenDefinitivo(texto) {
  const t = String(texto || "").replace(/[\uE000-\uF8FF]/g, " ").replace(/\r/g, "");
  const lineas = t.split("\n").map((l) => l.trim()).filter(Boolean);
  // Arrancar en la tabla: después del encabezado (…Valor unitario / Cant autorizada…),
  // para no confundir el "internación domiciliaria" del renglón "Solicita…".
  let desde = lineas.findIndex((l) => {
    const n = _norm(l);
    return (n.includes("valor") && (n.includes("unitario") || n.includes("total"))) ||
           (n.includes("cant") && n.includes("autorizada"));
  });
  desde = desde >= 0 ? desde + 1 : 0;
  const esTerminador = (l) => /empresa adjudicada|control posterior|dictamen de auditor|observaci|^pase$/.test(_norm(l));
  const bloques = [];
  let actual = null;
  for (let i = desde; i < lineas.length; i++) {
    const l = lineas[i];
    if (esTerminador(l)) { if (actual) { bloques.push(actual); actual = null; } break; }
    const disc = _disciplinaDe(l);
    if (disc) {
      if (actual) bloques.push(actual);
      actual = { disc, sub: _subtipoDe(l) || "", texto: l };
    } else if (actual) {
      actual.texto += " " + l;
      if (!actual.sub) actual.sub = _subtipoDe(l) || "";
    }
  }
  if (actual) bloques.push(actual);
  const encontradas = [];
  const vistos = new Set();
  for (const b of bloques) {
    const imp = _importesDeLinea(b.texto).filter((x) => x.fmt);
    if (!imp.length) continue;                 // prestación sin valores → no autorizada
    const vals = [...new Set(imp.map((x) => x.val))].sort((a, b2) => b2 - a);
    const total = vals[0];
    const unitario = vals.length >= 2 ? vals[1] : 0;
    const clave = b.disc + "|" + b.sub;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const cantAut = unitario > 0 ? Math.round(total / unitario) : 0;
    encontradas.push({
      nombre: (b.texto.replace(/\d.*$/, "").replace(/[$\s]+$/, "").trim()) || b.disc,
      disc: b.disc, sub: b.sub, unitario, total, cantAut,
    });
  }
  return {
    diasBase: diasBaseDeTextoDictamen(t),
    lineas: encontradas,
    mensualTotal: encontradas.reduce((s, x) => s + (x.total || 0), 0),
  };
}

// Mensual ADJUDICADO por bucket (para detectar si Auditoría afectó de más o de menos).
function adjMensualPorBucket(exp) {
  const res = { "Internación Domiciliaria": 0, "Alimentación Domiciliaria": 0 };
  const adjs = exp.cuadro?.adjudicaciones || [];
  if (adjs.length) {
    adjs.forEach((a) => { res[bucketDeNombre(a.modulo)] += Number(a.mensual) || 0; });
  } else {
    const hayAlim = (exp.itemsPrestacion || []).some((it) => _esAlim(it.nombre) || _esAlim(it.modulo));
    const hayOtro = (exp.itemsPrestacion || []).some((it) => !(_esAlim(it.nombre) || _esAlim(it.modulo)));
    if (hayAlim && !hayOtro) res["Alimentación Domiciliaria"] = Number(exp.cuadro?.mensual) || 0;
    else res["Internación Domiciliaria"] = Number(exp.cuadro?.mensual) || 0;
  }
  return res;
}

// Arma el objeto canónico de valores autorizados a partir del dictamen definitivo
// ya parseado. Incluye el desglose por módulo, el total y las aclaraciones (días
// y/o recorte) con el nombre del módulo que corresponda.
function construirValoresAutorizados(exp, dictDef) {
  const meses = Number(exp.periodoMeses || 6) || 6;
  const lineas = (dictDef.lineas || []).map((l) => ({
    nombre: l.nombre,
    bucket: bucketDeNombre(l.nombre),
    unitario: Number(l.unitario) || 0,
    cantAut: Number(l.cantAut) || 0,
    mensual: Number(l.total) || (Number(l.unitario) || 0) * (Number(l.cantAut) || 0),
  }));
  const mensualPorModulo = { "Internación Domiciliaria": 0, "Alimentación Domiciliaria": 0 };
  lineas.forEach((l) => { mensualPorModulo[l.bucket] += l.mensual; });
  const mensualTotal = lineas.reduce((s, l) => s + l.mensual, 0);

  const adj = adjMensualPorBucket(exp);
  const diasBase = dictDef.diasBase;
  const modsDias = [], modsRecorte = [];
  ["Internación Domiciliaria", "Alimentación Domiciliaria"].forEach((b) => {
    const dv = mensualPorModulo[b] || 0, av = adj[b] || 0;
    if (!dv || av <= 0) return;               // sin dato → no afirmamos divergencia
    if (dv - av > 1 && diasBase && diasBase !== 30) modsDias.push(b);
    else if (av - dv > 1) modsRecorte.push(b);
  });
  const aclaraciones = [];
  if (modsDias.length) aclaraciones.push({ tipo: "dias", modulos: modsDias, dias: diasBase });
  if (modsRecorte.length) aclaraciones.push({ tipo: "recorte", modulos: modsRecorte });

  return {
    fuente: "dictamen",
    fecha: new Date().toISOString(),
    diasBase: diasBase || 0,
    meses,
    lineas,
    mensualPorModulo,
    mensualTotal,
    totalAfectar: mensualTotal * meses,
    aclaraciones,
  };
}

/* ---------- ESTIMACIÓN A 31 DÍAS (adelanto provisorio, NO vinculante) ----------
   Adelanto automático mientras no llega el dictamen: reescala a 31 días SOLO las
   prestaciones que se pagan por hora/día (enfermería 24 hs, alimentación diaria…),
   dejando intactas las semanales (visitas/sesiones por semana, que Auditoría define
   a criterio). NO predice recortes: si Auditoría autoriza de menos, el dictamen manda.
   Para quitar la función: borrar estas dos funciones, el componente
   AfectacionEstimada31 y sus dos usos en las etapas. No toca nada más. */
function estimarAfectacion31(exp) {
  if (!exp || !exp.cuadro) return null;
  const items = exp.itemsPrestacion || [];
  if (!items.length) return null;
  const meses = Number(exp.periodoMeses || 6) || 6;
  const adjs = exp.cuadro.adjudicaciones || [];
  const provDelModulo = (mod) => {
    const a = adjs.find((x) => (x.modulo || MODULO_SIN_NOMBRE) === (mod || MODULO_SIN_NOMBRE));
    return (a && a.proveedor) || exp.cuadro.adjudicado || "";
  };
  // Se reescala a 31 lo que es por hora/día; lo semanal (sesiones/visitas por semana) no.
  const esPorDia = (txt) => {
    const n = _norm(txt);
    if (/semana|sesion|visita/.test(n)) return false;
    return /\bhs\b|hora|diari|\bdia\b|\bdias\b|l a d|lunes a domingo/.test(n);
  };
  const lineas = items.map((it, i) => {
    const mod = it.modulo ? String(it.modulo).trim() : "";
    const g = (exp.presupuestos || {})[provDelModulo(mod)] || {};
    const inf = (g.modulos || {})[mod] || {};
    let m30 = 0;
    if (inf.modo !== "modulo") m30 = Number(g.items?.[i]?.mensual ?? (items.length === 1 ? g.mensual : 0)) || 0;
    const porDia = esPorDia(it.cantTexto);
    const m31 = (porDia && m30 > 0) ? Math.round(m30 * 31 / 30) : m30;
    return { nombre: it.nombre, cantTexto: it.cantTexto || "", bucket: bucketDeNombre(it.nombre), porDia, m30, m31 };
  });
  const base = Number(exp.cuadro.mensual) || lineas.reduce((s, l) => s + l.m30, 0);
  const adjB = adjMensualPorBucket(exp);
  const extraB = { "Internación Domiciliaria": 0, "Alimentación Domiciliaria": 0 };
  let extra = 0;
  lineas.forEach((l) => { if (l.porDia && l.m30 > 0) { const d = l.m31 - l.m30; extraB[l.bucket] += d; extra += d; } });
  const mensual31 = base + extra;
  const mensualPorModulo = {
    "Internación Domiciliaria": (adjB["Internación Domiciliaria"] || 0) + extraB["Internación Domiciliaria"],
    "Alimentación Domiciliaria": (adjB["Alimentación Domiciliaria"] || 0) + extraB["Alimentación Domiciliaria"],
  };
  return { meses, base, extra, mensual31, total31: mensual31 * meses, lineas, mensualPorModulo, hayCambio: extra > 0 };
}

// Objeto canónico a partir del estimado. fuente:"estimado" y SIN aclaraciones:
// es provisorio, todavía no hay dictamen que citar en el considerando.
function valoresDesdeEstimacion(exp, est) {
  return {
    fuente: "estimado",
    fecha: new Date().toISOString(),
    diasBase: 31,
    meses: est.meses,
    lineas: est.lineas.filter((l) => l.m31 > 0).map((l) => ({ nombre: l.nombre, bucket: l.bucket, unitario: 0, cantAut: 0, mensual: l.m31 })),
    mensualPorModulo: est.mensualPorModulo,
    mensualTotal: est.mensual31,
    totalAfectar: est.total31,
    aclaraciones: [],
  };
}

const datosNota = (exp, extra = {}) => {
  const va = exp.valoresAutorizados;
  const calc = exp.calculoAfectacion || derivarCalculoAfectacion(exp);
  const montoCalc = Number(calc?.totalAfectar) > 0
    ? Number(calc.totalAfectar)
    : (exp.cuadro?.mensual || 0) * Number(exp.periodoMeses || 6);
  // El dictamen definitivo (valoresAutorizados) es la fuente de verdad; gana sobre lo guardado.
  const monto = extra.monto ?? (Number(va?.totalAfectar) > 0 ? Number(va.totalAfectar) : (exp.nota?.monto ?? montoCalc));
  const core = aclaracionDiasCore(exp);
  const aclaracionVA = (va && Array.isArray(va.aclaraciones) && va.aclaraciones.length)
    ? va.aclaraciones.map((a) => textoAclaracionObj(a, true))
    : null;
  return {
    nroExpediente: exp.nroExpediente, paciente: exp.paciente, dni: exp.dni,
    modulo: exp.modulo, periodoTexto: exp.periodoTexto || exp.periodoMeses + " meses", periodoMeses: exp.periodoMeses,
    items: extra.items ?? exp.itemsPrestacion ?? [],
    monto,
    montoFormato: formatoPesos(monto),
    directora: extra.directora ?? exp.nota?.directora ?? "Dra. Noellia Bottone",
    imputacion: extra.imputacion ?? exp.nota?.imputacion ?? IMPUTACION_NOTA_DEFECTO,
    aclaracion: extra.aclaracion ?? aclaracionVA ?? exp.nota?.aclaracion ?? (core ? "Se deja constancia que " + core : ""),
    fechaTexto: extra.fechaTexto ?? exp.nota?.fechaTexto ?? fechaLargaHoy(),
  };
};

const datosPaseAuditoria = (exp, extra = {}) => ({
  tipo: "auditoria",
  nroExpediente: exp.nroExpediente, paciente: exp.paciente, dni: exp.dni,
  destinataria: extra.destinataria ?? exp.paseAuditoria?.destinataria ?? "Farm. María Gabriela Policelli",
  asunto: extra.asunto ?? exp.paseAuditoria?.asunto ?? asuntoAuditoria(exp),
  fechaTexto: fechaLargaHoy(),
});

const datosPaseLetrada = (exp, extra = {}) => ({
  tipo: "letrada",
  nroExpediente: exp.nroExpediente, paciente: exp.paciente,
  fechaTexto: extra.fechaTexto ?? exp.paseLetrada?.fechaTexto ?? mesAnioActual(),
  anioPresupuesto: extra.anio ?? exp.paseLetrada?.anio ?? String(new Date().getFullYear()),
});

const datosPaseTribunal = (exp) => ({
  tipo: "tribunal",
  nroExpediente: exp.nroExpediente, paciente: exp.paciente,
  fechaTexto: fechaLargaHoy(),
});

const datosResolucion = (exp, extra = {}) => {
  const r = exp.resolucion || {};
  const va = exp.valoresAutorizados;
  const calc = exp.calculoAfectacion || derivarCalculoAfectacion(exp);
  const core = aclaracionDiasCore(exp);
  const totalCalc = Number(calc?.totalAfectar) > 0
    ? Number(calc.totalAfectar)
    : (exp.cuadro?.mensual || 0) * Number(exp.periodoMeses || 6);
  // El dictamen definitivo (valoresAutorizados) es la fuente de verdad; gana sobre lo guardado.
  const total = extra.total ?? (Number(va?.totalAfectar) > 0 ? Number(va.totalAfectar) : (r.total ?? totalCalc));
  const mensualRes = Number(va?.mensualTotal) > 0 ? Number(va.mensualTotal) : (exp.cuadro?.mensual || 0);
  const aclaracionResVA = (va && Array.isArray(va.aclaraciones) && va.aclaraciones.length)
    ? va.aclaraciones.map((a) => textoAclaracionObj(a, false))
    : null;
  const itemsTxt = (exp.itemsPrestacion || []).map((it) => it.nombre + (it.cantTexto ? " " + it.cantTexto : "")).join("; ");
  const nombresTxt = (exp.itemsPrestacion || []).map((it) => it.nombre).join("; ");
  return {
    nroExpediente: exp.nroExpediente, paciente: exp.paciente,
    modulo: exp.modulo, periodoTexto: exp.periodoTexto || "", periodoMeses: exp.periodoMeses,
    adjudicado: exp.cuadro?.adjudicado || "", mensual: mensualRes, total,
    nroResolucion: extra.nroResolucion ?? r.nro ?? "",
    tipoTramite: extra.tipoTramite ?? r.tipoTramite ?? "inicio",
    firmante: extra.firmante ?? r.firmante ?? "directora",
    subModo: extra.subModo ?? r.subModo ?? "una",
    fsSolicitud: extra.fsSolicitud ?? r.fojas?.solicitud ?? "",
    fsPresupuesto: extra.fsPresupuesto ?? r.fojas?.presupuesto ?? "",
    fsCuadro: extra.fsCuadro ?? r.fojas?.cuadro ?? "",
    fsDictamen: extra.fsDictamen ?? r.fojas?.dictamen ?? "",
    subpartida: extra.subpartida ?? r.subpartida ?? "322",
    imputacion: extra.imputacion ?? r.imputacion ?? imputacionResolucionPorSubpartida(extra.subpartida ?? r.subpartida ?? "322"),
    anioPresupuesto: extra.anio ?? r.anio ?? String(new Date().getFullYear()),
    // modelo doble (322 y 342)
    detalleVisto: extra.detalleVisto ?? r.detalleVisto ?? ("Internación Domiciliaria; " + (nombresTxt || limpiarModulo(exp.modulo))),
    detalleModulo: extra.detalleModulo ?? r.detalleModulo ?? (itemsTxt || limpiarModulo(exp.modulo)),
    mensualUnico: extra.mensualUnico ?? r.mensualUnico ?? null,
    detalleUnico: extra.detalleUnico ?? r.detalleUnico ?? "",
    subA: extra.subA ?? r.subA ?? "342",
    tituloA: extra.tituloA ?? r.tituloA ?? "",
    detalleA: extra.detalleA ?? r.detalleA ?? "",
    firmaA: extra.firmaA ?? r.firmaA ?? (exp.cuadro?.adjudicado || ""),
    mensualA: extra.mensualA ?? r.mensualA ?? (Number(calc?.precioMensual) > 0 ? Number(calc.precioMensual) : ""),
    subB: extra.subB ?? r.subB ?? "322",
    tituloB: extra.tituloB ?? r.tituloB ?? "",
    detalleB: extra.detalleB ?? r.detalleB ?? "",
    firmaB: extra.firmaB ?? r.firmaB ?? "",
    mensualB: extra.mensualB ?? r.mensualB ?? (Number(calc?.mensualAlim) > 0 ? Number(calc.mensualAlim) : ""),
    aclaracionDias: extra.aclaracionDias ?? aclaracionResVA ?? r.aclaracionDias ?? (core ? "Que " + core : ""),
    fechaTexto: fechaLargaHoy(),
  };
};

// Extrae prestaciones de un texto: reconoce varios formatos de línea. Hs/Ses.
// queda vacío para carga manual (varía según el mes y lo autorizado por Auditoría).
// Nombres conocidos de prestaciones típicas del dictamen, para rescatar líneas
// que vengan como puro nombre, sin cantidad ("Enfermería", "Kinesiología motora").
const _NOMBRES_PRESTACION = [
  "medic", "enfermer", "fonoaud", "kinesi", "aliment", "nutric",
  "oxigen", "internac", "psicol", "terapia", "fisioterap", "cuidador",
];
function _esNombrePrestacion(s) {
  const n = _norm(s);
  return _NOMBRES_PRESTACION.some((k) => n.includes(k));
}
function extraerItemsDeTexto(texto) {
  const lineas = String(texto || "").split("\n")
    .map((l) => l.replace(/^[-•*\s]+/, "").replace(/\*/g, "").trim())
    .filter(Boolean);
  const items = [];
  const vistos = new Set();
  const push = (nombre, cantTexto) => {
    const nom = (nombre || "").trim();
    if (!nom) return;
    const clave = _norm(nom);
    if (vistos.has(clave)) return; // no dupliques la misma prestación
    vistos.add(clave);
    items.push({ nombre: nom, cantTexto: (cantTexto || "").trim(), cantNum: "" });
  };
  lineas.forEach((l) => {
    // Formato 1: "Nombre: cantidad" (con dos puntos). Límite de nombre generoso.
    const i = l.indexOf(":");
    if (i > 0 && i <= 60) {
      const nombre = l.slice(0, i).trim();
      const resto = l.slice(i + 1).trim().replace(/\.\s*$/, "");
      push(nombre, resto);
      return;
    }
    // Formato 2: "Nombre 2 hs semanales" (sin dos puntos: corta en el primer número)
    const m = l.match(/\d/);
    if (m && m.index >= 3 && m.index <= 80) {
      const nombre = l.slice(0, m.index).replace(/[+\-–(\s]+$/, "").trim();
      const resto = l.slice(m.index).trim().replace(/\.\s*$/, "");
      if (nombre && /[a-záéíóúñ]/i.test(nombre)) {
        push(nombre, resto);
        return;
      }
    }
    // Formato 3: línea corta que es SOLO el nombre de una prestación conocida,
    // sin cantidad ni dos puntos (p. ej. el PDF no capturó las hs). Entra igual
    // con cantidad vacía para que la completes a mano; ya no se pierde.
    if (l.length <= 45 && _esNombrePrestacion(l) && !/\d/.test(l)) {
      push(l, "");
    }
    // Las líneas largas sin nombre reconocible (encabezados, frases) se descartan.
  });
  return items;
}

/* ---------- Lectura de PRECIOS desde el PDF del presupuesto del proveedor ----------
   Reutiliza el mismo pipeline de PDF/OCR que el dictamen. Recorre el texto línea
   por línea, ubica la prestación de cada ítem y toma los importes en pesos que la
   acompañan. Convención (la misma que pide el mail de cotización): el PRIMER importe
   de la línea es el precio UNITARIO y el SEGUNDO el MENSUAL/total del ítem.
   Es una AYUDA: todo lo precargado queda editable. */

// "26.000" · "$ 3.552.000,00" · "7400" → número. Descarta cantidades chicas
// (sesiones, horas, días) y números absurdos (CUIT, teléfono o DNI mal leídos).
// Convierte un texto de importe a número, tolerando formato AR (1.785.600,00) y
// US (1,934,400.00), con o sin decimales, y separadores de miles con punto o coma.
// Regla: el ÚLTIMO separador con 1–2 dígitos detrás es el decimal; si tiene 3
// dígitos detrás, todos los separadores son de miles.
function _pesoANumero(tok) {
  let s = String(tok || "").replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const other = dec === "." ? "," : ".";
    const trailing = s.length - (dec === "." ? lastDot : lastComma) - 1;
    if (trailing <= 2) s = s.split(other).join("").replace(dec, ".");
    else s = s.replace(/[.,]/g, "");
  } else if (lastComma >= 0) {
    const t = s.length - lastComma - 1;
    s = t === 3 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    const t = s.length - lastDot - 1;
    if (t === 3) s = s.replace(/\./g, "");
  }
  const n = parseFloat(s);
  if (!isFinite(n) || n <= 0 || n > 100000000) return null;
  return n;
}

// Importes de una línea, en orden de lectura. Saca antes las fechas (27/7/2025)
// para que no se cuelen como números. El regex reconoce el número CON separador
// de miles primero (1.934.400,00 / 1,934,400.00) y corta ahí, de modo que si el
// total viene pegado a otro número (ej. "1,934,400.008530"), separa bien el 8530.
// Devuelve { val, fmt }: fmt=true si el token traía separador de miles/decimal
// (los precios reales lo traen; códigos y cantidades sueltas no).
function _importesDeLinea(linea) {
  const sinFecha = String(linea || "")
    .replace(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/g, " ")
    // Despega un importe con decimal de 2 dígitos que quedó pegado a otro número
    // (ej. total pegado al código: "1,934,400.008530" → "1,934,400.00 8530").
    .replace(/([.,]\d{2})(\d{3,})/g, "$1 $2");
  const re = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}|\d+/g;
  const out = [];
  let m;
  while ((m = re.exec(sinFecha)) !== null) {
    const tok = m[0];
    const v = _pesoANumero(tok);
    if (v != null) out.push({ val: v, fmt: /[.,]/.test(tok) });
  }
  return out;
}

// Disciplina base (enfermería, kinesiología, etc.) y subtipo (motora/respiratoria)
// para emparejar el renglón del presupuesto con el ítem aunque cambie la redacción.
const _DISCIPLINAS = ["enfermer", "kinesi", "fonoaud", "medic", "aliment", "nutric", "psicol", "fisioterap", "terapia", "cuidador", "oxigen"];
const _SUBTIPOS = ["motor", "respirator"];
function _disciplinaDe(s) { const n = _norm(s); return _DISCIPLINAS.find((d) => n.includes(d)) || null; }
function _subtipoDe(s) { const n = _norm(s); return _SUBTIPOS.find((t) => n.includes(t)) || null; }

// Texto del PDF + lista de ítems → [{ unitario, mensual, encontrado }] alineado a items.
// Estrategia robusta (probada contra varios formatos de proveedor):
//  1) se queda solo con los renglones que parecen de PRECIO (tienen un importe grande),
//     así descarta descripciones tipo "3 sesiones por semana";
//  2) empareja por disciplina + subtipo (motora ≠ respiratoria), tolerando que el
//     renglón diga "Kinesiología" a secas;
//  3) prioriza los importes CON separador de miles (los precios reales): así ignora
//     códigos y cantidades sueltas. El mayor es el mensual/total y el 2.º el unitario
//     (funciona esté la cantidad al principio, en el medio o al final).
function extraerPreciosDePdf(texto, items) {
  const lineas = String(texto || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const lineasPrecio = lineas.filter((l) => {
    const i = _importesDeLinea(l);
    return i.length > 0 && Math.max(...i.map((x) => x.val)) >= 1000;
  });
  return (items || []).map((it) => {
    const nom = (it && it.nombre ? it.nombre : "").trim();
    if (!nom) return { unitario: "", mensual: "", encontrado: false };
    const disc = _disciplinaDe(nom), sub = _subtipoDe(nom);
    const cand = lineasPrecio.filter((l) => {
      if (disc) { if (!_norm(l).includes(disc)) return false; }
      else if (!matchPrestacion(l, nom)) return false;
      const sl = _subtipoDe(l);
      if (sub && sl && sl !== sub) return false;
      return true;
    });
    const linea = cand.find((l) => _importesDeLinea(l).length >= 2) || cand[0];
    if (!linea) return { unitario: "", mensual: "", encontrado: false };
    const imp = _importesDeLinea(linea);
    const form = [...new Set(imp.filter((a) => a.fmt).map((a) => a.val))].sort((a, b) => b - a);
    const todos = [...new Set(imp.map((a) => a.val))].sort((a, b) => b - a);
    let mensual = null, unitario = null;
    if (form.length >= 2) { mensual = form[0]; unitario = form[1]; }
    else if (form.length === 1) { mensual = form[0]; unitario = todos.find((v) => v < mensual) ?? null; }
    else { mensual = todos[0] ?? null; unitario = todos.length >= 2 ? todos[1] : null; }
    return {
      unitario: unitario != null ? String(unitario) : "",
      mensual: mensual != null ? String(mensual) : "",
      encontrado: mensual != null,
    };
  });
}

/* ---------- MÓDULOS DEL CUADRO COMPARATIVO ----------
   Un ítem puede llevar un campo "modulo" (texto libre). Si ningún ítem lo tiene,
   o todos comparten el mismo, el cuadro se comporta exactamente como antes. */

// Placeholder para ítems sin módulo cargado. Nunca debe ser "" porque se usa
// como clave de campo en Firestore (presupuestos.PROVEEDOR.modulos.<clave>),
// y Firestore rechaza el updateDoc() si algún nombre de campo está vacío.
const MODULO_SIN_NOMBRE = "Sin módulo";

function modulosDeItems(items) {
  const vistos = [];
  (items || []).forEach((it) => {
    const m = it && it.modulo ? String(it.modulo).trim() : "";
    const clave = m || MODULO_SIN_NOMBRE;
    if (!vistos.includes(clave)) vistos.push(clave);
  });
  return vistos.length ? vistos : [MODULO_SIN_NOMBRE];
}

function hayVariosModulos(items) { return modulosDeItems(items).length > 1; }

// Asunto (3ª línea de la REF) del pase de Auditoría Médica.
// Se arma automáticamente con los módulos adjudicados en el cuadro comparativo
// (o, si todavía no hay cuadro, con los módulos de los ítems). Cada módulo va con
// mayúscula inicial y tildes, y se antepone "Renovación" si el expediente lo es.
const ACENTOS_MODULO = {
  internacion: "Internación", alimentacion: "Alimentación", nutricion: "Nutrición",
  oxigenoterapia: "Oxigenoterapia", enteral: "Enteral", parenteral: "Parenteral",
  domiciliaria: "Domiciliaria", kinesiologia: "Kinesiología", fonoaudiologia: "Fonoaudiología",
  rehabilitacion: "Rehabilitación",
};
function tituloModulo(m) {
  return String(m || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => ACENTOS_MODULO[p] || (p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}
function asuntoAuditoria(exp) {
  const crudos = (exp.cuadro?.adjudicaciones?.length
    ? exp.cuadro.adjudicaciones.map((a) => a.modulo)
    : modulosDeItems(exp.itemsPrestacion)
  ).map((m) => String(m || "").trim()).filter((m) => m && m !== MODULO_SIN_NOMBRE);
  const vistos = [];
  crudos.forEach((m) => { if (!vistos.some((v) => v.toLowerCase() === m.toLowerCase())) vistos.push(m); });
  const nombres = vistos.map(tituloModulo);
  const cuerpo = nombres.length === 0 ? "Internación Domiciliaria"
    : nombres.length === 1 ? nombres[0]
    : nombres.slice(0, -1).join(", ") + " y " + nombres[nombres.length - 1];
  const esRenov = /renov/i.test(exp.modulo || "") || /renov/i.test(exp.periodoTexto || "");
  return (esRenov ? "Renovación " : "") + cuerpo;
}

// Frase del servicio adjudicado para el recuadro gris del cuadro (un texto por módulo).
// internación → "MÓDULO DE INTERNACIÓN DOMICILIARIA"; alimentación → "ALIMENTACIÓN".
// Antepone "RENOVACIÓN " si el expediente es una renovación (igual que asuntoAuditoria).
function fraseServicioAdjudicacion(mod, exp) {
  const esRenov = /renov/i.test((exp && exp.modulo) || "") || /renov/i.test((exp && exp.periodoTexto) || "");
  const m = String(mod || "").toLowerCase();
  let cuerpo;
  if (/aliment/.test(m)) cuerpo = "ALIMENTACIÓN";
  else if (/internaci/.test(m)) cuerpo = "MÓDULO DE INTERNACIÓN DOMICILIARIA";
  else cuerpo = "MÓDULO DE " + tituloModulo(mod).toUpperCase();
  return (esRenov ? "RENOVACIÓN " : "") + cuerpo;
}

function itemsDelModulo(items, mod) {
  const salida = [];
  (items || []).forEach((it, i) => {
    const m = it && it.modulo ? String(it.modulo).trim() : "";
    const clave = m || MODULO_SIN_NOMBRE;
    if (clave === mod) salida.push({ it, i });
  });
  return salida;
}

function infoModulo(prov, mod) {
  const m = (prov && prov.modulos && prov.modulos[mod]) || {};
  return {
    noCotiza: !!m.noCotiza,
    modo: m.modo === "modulo" ? "modulo" : "item",
    montoModulo: m.montoModulo != null && m.montoModulo !== "" ? Number(m.montoModulo) : null,
    leyenda: m.leyenda || "",
  };
}

// Subtotal mensual de un proveedor para un módulo. null = no cotizó ese módulo.
function subtotalModulo(prov, items, mod) {
  if (!prov || prov.estado !== "cotizo") return null;
  const inf = infoModulo(prov, mod);
  if (inf.noCotiza) return null;
  if (inf.modo === "modulo") return inf.montoModulo;
  let suma = 0, hay = false;
  itemsDelModulo(items, mod).forEach(({ i }) => {
    const pi = (prov.items || [])[i] || {};
    if (pi.mensual != null && pi.mensual !== "" && !isNaN(Number(pi.mensual))) { suma += Number(pi.mensual); hay = true; }
  });
  return hay ? suma : null;
}

function ganadorDeModulo(proveedores, items, mod) {
  let mejor = null, mejorValor = Infinity;
  (proveedores || []).forEach((p) => {
    const v = subtotalModulo(p, items, mod);
    if (v != null && v < mejorValor) { mejorValor = v; mejor = p.nombre; }
  });
  return mejor;
}

// forzados = { [modulo]: nombreProveedor } — lo que el usuario marcó a mano
function calcularAdjudicaciones(proveedores, items, forzados) {
  return modulosDeItems(items).map((mod) => {
    const auto = ganadorDeModulo(proveedores, items, mod);
    const elegido = (forzados && forzados[mod]) || auto || "";
    const prov = (proveedores || []).find((p) => p.nombre === elegido);
    const mensual = prov ? (subtotalModulo(prov, items, mod) || 0) : 0;
    return { modulo: mod, proveedor: elegido, mensual, auto: auto || "", forzado: !!(elegido && auto && elegido !== auto) };
  });
}

function totalMensualAdjudicado(adjs) {
  return (adjs || []).reduce((s, a) => s + (Number(a.mensual) || 0), 0);
}

// Firmas distintas que quedaron adjudicadas, en orden
function firmasAdjudicadas(adjs) {
  const f = [];
  (adjs || []).forEach((a) => { if (a.proveedor && !f.includes(a.proveedor)) f.push(a.proveedor); });
  return f;
}

const payloadCuadro = (exp) => {
  const consultados = (exp.cotizacion?.proveedores || "").split(",").map((s) => s.trim()).filter(Boolean);
  const guardados = exp.presupuestos || {};
  const c = exp.cuadro || {};
  const items = exp.itemsPrestacion?.length ? exp.itemsPrestacion : [{ nombre: exp.modulo || "", cantTexto: c.cantTexto || "", cantNum: c.cantNum || "" }];
  const itemsDe = (g) => {
    if (g?.items?.length) return g.items;
    if (g?.mensual != null) return [{ nombre: items[0].nombre, unitario: g.unitario, mensual: g.mensual }];
    return [];
  };
  return {
    accion: "generarCuadro",
    nroExpediente: exp.nroExpediente, paciente: exp.paciente,
    modulo: exp.modulo, detalleServicios: exp.detalleServicios,
    periodoTexto: exp.periodoTexto, periodoMeses: exp.periodoMeses,
    items,
    textoAdjudicacion: c.textoAdjudicacion || "", textoConstancia: c.textoConstancia || "",
    proveedores: consultados.map((n) => ({
      nombre: n,
      estado: guardados[n]?.estado || "sin_respuesta",
      mensual: guardados[n]?.mensual ?? null,
      items: itemsDe(guardados[n]),
      modulos: guardados[n]?.modulos || {},
    })),
    adjudicado: { nombre: c.adjudicado, mensual: c.mensual, total: c.total },
    adjudicaciones: c.adjudicaciones || [],
    textosAdjudicacion: c.textosAdjudicacion || [],
  };
};

/* ---------- estilos ---------- */

const S = {
  page: { minHeight: "100vh", background: "#eef4f7" },
  header: {
    background: "linear-gradient(135deg, #075e75 0%, #0891b2 100%)",
    color: "#fff", padding: "14px 20px", display: "flex", alignItems: "center",
    gap: 14, boxShadow: "0 2px 8px rgba(7,94,117,.3)",
  },
  logo: { height: 44, background: "#fff", borderRadius: 8, padding: 4 },
  container: { maxWidth: 1000, margin: "0 auto", padding: "20px 14px 60px" },
  card: {
    background: "#fff", borderRadius: 12, padding: 18, marginBottom: 14,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
  },
  btn: {
    background: "#0891b2", color: "#fff", border: "none", borderRadius: 8,
    padding: "10px 18px", fontSize: 15, fontWeight: 600, cursor: "pointer",
  },
  btnSec: {
    background: "#fff", color: "#0e7490", border: "2px solid #0891b2",
    borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
  },
  btnRojo: {
    background: "#fff", color: "#b91c1c", border: "1.5px solid #ef4444",
    borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  input: {
    width: "100%", padding: "10px 12px", fontSize: 15, border: "1.5px solid #cbd5e1",
    borderRadius: 8, marginTop: 4,
  },
  label: { fontSize: 13, fontWeight: 700, color: "#334155", display: "block", marginTop: 12 },
  chip: (activa, hecha) => ({
    fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 99,
    background: hecha ? "#16a34a" : activa ? "#f59e0b" : "#e2e8f0",
    color: hecha || activa ? "#fff" : "#64748b",
    whiteSpace: "nowrap",
  }),
};

/* ================================================================ */

// Vencimiento de sesión al cambiar el día calendario.
// La sesión sólo es válida el mismo día en que se inició; al abrir la app
// otro día (o al volver a la pestaña otro día) se limpia y vuelve al inicio.
function sesionVigente() {
  if (sessionStorage.getItem("gexp_login") !== "ok") return false;
  if (sessionStorage.getItem("gexp_login_fecha") !== new Date().toDateString()) {
    sessionStorage.removeItem("gexp_login");
    sessionStorage.removeItem("gexp_login_fecha");
    localStorage.removeItem("gexp_usuario");
    return false;
  }
  return true;
}

export default function App() {
  const [logueado, setLogueado] = useState(sesionVigente());
  const [usuario, setUsuario] = useState(localStorage.getItem("gexp_usuario") || "");
  const [vista, setVista] = useState("tablero"); // tablero | nuevo | detalle | proveedores
  const [expedientes, setExpedientes] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [expedienteSel, setExpedienteSel] = useState(null);
  const [busqueda, setBusqueda] = useState(false); // pantalla de consulta rápida (solo lectura)

  const elegirUsuario = (id) => {
    localStorage.setItem("gexp_usuario", id);
    setUsuario(id);
  };

  useEffect(() => {
    signInAnonymously(auth).catch((e) => console.error("Auth:", e));
  }, []);

  // Si el navegador quedó abierto de un día para el otro, al volver a la
  // pestaña se verifica el día y, si cambió, se cierra la sesión.
  useEffect(() => {
    const chequear = () => {
      if (document.visibilityState !== "visible") return;
      if (
        sessionStorage.getItem("gexp_login") === "ok" &&
        sessionStorage.getItem("gexp_login_fecha") !== new Date().toDateString()
      ) {
        sessionStorage.removeItem("gexp_login");
        sessionStorage.removeItem("gexp_login_fecha");
        localStorage.removeItem("gexp_usuario");
        setUsuario("");
        setLogueado(false);
      }
    };
    document.addEventListener("visibilitychange", chequear);
    return () => document.removeEventListener("visibilitychange", chequear);
  }, []);

  useEffect(() => {
    if (!logueado) return;
    const u1 = onSnapshot(collection(db, COL_EXPEDIENTES), (snap) => {
      const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // Migración de esquema:
      //  - sv:2 tenía "Auditoría Médica" en el índice 4. Se quitó (dictamen al inicio):
      //    los que ya la habían pasado (etapa >= 5) se corrieron -1 → sv:3.
      //  - sv:3 → sv:4: se REINSERTA "Pase a Auditoría Médica" entre Asesoría Letrada
      //    (4) y Resolución (5). Los que ya estaban en Resolución o más allá (etapa >= 5)
      //    se corren +1 para quedar en la misma etapa nombrada; la etapa 5 (el pase)
      //    queda "ya pasada" y disponible para generarse en cualquier momento.
      //  Es idempotente: una vez en sv:4 no se vuelve a tocar.
      arr.forEach((e) => {
        let sv = e.sv || 0;
        let etapa = e.etapa || 0;
        let cambio = false;
        if (sv < 3) {
          if (sv === 2 && etapa >= 5) etapa -= 1;
          sv = 3; cambio = true;
        }
        if (sv < 4) {
          if (etapa >= 5) etapa += 1;
          sv = 4; cambio = true;
        }
        if (cambio) {
          updateDoc(doc(db, COL_EXPEDIENTES, e.id), { sv, etapa }).catch(() => {});
          e.sv = sv;
          e.etapa = etapa;
        }
      });
      arr.sort((a, b) => (b.creado || "").localeCompare(a.creado || ""));
      setExpedientes(arr);
    });
    const u2 = onSnapshot(collection(db, COL_PROVEEDORES), (snap) => {
      const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      arr.sort((a, b) => a.nombre.localeCompare(b.nombre));
      setProveedores(arr);
    });
    return () => { u1(); u2(); };
  }, [logueado]);

  // mantener el expediente seleccionado sincronizado en tiempo real
  const expedienteVivo = useMemo(
    () => expedientes.find((e) => e.id === expedienteSel?.id) || expedienteSel,
    [expedientes, expedienteSel]
  );

  if (!logueado) return <Login onOk={() => { sessionStorage.setItem("gexp_login", "ok"); sessionStorage.setItem("gexp_login_fecha", new Date().toDateString()); setLogueado(true); }} />;
  if (busqueda) return <BusquedaRapida expedientes={expedientes} onVolver={() => setBusqueda(false)} />;
  if (!usuario) return (
    <SeleccionUsuario
      onElegir={elegirUsuario}
      onVolver={() => { sessionStorage.removeItem("gexp_login"); sessionStorage.removeItem("gexp_login_fecha"); setLogueado(false); }}
      onBuscar={() => setBusqueda(true)}
    />
  );

  return (
    <div style={S.page}>
      <header style={S.header}>
        <img src={LOGO_PRIS} alt="" style={S.logo} onError={(e) => (e.target.style.display = "none")} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: 0.3 }}>Gestor de Expedientes</div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>Internación Domiciliaria · PRIS · SI.PRO.SA.</div>
        </div>
        <img src={LOGO_GOBIERNO} alt="" style={S.logo} onError={(e) => (e.target.style.display = "none")} />
      </header>

      <div style={S.container}>
        {/* barra de navegación */}
        <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
          <button style={vista === "tablero" ? S.btn : S.btnSec} onClick={() => setVista("tablero")}>📋 Tablero</button>
          <button style={vista === "nuevo" ? S.btn : S.btnSec} onClick={() => setVista("nuevo")}>➕ Nuevo expediente</button>
          <button style={vista === "proveedores" ? S.btn : S.btnSec} onClick={() => setVista("proveedores")}>🏢 Proveedores</button>
          <div style={{ flex: 1 }} />
          <span
            title="Cambiar de usuario"
            onClick={() => { localStorage.removeItem("gexp_usuario"); setUsuario(""); }}
            style={{ fontWeight: 800, color: "#075e75", cursor: "pointer", fontSize: 14, padding: "8px 12px", background: "#e0f2fe", borderRadius: 8 }}
          >👤 {usuario} · Cambiar</span>
          <button style={S.btnRojo} onClick={() => { sessionStorage.removeItem("gexp_login"); sessionStorage.removeItem("gexp_login_fecha"); localStorage.removeItem("gexp_usuario"); setUsuario(""); setLogueado(false); }}>Salir</button>
        </div>

        {/* botón Volver según la pantalla */}
        {vista === "nuevo" && (
          <button style={{ ...S.btnSec, marginBottom: 12 }} onClick={() => setVista("tablero")}>← Volver al tablero</button>
        )}
        {vista === "proveedores" && (
          <button style={{ ...S.btnSec, marginBottom: 12 }} onClick={() => setVista("tablero")}>← Volver al tablero</button>
        )}
        {(vista === "editar" || vista === "renovar") && (
          <button style={{ ...S.btnSec, marginBottom: 12 }} onClick={() => setVista("detalle")}>← Volver al expediente</button>
        )}

        {vista === "tablero" && (
          <Tablero
            expedientes={expedientes}
            usuario={usuario}
            abrir={(e) => { setExpedienteSel(e); setVista("detalle"); }}
          />
        )}
        {vista === "nuevo" && (
          <NuevoExpediente
            modo="nuevo"
            usuario={usuario}
            onCreado={(e) => { setExpedienteSel(e); setVista("detalle"); }}
            onCancelar={() => setVista("tablero")}
          />
        )}
        {vista === "editar" && expedienteVivo && (
          <NuevoExpediente
            modo="editar"
            usuario={usuario}
            inicial={expedienteVivo}
            expId={expedienteVivo.id}
            onCreado={() => setVista("detalle")}
            onCancelar={() => setVista("detalle")}
          />
        )}
        {vista === "renovar" && expedienteVivo && (
          <NuevoExpediente
            modo="renovar"
            usuario={usuario}
            inicial={expedienteVivo}
            onCreado={(e) => { setExpedienteSel(e); setVista("detalle"); }}
            onCancelar={() => setVista("detalle")}
          />
        )}
        {vista === "detalle" && expedienteVivo && (
          <DetalleExpediente
            exp={expedienteVivo}
            proveedores={proveedores}
            volver={() => { setExpedienteSel(null); setVista("tablero"); }}
            editar={() => setVista("editar")}
            renovar={() => setVista("renovar")}
          />
        )}
        {vista === "proveedores" && <Proveedores proveedores={proveedores} />}
      </div>
    </div>
  );
}

/* ---------- Login ---------- */

function Login({ onOk }) {
  const [clave, setClave] = useState("");
  const [ver, setVer] = useState(false);
  const [error, setError] = useState(false);
  const entrar = () => {
    if (clave === ADMIN_PASSWORD) onOk();
    else setError(true);
  };
  return (
    <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...S.card, width: 340, textAlign: "center" }}>
        <img src={LOGO_PRIS} alt="" style={{ maxWidth: "85%", height: "auto", marginBottom: 8 }} onError={(e) => (e.target.style.display = "none")} />
        <img src={LOGO_GOBIERNO} alt="" style={{ maxWidth: "70%", height: "auto", marginBottom: 10 }} onError={(e) => (e.target.style.display = "none")} />
        <h2 style={{ color: "#075e75", marginBottom: 4 }}>Gestor de Expedientes</h2>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>Internación Domiciliaria · PRIS</div>
        <div style={{ position: "relative" }}>
          <input
            type={ver ? "text" : "password"}
            placeholder="Contraseña"
            autoComplete="new-password"
            style={{ ...S.input, paddingRight: 44 }}
            value={clave}
            onChange={(e) => { setClave(e.target.value); setError(false); }}
            onKeyDown={(e) => e.key === "Enter" && entrar()}
          />
          <button
            type="button"
            onClick={() => setVer(!ver)}
            title={ver ? "Ocultar contraseña" : "Ver contraseña"}
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-38%)",
              background: "none", border: "none", cursor: "pointer", fontSize: 19, padding: 4,
            }}
          >{ver ? "🙈" : "👁️"}</button>
        </div>
        {error && <div style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>Contraseña incorrecta</div>}
        <button style={{ ...S.btn, width: "100%", marginTop: 14 }} onClick={entrar}>Ingresar</button>
      </div>
    </div>
  );
}

/* ---------- Selección de usuario ---------- */

function SeleccionUsuario({ onElegir, onVolver, onBuscar }) {
  return (
    <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
      {/* Consulta rápida: queda afuera del panel, arriba a la derecha */}
      <button
        onClick={onBuscar}
        title="Consultar pacientes sin entrar como usuario (solo lectura)"
        style={{
          position: "fixed", top: 16, right: 18, zIndex: 20,
          background: "#fff", color: "#0e7490", border: "2px solid #0891b2",
          borderRadius: 999, padding: "9px 16px", fontSize: 14, fontWeight: 700,
          cursor: "pointer", boxShadow: "0 2px 8px rgba(7,94,117,.15)",
        }}
      >🔍 Búsqueda rápida</button>
      <div style={{ ...S.card, width: 400, textAlign: "center" }}>
        <img src={LOGO_PRIS} alt="" style={{ maxWidth: "75%", height: "auto", marginBottom: 10 }} onError={(e) => (e.target.style.display = "none")} />
        <h2 style={{ color: "#075e75", marginBottom: 4 }}>¿Quién sos?</h2>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>
          Cada expediente queda a nombre de quien lo carga, y los mails salen con tu firma.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {USUARIOS.map((u) => (
            <button key={u.id} style={{ ...S.btn, padding: "18px 10px", fontSize: 17 }} onClick={() => onElegir(u.id)}>
              👤 {u.id}
            </button>
          ))}
        </div>
        <button style={{ ...S.btnSec, width: "100%", marginTop: 14 }} onClick={onVolver}>← Volver al inicio</button>
      </div>
    </div>
  );
}

/* ---------- Búsqueda rápida (solo lectura) ----------
   Pantalla de consulta: NO modifica ningún expediente. Sale de la misma
   colección gexp_expedientes y arma una ficha por paciente con las
   prestaciones adjudicadas, el proveedor de cada módulo, el período,
   la adjudicación, la resolución y la orden de compra. */

function fechaCortaISO(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Año del expediente: sale del número NNNN/NNN/L/AAAA; si no, de la fecha de carga
function anioDeExpediente(exp) {
  const m = String(exp.nroExpediente || "").match(/(\d{4})\s*$/);
  if (m) return m[1];
  const f = exp.creado || exp.cuadro?.fecha || "";
  const d = f ? new Date(f) : null;
  return d && !isNaN(d) ? String(d.getFullYear()) : "";
}

function periodoDeExpediente(exp) {
  const t = String(exp.periodoTexto || "").trim();
  if (t) return t;
  return exp.periodoMeses ? exp.periodoMeses + " meses" : "";
}

// Arma la ficha de consulta de un expediente (un bloque por módulo adjudicado)
/* ---------- USUARIOS (base LISTADO_PACIENTES_INTERNACION) ---------- */
const USUARIOS_ORDEN = ["JORGE", "YAMILA", "PAULA", "JULIETA"];

// Normaliza un nombre para comparar: MAYÚSCULAS, sin acentos, sin "(ALIMENTACION)" etc.
function normNombrePac(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^A-Z0-9Ñ ]/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Pacientes agrupados por usuario (sin duplicar el mismo paciente que aparece con dos módulos)
const PACIENTES_POR_USUARIO = (() => {
  const map = {};
  USUARIOS_ORDEN.forEach((u) => { map[u] = []; });
  const vistos = {};
  PACIENTES_USUARIOS.forEach(({ n, u }) => {
    const U = String(u || "").toUpperCase();
    if (!map[U]) map[U] = [];
    if (!vistos[U]) vistos[U] = new Set();
    const key = normNombrePac(n);
    if (!key || vistos[U].has(key)) return;
    vistos[U].add(key);
    map[U].push(String(n || "").replace(/\s*\([^)]*\)\s*$/, "").trim());
  });
  Object.keys(map).forEach((u) => map[u].sort((a, b) => a.localeCompare(b, "es")));
  return map;
})();

// Índice nombre-normalizado -> usuario(s)
const INDICE_USUARIO = (() => {
  const idx = {};
  PACIENTES_USUARIOS.forEach(({ n, u }) => {
    const key = normNombrePac(n);
    if (!key) return;
    if (!idx[key]) idx[key] = new Set();
    idx[key].add(String(u || "").toUpperCase());
  });
  return idx;
})();

// Usuario(s) a los que pertenece un nombre (match exacto normalizado, o por tokens apellido+nombre)
function usuariosDeNombre(nombre) {
  const key = normNombrePac(nombre);
  if (!key) return [];
  if (INDICE_USUARIO[key]) return [...INDICE_USUARIO[key]];
  const toks = key.split(" ").filter(Boolean);
  if (toks.length < 2) return [];
  const out = new Set();
  Object.keys(INDICE_USUARIO).forEach((k) => {
    const kt = k.split(" ").filter(Boolean);
    const chico = toks.length <= kt.length ? toks : kt;
    const grande = toks.length <= kt.length ? kt : toks;
    if (chico.length >= 2 && chico.every((t) => grande.includes(t))) {
      INDICE_USUARIO[k].forEach((u) => out.add(u));
    }
  });
  return [...out];
}

function fichaPaciente(exp) {
  const items = exp.itemsPrestacion || [];
  const cuadro = exp.cuadro || {};
  const envios = exp.oc?.envios || [];

  // Base de módulos: lo que quedó adjudicado en el cuadro. Si todavía no hay
  // cuadro, se listan igual los módulos de las prestaciones cargadas.
  let base = cuadro.adjudicaciones?.length ? cuadro.adjudicaciones : null;
  if (!base) {
    base = modulosDeItems(items).map((m, i) => ({
      modulo: m,
      proveedor: i === 0 ? (cuadro.adjudicado || "") : "",
      mensual: i === 0 ? (cuadro.mensual ?? null) : null,
    }));
  }

  // A qué orden de compra corresponde cada módulo
  const buscarEnvio = (a) => {
    if (!envios.length) return null;
    const porModulo = envios.find((e) => a.modulo && String(e.modulo || "").includes(a.modulo));
    if (porModulo) return porModulo;
    const porProv = envios.find((e) =>
      a.proveedor && String(e.proveedor || "").split(" / ").map((x) => x.trim()).includes(a.proveedor));
    if (porProv) return porProv;
    return envios.length === 1 ? envios[0] : null;
  };

  const modulos = base.map((a) => {
    const its = itemsDelModulo(items, a.modulo).map(({ it }) => ({
      nombre: it.nombre || "",
      cant: it.cantTexto || (it.cantNum ? String(it.cantNum) : ""),
    }));
    const env = buscarEnvio(a);
    return {
      modulo: a.modulo || MODULO_SIN_NOMBRE,
      proveedor: a.proveedor || "",
      mensual: a.mensual ?? null,
      items: its,
      ocNro: (env?.nro || exp.oc?.nro || "").toString(),
      ocFecha: env?.fecha || exp.oc?.fecha || "",
    };
  });

  const proveedores = [];
  modulos.forEach((m) => { if (m.proveedor && !proveedores.includes(m.proveedor)) proveedores.push(m.proveedor); });

  return {
    id: exp.id,
    paciente: exp.paciente || "",
    dni: exp.dni || "",
    nroExpediente: exp.nroExpediente || "",
    responsable: exp.responsable || "",
    etapa: exp.etapa || 0,
    moduloTexto: exp.modulo || "",
    periodo: periodoDeExpediente(exp),
    periodoMeses: exp.periodoMeses || "",
    anio: anioDeExpediente(exp),
    fechaAdjudicacion: cuadro.fecha || "",
    resolucionNro: exp.resolucion?.nro || "",
    resolucionFecha: exp.resolucion?.fecha || "",
    detalleServicios: exp.detalleServicios || "",
    modulos,
    proveedores,
  };
}

/* ---------- Panel USUARIOS (colapsable) ---------- */
function PanelUsuarios({ onElegirPaciente }) {
  const [abierto, setAbierto] = useState(false);
  const [usuarioSel, setUsuarioSel] = useState("");
  const total = USUARIOS_ORDEN.reduce((a, u) => a + (PACIENTES_POR_USUARIO[u]?.length || 0), 0);
  const cap = (u) => u.charAt(0) + u.slice(1).toLowerCase();

  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
      <button
        onClick={() => setAbierto((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "#0e7490", color: "#fff", border: "none", padding: "12px 16px",
          cursor: "pointer", fontSize: 15, fontWeight: 800,
        }}
      >
        <span>👥 USUARIOS</span>
        <span style={{ fontSize: 13, fontWeight: 700, opacity: 0.9 }}>{total} pacientes {abierto ? "▲" : "▼"}</span>
      </button>

      {abierto && (
        <div style={{ padding: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: usuarioSel ? 12 : 0 }}>
            {USUARIOS_ORDEN.map((u) => {
              const n = PACIENTES_POR_USUARIO[u]?.length || 0;
              const activo = usuarioSel === u;
              return (
                <button
                  key={u}
                  onClick={() => setUsuarioSel(activo ? "" : u)}
                  style={{
                    padding: "7px 14px", borderRadius: 20, fontSize: 14, fontWeight: 800, cursor: "pointer",
                    border: "1.5px solid " + (activo ? "#0e7490" : "#cbd5e1"),
                    background: activo ? "#0e7490" : "#fff", color: activo ? "#fff" : "#334155",
                  }}
                >
                  {cap(u)} <span style={{ opacity: 0.75 }}>({n})</span>
                </button>
              );
            })}
          </div>

          {usuarioSel && (
            <div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>
                Pacientes de {cap(usuarioSel)} — tocá uno para buscarlo:
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 380, overflowY: "auto" }}>
                {PACIENTES_POR_USUARIO[usuarioSel].map((nombre, i) => (
                  <button
                    key={i}
                    onClick={() => onElegirPaciente && onElegirPaciente(nombre)}
                    style={{
                      textAlign: "left", padding: "8px 10px", border: "1px solid #eef2f7", borderRadius: 6,
                      background: "#fff", cursor: "pointer", fontSize: 14, color: "#0f172a",
                    }}
                  >
                    {nombre}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BusquedaRapida({ expedientes, onVolver }) {
  const [texto, setTexto] = useState("");
  const [fProv, setFProv] = useState("");
  const [fMod, setFMod] = useState("");
  const [fAnio, setFAnio] = useState("");
  const [fPeriodo, setFPeriodo] = useState("");
  const [fEstado, setFEstado] = useState("");

  // Búsqueda en el Gmail de internación (fuente adicional, aparte de Firestore)
  const [correos, setCorreos] = useState([]);
  const [buscandoCorreos, setBuscandoCorreos] = useState(false);
  const [errorCorreos, setErrorCorreos] = useState("");
  const [claveCorreos, setClaveCorreos] = useState(""); // término con el que se buscó en el Gmail
  const [filtroCorreo, setFiltroCorreo] = useState("enviados"); // enviados | recibidos | todos
  const [prestaciones, setPrestaciones] = useState([]); // vista principal: prestaciones del pedido
  const [pedidoFecha, setPedidoFecha] = useState("");
  const [pedidoUrl, setPedidoUrl] = useState("");
  const [pacienteNombreGmail, setPacienteNombreGmail] = useState(""); // nombre del paciente según el pedido de Gmail
  const [verCorreos, setVerCorreos] = useState(false); // los correos son OPCIONALES (ocultos por defecto)

  const fichas = useMemo(() => expedientes.map(fichaPaciente), [expedientes]);

  const opciones = useMemo(() => {
    const prov = [], mods = [], anios = [], pers = [];
    fichas.forEach((f) => {
      f.proveedores.forEach((p) => { if (!prov.includes(p)) prov.push(p); });
      f.modulos.forEach((m) => { if (m.modulo && !mods.includes(m.modulo)) mods.push(m.modulo); });
      if (f.anio && !anios.includes(f.anio)) anios.push(f.anio);
      if (f.periodo && !pers.includes(f.periodo)) pers.push(f.periodo);
    });
    return {
      prov: prov.sort((a, b) => a.localeCompare(b)),
      mods: mods.sort((a, b) => a.localeCompare(b)),
      anios: anios.sort().reverse(),
      pers: pers.sort((a, b) => a.localeCompare(b)),
    };
  }, [fichas]);

  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const q = norm(texto).trim();

  const lista = useMemo(() => {
    return fichas.filter((f) => {
      if (q) {
        const heno = norm([f.paciente, f.dni, f.nroExpediente, f.proveedores.join(" "), f.moduloTexto].join(" "));
        if (!q.split(/\s+/).every((t) => heno.includes(t))) return false;
      }
      if (fProv && !f.proveedores.includes(fProv)) return false;
      if (fMod && !f.modulos.some((m) => m.modulo === fMod)) return false;
      if (fAnio && f.anio !== fAnio) return false;
      if (fPeriodo && f.periodo !== fPeriodo) return false;
      if (fEstado === "adjudicado" && !f.fechaAdjudicacion) return false;
      if (fEstado === "resolucion" && !(f.resolucionNro || f.resolucionFecha)) return false;
      if (fEstado === "oc" && !f.modulos.some((m) => m.ocNro || m.ocFecha)) return false;
      if (fEstado === "tramite" && f.fechaAdjudicacion) return false;
      return true;
    }).sort((a, b) => a.paciente.localeCompare(b.paciente));
  }, [fichas, q, fProv, fMod, fAnio, fPeriodo, fEstado]);

  // Prestaciones cargadas en el SISTEMA para los pacientes que matchean la búsqueda
  const prestacionesSistema = useMemo(() => {
    const out = [];
    lista.forEach((f) => f.modulos.forEach((m) => (m.items || []).forEach((it) => {
      if (it.nombre) out.push(it.nombre + (it.cant ? ": " + it.cant : ""));
    })));
    return out;
  }, [lista]);

  // Cruce SISTEMA + GMAIL: unifica ambas fuentes y saca duplicados por nombre de prestación
  const etiquetaPrestacion = (s) => norm(String(s || "").split(":")[0] || "");
  const prestacionesCombinadas = useMemo(() => {
    const out = [];
    const vistos = new Set();
    [...prestaciones, ...prestacionesSistema].forEach((p) => {
      const k = etiquetaPrestacion(p);
      if (k && !vistos.has(k)) { vistos.add(k); out.push(p); }
    });
    return out;
  }, [prestaciones, prestacionesSistema]);
  const fuentesPrestaciones = [
    prestaciones.length ? "Gmail" : null,
    prestacionesSistema.length ? "sistema" : null,
  ].filter(Boolean);

  // Responsable/s del paciente buscado, cruzando contra el listado de USUARIOS.
  // Candidatos de nombre: fichas del sistema que matchean, el nombre del pedido (Gmail) y el texto tipeado.
  const responsables = useMemo(() => {
    const candidatos = new Set();
    lista.forEach((f) => { if (f.paciente) candidatos.add(f.paciente); });
    if (pacienteNombreGmail) candidatos.add(pacienteNombreGmail);
    const t = texto.trim();
    if (t && !/^\d{6,9}$/.test(t.replace(/\D/g, ""))) candidatos.add(t);
    const us = new Set();
    candidatos.forEach((n) => usuariosDeNombre(n).forEach((u) => us.add(u)));
    return [...us];
  }, [lista, pacienteNombreGmail, texto]);

  const hayFiltros = !!(texto || fProv || fMod || fAnio || fPeriodo || fEstado);
  const limpiar = () => { setTexto(""); setFProv(""); setFMod(""); setFAnio(""); setFPeriodo(""); setFEstado(""); setCorreos([]); setClaveCorreos(""); setErrorCorreos(""); setFiltroCorreo("enviados"); setPrestaciones([]); setPedidoFecha(""); setPedidoUrl(""); setVerCorreos(false); setPacienteNombreGmail(""); };

  // Busca en el Gmail de internación. Vista principal = prestaciones del pedido.
  // filtro: enviados | recibidos | todos (para la sección OPCIONAL de correos)
  // mantenerAbierto: true cuando se cambia de pestaña (no cierra la sección de correos)
  const buscarEnCorreos = async (filtro = "enviados", mantenerAbierto = false) => {
    const t = texto.trim();
    if (!t) return;
    setFiltroCorreo(filtro);
    if (!mantenerAbierto) setVerCorreos(false); // búsqueda nueva: arranca mostrando SOLO prestaciones
    setBuscandoCorreos(true);
    setErrorCorreos("");
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({ clave: APPS_SCRIPT_CLAVE, accion: "buscarCorreos", texto: t, filtro }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Error desconocido en Apps Script");
      setPrestaciones(data.prestaciones || []);
      setPedidoFecha(data.pedidoFecha || "");
      setPedidoUrl(data.pedidoUrl || "");
      setPacienteNombreGmail(data.pacienteNombre || "");
      setCorreos(data.correos || []);
      setClaveCorreos(t);
    } catch (e) {
      setErrorCorreos(e.message || "No se pudo buscar en el Gmail.");
      setPrestaciones([]);
      setCorreos([]);
      setClaveCorreos(t);
    }
    setBuscandoCorreos(false);
  };

  // Al cambiar la búsqueda: limpia el resultado viejo de Gmail y, si el término está
  // completo y dejaste de tipear, lo busca solo (con pausa para no gastar cuota por tecla).
  useEffect(() => {
    const t = texto.trim();
    if (t !== claveCorreos && (correos.length || prestaciones.length || claveCorreos || errorCorreos)) {
      setCorreos([]); setPrestaciones([]); setClaveCorreos(""); setErrorCorreos(""); setVerCorreos(false); setPacienteNombreGmail("");
    }
    const dni = t.replace(/\D/g, "");
    const completo = /^\d{7,9}$/.test(dni) || t.split(/\s+/).filter(Boolean).length >= 2 || t.length >= 5;
    if (!completo || t === claveCorreos) return;
    const id = setTimeout(() => { buscarEnCorreos("enviados", false); }, 1200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const sel = { width: "100%", padding: "9px 10px", fontSize: 14, border: "1.5px solid #cbd5e1", borderRadius: 8, background: "#fff", marginTop: 4 };
  const etiq = { fontSize: 12, fontWeight: 700, color: "#475569" };
  const dato = { fontSize: 13, color: "#334155" };

  return (
    <div style={S.page}>
      <header style={S.header}>
        <img src={LOGO_PRIS} alt="" style={S.logo} onError={(e) => (e.target.style.display = "none")} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: 0.3 }}>Búsqueda rápida</div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>Consulta de pacientes · solo lectura</div>
        </div>
        <img src={LOGO_GOBIERNO} alt="" style={S.logo} onError={(e) => (e.target.style.display = "none")} />
      </header>

      <div style={S.container}>
        <button style={{ ...S.btnSec, marginBottom: 12 }} onClick={onVolver}>← Volver</button>

        <div style={{ marginBottom: 12 }}>
          <PanelUsuarios onElegirPaciente={(nombre) => setTexto(nombre)} />
        </div>

        <div style={{ ...S.card }}>
          <input
            style={{ ...S.input, fontSize: 16 }}
            placeholder="🔍 Buscar por apellido, DNI, expediente o proveedor..."
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginTop: 12 }}>
            <div>
              <span style={etiq}>Proveedor</span>
              <select style={sel} value={fProv} onChange={(e) => setFProv(e.target.value)}>
                <option value="">Todos</option>
                {opciones.prov.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <span style={etiq}>Prestación / módulo</span>
              <select style={sel} value={fMod} onChange={(e) => setFMod(e.target.value)}>
                <option value="">Todas</option>
                {opciones.mods.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <span style={etiq}>Período</span>
              <select style={sel} value={fPeriodo} onChange={(e) => setFPeriodo(e.target.value)}>
                <option value="">Todos</option>
                {opciones.pers.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <span style={etiq}>Año</span>
              <select style={sel} value={fAnio} onChange={(e) => setFAnio(e.target.value)}>
                <option value="">Todos</option>
                {opciones.anios.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <span style={etiq}>Estado</span>
              <select style={sel} value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
                <option value="">Todos</option>
                <option value="adjudicado">Ya adjudicados</option>
                <option value="resolucion">Con resolución</option>
                <option value="oc">Con orden de compra</option>
                <option value="tramite">Todavía en trámite</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: hayFiltros ? "#0e7490" : "#94a3b8" }}>
              {hayFiltros
                ? `${lista.length} ${lista.length === 1 ? "paciente encontrado" : "pacientes encontrados"} de ${fichas.length}`
                : `${fichas.length} pacientes cargados`}
            </span>
            {hayFiltros && <button style={S.btnRojo} onClick={limpiar}>Limpiar filtros</button>}
            <button
              style={{ ...S.btn, marginLeft: "auto", opacity: texto.trim() && !buscandoCorreos ? 1 : 0.55 }}
              disabled={!texto.trim() || buscandoCorreos}
              onClick={() => buscarEnCorreos()}
            >
              {buscandoCorreos ? "Buscando…" : "🩺 Ver prestaciones (Gmail)"}
            </button>
          </div>
        </div>

        {!hayFiltros && (
          <div style={{ ...S.card, textAlign: "center", color: "#64748b", padding: 40 }}>
            🔍 Escribí un apellido, DNI o número de expediente<br />
            <span style={{ fontSize: 13 }}>(o usá los filtros de arriba) para ver la ficha del paciente.</span>
          </div>
        )}

        {hayFiltros && lista.length === 0 && (
          <div style={{ ...S.card, textAlign: "center", color: "#64748b", padding: 40 }}>
            No hay pacientes que coincidan con la búsqueda.
          </div>
        )}

        {hayFiltros && lista.map((f) => (
          <div key={f.id} style={{ ...S.card, borderLeft: "5px solid " + (f.fechaAdjudicacion ? "#16a34a" : "#94a3b8") }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: "#075e75" }}>{f.paciente.toUpperCase()}</div>
                <div style={{ fontSize: 13, color: "#475569" }}>Expte. {f.nroExpediente} · DNI {f.dni}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={S.chip(true, f.etapa > 0)}>
                  {f.etapa === 0 ? "⏳ Sin cotizar" : ETAPAS[f.etapa - 1] + " ✓"}
                </span>
                <div style={{ fontSize: 12, marginTop: 6, color: "#64748b", fontWeight: 700 }}>👤 {f.responsable || "—"}</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, marginTop: 12, padding: "10px 12px", background: "#f1f5f9", borderRadius: 8 }}>
              <div>
                <div style={etiq}>Período</div>
                <div style={dato}>{f.periodo || "—"}{f.periodoMeses ? ` · ${f.periodoMeses} meses` : ""}</div>
              </div>
              <div>
                <div style={etiq}>Fecha de adjudicación</div>
                <div style={dato}>{f.fechaAdjudicacion ? fechaCortaISO(f.fechaAdjudicacion) : "—"}</div>
              </div>
              <div>
                <div style={etiq}>Resolución</div>
                <div style={dato}>
                  {f.resolucionNro ? "Nº " + f.resolucionNro : "—"}
                  {f.resolucionFecha ? " · " + fechaCortaISO(f.resolucionFecha) : ""}
                </div>
              </div>
            </div>

            {f.modulos.map((m, i) => (
              <div key={i} style={{ marginTop: 10, padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: "#0e7490" }}>
                    {m.modulo === MODULO_SIN_NOMBRE ? (f.moduloTexto || "Prestaciones") : m.modulo}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: m.proveedor ? "#166534" : "#94a3b8" }}>
                    🏢 {m.proveedor || "Sin adjudicar"}
                  </div>
                </div>

                {m.items.length > 0 ? (
                  <ul style={{ margin: "8px 0 0 18px", padding: 0, fontSize: 13, color: "#334155" }}>
                    {m.items.map((it, k) => (
                      <li key={k} style={{ marginBottom: 2 }}>
                        {it.nombre}{it.cant ? ": " + it.cant : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  f.detalleServicios
                    ? <div style={{ fontSize: 13, color: "#475569", whiteSpace: "pre-wrap", marginTop: 6 }}>{f.detalleServicios}</div>
                    : <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>Sin prestaciones cargadas.</div>
                )}

                <div style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>
                  <b>Orden de compra:</b> {m.ocNro ? "Nº " + m.ocNro : "—"}
                  {m.ocFecha ? " · " + fechaCortaISO(m.ocFecha) : ""}
                </div>
              </div>
            ))}
          </div>
        ))}

        {(buscandoCorreos || errorCorreos || claveCorreos || prestacionesSistema.length > 0) && (
          <div style={{ ...S.card, borderLeft: "5px solid #0e7490" }}>
            <div style={{ fontWeight: 800, color: "#0e7490", marginBottom: 8, fontSize: 16 }}>
              🩺 Prestaciones solicitadas{(claveCorreos || texto.trim()) ? ` · "${claveCorreos || texto.trim()}"` : ""}
            </div>

            {responsables.length > 0 && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 10, padding: "4px 12px", borderRadius: 20, background: "#ecfeff", border: "1.5px solid #a5f3fc" }}>
                <span style={{ fontSize: 13, color: "#155e75" }}>👤 Responsable:</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#0e7490" }}>
                  {responsables.map((u) => u.charAt(0) + u.slice(1).toLowerCase()).join(" / ")}
                </span>
              </div>
            )}

            {buscandoCorreos && <div style={{ fontSize: 14, color: "#64748b" }}>Buscando en el Gmail…</div>}
            {errorCorreos && <div style={{ fontSize: 14, color: "#b91c1c" }}>⚠️ {errorCorreos}</div>}

            {/* VISTA PRINCIPAL: prestaciones cruzando SISTEMA + GMAIL */}
            {!buscandoCorreos && !errorCorreos && (
              prestacionesCombinadas.length > 0 ? (
                <div>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {prestacionesCombinadas.map((p, i) => (
                      <li key={i} style={{ padding: "7px 0", borderBottom: "1px solid #f1f5f9", fontSize: 15, color: "#0f172a", display: "flex", gap: 8 }}>
                        <span style={{ color: "#0e7490", fontWeight: 800 }}>•</span>
                        <span>{renderConNegritas(p)}</span>
                      </li>
                    ))}
                  </ul>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
                    {fuentesPrestaciones.length ? "Fuente: " + fuentesPrestaciones.join(" + ") : ""}
                    {pedidoFecha ? ` · pedido del ${pedidoFecha}` : ""}
                    {pedidoUrl && <> · <a href={pedidoUrl} target="_blank" rel="noreferrer" style={{ color: "#075e75", fontWeight: 700, textDecoration: "none" }}>Abrir en Gmail →</a></>}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 14, color: "#94a3b8" }}>
                  No encontré prestaciones para “{claveCorreos}” ni en el sistema ni en el pedido de Gmail. Podés revisar los correos en “Ver correos”.
                </div>
              )
            )}

            {/* OPCIONAL: correos (enviados / recibidos), ocultos por defecto */}
            {!buscandoCorreos && !errorCorreos && (
              <div style={{ marginTop: 14, borderTop: "1px dashed #e2e8f0", paddingTop: 12 }}>
                <button
                  onClick={() => setVerCorreos((v) => !v)}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#0e7490" }}
                >
                  {verCorreos ? "▲ Ocultar correos" : "📩 Ver correos (enviados / recibidos)"}
                </button>

                {verCorreos && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                      {[["enviados", "Enviados"], ["recibidos", "Recibidos"], ["todos", "Todos"]].map(([val, lbl]) => (
                        <button
                          key={val}
                          disabled={buscandoCorreos}
                          onClick={() => buscarEnCorreos(val, true)}
                          style={{
                            padding: "5px 12px", fontSize: 13, fontWeight: 700, borderRadius: 20,
                            cursor: buscandoCorreos ? "default" : "pointer",
                            border: "1.5px solid " + (filtroCorreo === val ? "#0e7490" : "#cbd5e1"),
                            background: filtroCorreo === val ? "#0e7490" : "#fff",
                            color: filtroCorreo === val ? "#fff" : "#475569",
                          }}
                        >{lbl}</button>
                      ))}
                    </div>

                    {correos.length === 0 && (
                      <div style={{ fontSize: 14, color: "#94a3b8" }}>
                        No hay correos {filtroCorreo === "todos" ? "" : filtroCorreo} para “{claveCorreos}”.{filtroCorreo !== "todos" ? " Probá otra pestaña." : ""}
                      </div>
                    )}
                    {correos.map((c, i) => <TarjetaCorreo key={i} c={c} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Tarjeta de correo (búsqueda en Gmail) ---------- */

// Convierte *palabra* en negrita real (como el mail) y respeta los saltos de línea.
function renderConNegritas(texto) {
  const partes = String(texto || "").split(/(\*[^*\n]+\*)/g);
  return partes.map((p, i) =>
    /^\*[^*\n]+\*$/.test(p)
      ? <b key={i}>{p.slice(1, -1)}</b>
      : <span key={i}>{p}</span>
  );
}

function TarjetaCorreo({ c }) {
  const [abierto, setAbierto] = useState(false);
  const largo = (c.resumen || "").length > 260; // solo ofrece "ver más" si hay bastante texto
  return (
    <div style={{ marginTop: 10, padding: "10px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#0e7490" }}>{c.asunto || "(sin asunto)"}</div>
        <div style={{ fontSize: 12, color: "#64748b" }}>{c.fecha}</div>
      </div>
      <div style={{ fontSize: 12, color: "#475569", marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 800, padding: "1px 8px", borderRadius: 20, color: "#fff", background: c.enviado ? "#0e7490" : "#16a34a" }}>
          {c.enviado ? "Enviado" : "Recibido"}
        </span>
        <span>De: {c.de}</span>
      </div>
      {c.resumen && (
        <div style={{ position: "relative", marginTop: 8 }}>
          <div style={{
            fontSize: 13, color: "#334155", whiteSpace: "pre-wrap", lineHeight: 1.5,
            background: "#f8fafc", padding: "8px 10px", borderRadius: 6,
            maxHeight: abierto ? "none" : 150, overflow: "hidden",
          }}>
            {renderConNegritas(c.resumen)}
          </div>
          {!abierto && largo && (
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 40, borderRadius: "0 0 6px 6px", background: "linear-gradient(rgba(248,250,252,0), rgba(248,250,252,1))", pointerEvents: "none" }} />
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
        {largo && (
          <button
            onClick={() => setAbierto((v) => !v)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#0e7490" }}
          >
            {abierto ? "▲ Ver menos" : "▼ Ver más"}
          </button>
        )}
        {c.url && (
          <a href={c.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: "#075e75", textDecoration: "none" }}>
            Abrir en Gmail →
          </a>
        )}
      </div>
    </div>
  );
}

/* ---------- Tablero ---------- */

function Tablero({ expedientes, usuario, abrir }) {
  const [filtro, setFiltro] = useState("mios"); // mios | todos
  const lista = (filtro === "mios"
    ? expedientes.filter((e) => (e.responsable || "") === usuario)
    : [...expedientes]
  ).sort((a, b) =>
    (a.paciente || "").localeCompare(b.paciente || "", "es", { sensitivity: "base" })
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button style={filtro === "mios" ? S.btn : S.btnSec} onClick={() => setFiltro("mios")}>
          👤 Mis expedientes ({expedientes.filter((e) => (e.responsable || "") === usuario).length})
        </button>
        <button style={filtro === "todos" ? S.btn : S.btnSec} onClick={() => setFiltro("todos")}>
          👥 Todos ({expedientes.length})
        </button>
      </div>

      {lista.length === 0 && (
        <div style={{ ...S.card, textAlign: "center", color: "#64748b", padding: 40 }}>
          {filtro === "mios"
            ? <>No tenés expedientes a tu nombre todavía.<br />Creá uno con <b>➕ Nuevo expediente</b> o mirá la pestaña <b>👥 Todos</b>.</>
            : <>Todavía no hay expedientes cargados.<br />Creá el primero con el botón <b>➕ Nuevo expediente</b>.</>}
        </div>
      )}

      {lista.map((e) => {
        const dias = e.etapa >= 1 && e.cotizacion ? diasHabilesDesde(e.cotizacion.fecha) : null;
        const vencido = dias !== null && dias > 5 && e.etapa === 1;
        return (
          <div key={e.id} style={{ ...S.card, cursor: "pointer" }} onClick={() => abrir(e)}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: "#075e75" }}>{e.paciente.toUpperCase()}</div>
                <div style={{ fontSize: 13, color: "#475569" }}>
                  Expte. {e.nroExpediente} · DNI {e.dni}
                </div>
                <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{e.modulo}</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                  🗓️ {e.periodoTexto ? e.periodoTexto : (e.periodoMeses ? e.periodoMeses + " meses" : "Período no cargado")}
                </div>
                <div style={{ fontSize: 12, marginTop: 4, fontWeight: 700, color: e.responsable ? "#0e7490" : "#94a3b8" }}>
                  👤 {e.responsable || "Sin responsable asignado"}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={S.chip(true, e.etapa > 0)}>
                  {e.etapa === 0 ? "⏳ Sin cotizar" : ETAPAS[e.etapa - 1] + " ✓"}
                </span>
                {e.etapa >= 9 && e.cuadro?.adjudicado && (
                  <div style={{ fontSize: 12, marginTop: 6, fontWeight: 800, color: "#166534" }}>
                    🏆 {e.cuadro.adjudicado}
                  </div>
                )}
                {dias !== null && e.etapa === 1 && (
                  <div style={{ fontSize: 12, marginTop: 6, fontWeight: 700, color: vencido ? "#dc2626" : "#f59e0b" }}>
                    {vencido ? `⚠️ Plazo vencido (${dias} días hábiles)` : `Día hábil ${dias} de 5`}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Nuevo expediente ---------- */

function NuevoExpediente({ modo = "nuevo", usuario = "", inicial = null, expId = null, onCreado, onCancelar }) {
  const [f, setF] = useState(() => {
    if (inicial) {
      return {
        nroExpediente: modo === "renovar" ? "" : (inicial.nroExpediente || ""),
        paciente: inicial.paciente || "", dni: inicial.dni || "",
        fechaNacimiento: inicial.fechaNacimiento || "",
        domicilio: inicial.domicilio || "", telefono: inicial.telefono || "",
        diagnostico: inicial.diagnostico || "", modulo: inicial.modulo || "",
        detalleServicios: inicial.detalleServicios || "",
        periodoMeses: inicial.periodoMeses || 6,
        periodoTexto: modo === "renovar" ? "" : (inicial.periodoTexto || ""),
        responsable: modo === "renovar" ? usuario : (inicial.responsable || usuario),
      };
    }
    return {
      nroExpediente: "", paciente: "", dni: "", fechaNacimiento: "",
      domicilio: "", telefono: "", diagnostico: "", modulo: "",
      detalleServicios: "", periodoMeses: 6, periodoTexto: "",
      responsable: usuario,
    };
  });
  const [guardando, setGuardando] = useState(false);
  const [leyendoDic, setLeyendoDic] = useState(false);
  const [dictamenCargado, setDictamenCargado] = useState(inicial?.dictamen || null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const edad = calcularEdad(f.fechaNacimiento);

  // Sube el dictamen desde el alta: pre-llena los datos del paciente y deja
  // el dictamen listo para guardarse con el expediente (cruce armado de entrada).
  const prefillDesdeDictamen = async (file) => {
    setLeyendoDic(true);
    try {
      let texto = "";
      const esPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name);
      if (esPdf) {
        texto = await textoDePdf(file);
        if (_norm(texto).replace(/[^a-z]/g, "").length < 30) texto = await ocrPdfEscaneado(file);
      } else {
        texto = await ocrImagen(file);
      }
      if (!texto || texto.length < 10) {
        alert("No pude leer texto del archivo. Cargá los datos a mano.");
        return;
      }
      const d = parsearDictamen(texto);
      // módulo derivado de la línea "Solicita ..."
      let modulo = (d.solicita || "")
        .replace(/^solicita\s+/i, "")
        .replace(/^renovaci[oó]n de\s+/i, "")
        .replace(/^m[oó]dulo de\s+/i, "")
        .replace(/[-–—]\s*renovaci[oó]n.*$/i, "")
        .trim();
      // DIAGNÓSTICO: dejar ver exactamente qué texto leyó el navegador
      console.log("[DICTAMEN] " + texto.length + " caracteres leídos:\n" + texto);
      if (!d.nroDictamen && !d.paciente && !d.dni) {
        alert(
          "⚠️ Leí el archivo pero no reconocí datos del dictamen.\n\n" +
          "Caracteres leídos: " + texto.length + "\n\n" +
          "Primeros 220:\n" + (texto.slice(0, 220) || "(vacío)") + "\n\n" +
          "Sacá una captura de este aviso y pasámela: con eso ajusto la lectura. Por ahora, cargá los datos a mano."
        );
        return;
      }
      const prestArr = PRESTACIONES_DICTAMEN.map((n) => ({ nombre: n, cantidad: d.prestaciones[n] || "" }));
      // detalle de servicios = solo las prestaciones autorizadas (con cantidad), una por línea
      const detalle = prestArr
        .filter((p) => (p.cantidad || "").trim() !== "")
        .map((p) => `${p.nombre}: ${p.cantidad}`)
        .join("\n");
      setF((prev) => ({
        ...prev,
        nroExpediente: (d.nroDictamen || prev.nroExpediente || "").toUpperCase(),
        paciente: d.paciente || prev.paciente,
        dni: d.dni || prev.dni,
        diagnostico: d.diagnostico || prev.diagnostico,
        modulo: modulo ? modulo.toUpperCase() : prev.modulo,
        periodoTexto: d.periodoAutorizado || prev.periodoTexto,
        detalleServicios: detalle || prev.detalleServicios,
      }));
      setDictamenCargado({
        nroDictamen: d.nroDictamen || "", fechaDictamen: d.fechaDictamen || "", solicita: d.solicita || "",
        esRenovacion: !!d.esRenovacion, periodoAutorizado: d.periodoAutorizado || "", firmante: d.firmante || "",
        observaciones: "", prestaciones: prestArr, cargadoEl: new Date().toISOString(),
      });
      alert(
        "✅ Leí el dictamen" +
        (d.nroDictamen ? " (N° " + d.nroDictamen + ")" : " (⚠️ no pude leer el N° — cargalo a mano)") +
        ". Pre-llené los datos del paciente y el dictamen quedó cargado: el cruce ya arranca armado. Revisá y completá lo que falte antes de guardar."
      );
    } catch (e) {
      alert("No pude leer el archivo automáticamente (" + (e.message || e) + "). Cargá los datos a mano.");
    } finally {
      setLeyendoDic(false);
    }
  };

  const titulos = {
    nuevo: ["Nuevo expediente", "Estos datos se usan para el mail de cotización y para todos los documentos posteriores. Se cargan una sola vez."],
    editar: ["✏️ Editar expediente", "Corregí lo que haga falta y guardá. El avance de etapas y la cotización enviada no se pierden."],
    renovar: ["🔄 Renovación de período", "Los datos del paciente ya vienen cargados. Completá el N° de expediente NUEVO y el período nuevo, y se crea el trámite de renovación desde cero."],
  };

  const guardar = async () => {
    if (!f.nroExpediente || !f.paciente || !f.dni || !f.modulo) {
      alert("Completá al menos: N° de expediente, paciente, DNI y módulo.");
      return;
    }
    setGuardando(true);
    try {
      if (modo === "editar" && expId) {
        await updateDoc(doc(db, COL_EXPEDIENTES, expId), { ...f, edad });
        onCreado({ id: expId, ...f, edad });
      } else {
        const data = { ...f, edad, etapa: 0, sv: 4, creado: new Date().toISOString(), ...(dictamenCargado ? { dictamen: dictamenCargado } : {}) };
        const ref = await addDoc(collection(db, COL_EXPEDIENTES), data);
        onCreado({ id: ref.id, ...data });
      }
    } catch (e) {
      alert("Error al guardar: " + e.message);
    }
    setGuardando(false);
  };

  return (
    <div style={S.card}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h3 style={{ color: "#075e75", marginBottom: 4 }}>{titulos[modo][0]}</h3>
          <div style={{ fontSize: 13, color: "#64748b" }}>{titulos[modo][1]}</div>
        </div>
        {modo !== "editar" && (
          <label
            style={{
              ...S.btn, whiteSpace: "nowrap", cursor: leyendoDic ? "default" : "pointer",
              opacity: leyendoDic ? 0.6 : 1,
            }}
            title="Subí el PDF o la foto del dictamen y se pre-llenan los datos"
          >
            {leyendoDic ? "Leyendo…" : "📎 Cargar dictamen y pre-llenar"}
            <input
              type="file"
              accept=".pdf,image/*"
              style={{ display: "none" }}
              disabled={leyendoDic}
              onChange={(e) => {
                const file = e.target.files && e.target.files[0];
                if (file) prefillDesdeDictamen(file);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      {dictamenCargado && (
        <div style={{ fontSize: 12, fontWeight: 700, color: "#166534", marginTop: 6 }}>
          🩺 Dictamen cargado{dictamenCargado.nroDictamen ? " (N° " + dictamenCargado.nroDictamen + ")" : ""} — se guarda junto con el expediente y el cruce arranca armado.
        </div>
      )}

      <label style={S.label}>N° de expediente (ej: 1694/415/G/2026) — tip: apretá TAB y la barra / se pone sola{modo === "renovar" && " — PONÉ EL NÚMERO NUEVO"}</label>
      <input
        style={S.input}
        value={f.nroExpediente}
        onChange={(e) => setF({ ...f, nroExpediente: e.target.value.toUpperCase() })}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            const v = f.nroExpediente;
            const barras = (v.match(/\//g) || []).length;
            if (v && !v.endsWith("/") && barras < 3) {
              e.preventDefault(); // no salta de campo: agrega la barra
              setF({ ...f, nroExpediente: v + "/" });
            }
            // con las 3 barras puestas, TAB salta normalmente al campo siguiente
          }
        }}
        placeholder="0000/000/G/2026"
      />

      <label style={S.label}>Apellido y nombre del paciente</label>
      <input style={S.input} value={f.paciente} onChange={set("paciente")} placeholder="GOMEZ PRISCILA BERENICE" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 90px", gap: 10 }}>
        <div>
          <label style={S.label}>DNI</label>
          <input style={S.input} value={f.dni} onChange={set("dni")} placeholder="56.375.830" />
        </div>
        <div>
          <label style={S.label}>Fecha de nacimiento</label>
          <input type="date" style={S.input} value={f.fechaNacimiento} onChange={set("fechaNacimiento")} />
        </div>
        <div>
          <label style={S.label}>Edad</label>
          <input style={{ ...S.input, background: "#f1f5f9" }} value={edad !== "" ? edad + " años" : ""} readOnly />
        </div>
      </div>

      <label style={S.label}>Domicilio</label>
      <input style={S.input} value={f.domicilio} onChange={set("domicilio")} placeholder="TARUCA PAMPA - B° La ex Estación - Dto. Burruyacú" />

      <label style={S.label}>Teléfono de contacto</label>
      <input style={S.input} value={f.telefono} onChange={set("telefono")} placeholder="3813409105" />

      <label style={S.label}>Diagnóstico</label>
      <input style={S.input} value={f.diagnostico} onChange={set("diagnostico")} placeholder="DNT crónica leve / baja talla / trastorno deglutorio severo - CLEF 1-GTT" />

      <label style={S.label}>Módulo a cotizar</label>
      <input style={S.input} value={f.modulo} onChange={set("modulo")} placeholder="BOMBA DE INFUSIÓN ENTERAL PARA SOPORTE NUTRICIONAL ENTERAL PARA GASTROSTOMIA (x15 set)" />

      <label style={S.label}>Detalle de servicios mensuales (lo autorizado por Auditoría Médica) — UNO POR LÍNEA, con el nombre del servicio antes de los dos puntos</label>
      <textarea style={{ ...S.input, minHeight: 110 }} value={f.detalleServicios} onChange={set("detalleServicios")} placeholder={"Enfermería: 12 horas diarias, de lunes a domingo.\nKinesiología Motora: 1 sesión diaria, de lunes a domingo (31 sesiones mensuales).\nControl Médico: 4 sesiones mensuales (1 sesión semanal).\nAlimentación: Enteral con bomba de infusión."} />

      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10 }}>
        <div>
          <label style={S.label}>Período (meses)</label>
          <input type="number" min="1" max="12" style={S.input} value={f.periodoMeses} onChange={set("periodoMeses")} />
        </div>
        <div>
          <label style={S.label}>Período en texto (para documentos)</label>
          <input style={S.input} value={f.periodoTexto} onChange={set("periodoTexto")} placeholder="Julio 2026 a Diciembre 2026" />
        </div>
      </div>

      <label style={S.label}>Responsable del expediente</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {USUARIOS.map((u) => (
          <label key={u.id} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
            borderRadius: 8, border: "1.5px solid " + (f.responsable === u.id ? "#0891b2" : "#cbd5e1"),
            background: f.responsable === u.id ? "#e0f2fe" : "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600,
          }}>
            <input type="radio" name="responsable" checked={f.responsable === u.id} onChange={() => setF({ ...f, responsable: u.id })} />
            👤 {u.id}
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button style={S.btn} onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando..." : modo === "editar" ? "💾 Guardar cambios" : modo === "renovar" ? "🔄 Crear renovación" : "💾 Crear expediente"}
        </button>
        <button style={S.btnSec} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

/* ---------- Detalle de expediente ---------- */

/* ================================================================
   DICTAMEN DE AUDITORÍA MÉDICA — "documento madre"
   Se carga al inicio del expediente. Fija QUÉ y CUÁNTO autorizó
   Auditoría. Es el "deber ser" contra el que después se cruzan el
   presupuesto ganador, la nota de afectación y la resolución.
   Paso 1: carga manual + lista flexible de prestaciones (se pueden
   agregar/quitar). Los cruces y el cálculo llegan en pasos siguientes.
   ================================================================ */

// Prestaciones típicas del dictamen (el orden en que vienen en el papel).
// La lista NO es fija: Jorge puede agregar o quitar filas.
const PRESTACIONES_DICTAMEN = [
  "Médico",
  "Enfermería",
  "Fonoaudiología",
  "Kinesiología respiratoria",
  "Kinesiología motora",
  "Alimentación",
];

// Estado inicial de la ficha: si ya hay dictamen cargado lo usa; si no,
// pre-siembra con datos que ya tenemos del expediente.
function dictamenInicial(exp) {
  if (exp.dictamen) {
    return {
      nroDictamen: exp.dictamen.nroDictamen || "",
      fechaDictamen: exp.dictamen.fechaDictamen || "",
      solicita: exp.dictamen.solicita || "",
      esRenovacion: !!exp.dictamen.esRenovacion,
      periodoAutorizado: exp.dictamen.periodoAutorizado || "",
      firmante: exp.dictamen.firmante || "",
      observaciones: exp.dictamen.observaciones || "",
      prestaciones:
        Array.isArray(exp.dictamen.prestaciones) && exp.dictamen.prestaciones.length
          ? exp.dictamen.prestaciones.map((p) => ({ nombre: p.nombre || "", cantidad: p.cantidad || "" }))
          : PRESTACIONES_DICTAMEN.map((n) => ({ nombre: n, cantidad: "" })),
    };
  }
  const base = `${exp.modulo || ""} ${exp.periodoTexto || ""}`;
  return {
    nroDictamen: "",
    fechaDictamen: "",
    solicita: exp.modulo || "",
    esRenovacion: /renov/i.test(base),
    periodoAutorizado: exp.periodoTexto || "",
    firmante: "",
    observaciones: "",
    prestaciones: PRESTACIONES_DICTAMEN.map((n) => ({ nombre: n, cantidad: "" })),
  };
}

/* ---------- Lectura automática del dictamen (pre-llenado) ----------
   PDF con texto → se lee con pdf.js (casi perfecto).
   Foto / escaneo → OCR con Tesseract (puede tener errores; se revisa).
   Todo se carga perezosamente desde CDN solo cuando se usa el botón. */

async function cargarPdfJs() {
  const url = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs";
  const pdfjs = await import(/* @vite-ignore */ url);
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs";
  return pdfjs;
}

// Reconstruye el texto usando la posición (x,y) de cada fragmento. Es independiente
// de si pdf.js devuelve palabras enteras o letra por letra; esto último es lo que en
// algunos navegadores rompía la lectura (unir con espacios daba "E X P E D I E N T E").
function reconstruirTexto(items) {
  let texto = "", prev = null;
  for (const it of items) {
    if (typeof it.str !== "string") continue;
    if (prev) {
      const prevEndX = prev.transform[4] + (prev.width || 0);
      const gapX = it.transform[4] - prevEndX;
      const dy = Math.abs(it.transform[5] - prev.transform[5]);
      if (prev.hasEOL || dy > 3) texto += "\n";
      else if (gapX > (it.height || 8) * 0.25 || /\s$/.test(prev.str) || /^\s/.test(it.str)) texto += " ";
    }
    texto += it.str;
    prev = it;
  }
  return texto.trim();
}

async function textoDePdf(file) {
  const pdfjs = await cargarPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  let texto = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    texto += reconstruirTexto(content.items) + "\n";
  }
  return texto.trim();
}

async function ocrImagen(imagen) {
  const url = "https://cdn.jsdelivr.net/npm/tesseract.js@5/+esm";
  const mod = await import(/* @vite-ignore */ url);
  const recognize = mod.recognize || (mod.default && mod.default.recognize);
  const res = await recognize(imagen, "spa");
  return ((res && res.data && res.data.text) || "").trim();
}

async function ocrPdfEscaneado(file) {
  const pdfjs = await cargarPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  let texto = "";
  const paginas = Math.min(pdf.numPages, 2);
  for (let p = 1; p <= paginas; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    texto += (await ocrImagen(canvas.toDataURL("image/png"))) + "\n";
  }
  return texto.trim();
}

// Quita acentos y baja a minúsculas (para ubicar etiquetas en texto/OCR).
function _norm(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const _LABELS_DICT = [
  "Médico", "Enfermería", "Fonoaudiología",
  "Kinesiología respiratoria", "Kinesiología motora", "Alimentación",
];

// Interpreta el texto del dictamen y arma los campos de la ficha.
function parsearDictamen(texto) {
  // Algunos PDF mapean el espacio a un carácter del área privada (U+E000–U+F8FF);
  // lo pasamos a espacio real para que trim() y la búsqueda de etiquetas funcionen.
  const t = texto.replace(/[\uE000-\uF8FF]/g, " ").replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const tn = _norm(t);
  const out = {
    nroDictamen: "", fechaDictamen: "", paciente: "", dni: "", diagnostico: "", solicita: "",
    esRenovacion: false, periodoAutorizado: "", firmante: "", prestaciones: {},
  };

  // N° de expediente / dictamen
  // N° de expediente: tolerante a cómo venga "N°:" (pdf.js/OCR varían mucho) + plan B global.
  let mExp = t.match(/EXPEDIENTE[^0-9]{0,15}([0-9]{2,5}\s*\/\s*[0-9]{2,4}\s*\/\s*[A-Za-z]{1,3}\s*\/\s*20[0-9]{2})/i);
  if (!mExp) mExp = t.match(/([0-9]{3,5}\s*\/\s*[0-9]{2,4}\s*\/\s*[A-Za-z]{1,3}\s*\/\s*20[0-9]{2})/);
  if (mExp) out.nroDictamen = mExp[1].replace(/\s+/g, "").toUpperCase();

  // Fecha de cabecera (única con año de 4 dígitos; la doc. adjunta usa 2 dígitos)
  const mFecha = t.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
  if (mFecha) out.fechaDictamen = mFecha[1];

  // Datos del paciente (para pre-llenar el alta del expediente)
  const mPac = t.match(/PACIENTE\s*:?\s*([^\n]+?)(?=\s+DNI|\n|$)/i);
  if (mPac) out.paciente = mPac[1].replace(/\s+/g, " ").trim();
  const mDni = t.match(/DNI\s*:?\s*([\d.\s]{6,15})/i);
  if (mDni) out.dni = mDni[1].replace(/\s+/g, "").trim();
  const mDiag = t.match(/DIAGN[ÓO]STICO\s*:?\s*([^\n]+?)(?=\s+DETALLE|\n|$)/i);
  if (mDiag) out.diagnostico = mDiag[1].replace(/\s+/g, " ").trim();

  // Línea "Solicita ..." hasta DOCUMENTACIÓN / DETALLE / salto
  const mSol = t.match(/Solicita\b[\s\S]*?(?=DOCUMENTACI|DETALLE|\n|$)/i);
  if (mSol) out.solicita = mSol[0].replace(/\s+/g, " ").trim();
  out.esRenovacion = /renovaci/.test(_norm(out.solicita)) || /renovaci/.test(tn);

  // Período: "Mes AÑO a Mes AÑO" o "Mes a Mes AÑO"
  const meses = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
  const mPer = t.match(new RegExp("(" + meses + ")\\s*\\d{0,4}\\s*(?:a|al|-|–|—|hasta)\\s*(?:" + meses + ")\\s*\\d{2,4}", "i"));
  if (mPer) out.periodoAutorizado = mPer[0].replace(/\s+/g, " ").trim();

  // Firmante: preferimos el de Auditoría (Farm./Dr./Dra.) sobre el CPN del PIS.
  let mFirma = t.match(/(?:Farm\.|Dra\.|Dr\.)\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ.\s]{2,40}/);
  if (!mFirma) mFirma = t.match(/C\.?P\.?N\.?\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ.\s]{2,40}/);
  if (mFirma) out.firmante = mFirma[0].replace(/\s+/g, " ").trim();

  // Prestaciones: SOLO dentro de la tabla (después de "CANTIDAD SOLICITADA"),
  // para no confundir "Alimentación" de la línea "Solicita ...".
  const idxTabla = tn.indexOf("cantidad solicitada");
  const desde = idxTabla !== -1 ? idxTabla + "cantidad solicitada".length : 0;
  const stops = _LABELS_DICT.map(_norm).concat(["dictamen de auditoria", "dictamen"]);
  for (let i = 0; i < _LABELS_DICT.length; i++) {
    const lab = _norm(_LABELS_DICT[i]);
    const idx = tn.indexOf(lab, desde);
    if (idx === -1) continue;
    let fin = tn.length;
    for (const s of stops) {
      if (s === lab) continue;
      const j = tn.indexOf(s, idx + lab.length);
      if (j !== -1 && j < fin) fin = j;
    }
    let cantidad = t.slice(idx + lab.length, fin).replace(/^[\s:.\-–]+/, "").replace(/\s+/g, " ").trim();
    if (cantidad.length > 70) cantidad = cantidad.slice(0, 70).trim();
    out.prestaciones[_LABELS_DICT[i]] = cantidad;
  }
  return out;
}

function FichaDictamen({ exp }) {
  const [abierto, setAbierto] = useState(!exp.dictamen && !exp.dictamenValidadoManual); // arranca abierto solo si falta cargar y no está validado a mano
  const [f, setF] = useState(() => dictamenInicial(exp));
  const [guardando, setGuardando] = useState(false);
  const [leyendo, setLeyendo] = useState(false);

  // Sube el archivo del dictamen, lo lee (texto u OCR) y pre-llena la ficha.
  const prefillDesdeArchivo = async (file) => {
    setLeyendo(true);
    try {
      let texto = "";
      const esPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name);
      if (esPdf) {
        texto = await textoDePdf(file);
        // PDF sin capa de texto (escaneado) → rasterizar y OCR
        if (_norm(texto).replace(/[^a-z]/g, "").length < 30) texto = await ocrPdfEscaneado(file);
      } else {
        texto = await ocrImagen(file);
      }
      if (!texto || texto.length < 10) {
        alert("No pude leer texto del archivo. Cargá los datos a mano.");
        return;
      }
      const d = parsearDictamen(texto);
      setF((prev) => {
        const pres = prev.prestaciones.map((p) => {
          const key = Object.keys(d.prestaciones).find((k) => _norm(k) === _norm(p.nombre));
          return key && d.prestaciones[key] ? { ...p, cantidad: d.prestaciones[key] } : p;
        });
        return {
          ...prev,
          nroDictamen: d.nroDictamen || prev.nroDictamen,
          fechaDictamen: d.fechaDictamen || prev.fechaDictamen,
          solicita: d.solicita || prev.solicita,
          esRenovacion: d.esRenovacion || prev.esRenovacion,
          periodoAutorizado: d.periodoAutorizado || prev.periodoAutorizado,
          firmante: d.firmante || prev.firmante,
          prestaciones: pres,
        };
      });
      alert("✅ Leí el dictamen y pre-llené lo que pude. Revisá y corregí lo que falte antes de guardar (sobre todo los días de Alimentación).");
    } catch (e) {
      alert("No pude leer el archivo automáticamente (" + (e.message || e) + "). Cargá los datos a mano.");
    } finally {
      setLeyendo(false);
    }
  };

  const set = (k) => (e) =>
    setF((prev) => ({ ...prev, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const setPrest = (i, campo, val) =>
    setF((prev) => {
      const arr = prev.prestaciones.map((p, k) => (k === i ? { ...p, [campo]: val } : p));
      return { ...prev, prestaciones: arr };
    });

  const agregarPrest = () =>
    setF((prev) => ({ ...prev, prestaciones: [...prev.prestaciones, { nombre: "", cantidad: "" }] }));

  const quitarPrest = (i) =>
    setF((prev) => ({ ...prev, prestaciones: prev.prestaciones.filter((_, k) => k !== i) }));

  // Prestaciones con cantidad cargada (lo efectivamente autorizado).
  const autorizadas = (exp.dictamen?.prestaciones || []).filter((p) => (p.cantidad || "").trim() !== "");
  const alim = (exp.dictamen?.prestaciones || []).find(
    (p) => /aliment/i.test(p.nombre || "") && (p.cantidad || "").trim() !== ""
  );

  const guardar = async () => {
    setGuardando(true);
    try {
      const dictamen = {
        nroDictamen: f.nroDictamen.trim(),
        fechaDictamen: f.fechaDictamen.trim(),
        solicita: f.solicita.trim(),
        esRenovacion: !!f.esRenovacion,
        periodoAutorizado: f.periodoAutorizado.trim(),
        firmante: f.firmante.trim(),
        observaciones: f.observaciones.trim(),
        // solo guardo filas con algún dato, y normalizo
        prestaciones: f.prestaciones
          .map((p) => ({ nombre: (p.nombre || "").trim(), cantidad: (p.cantidad || "").trim() }))
          .filter((p) => p.nombre !== "" || p.cantidad !== ""),
        cargadoEl: new Date().toISOString(),
      };
      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), { dictamen });
      setAbierto(false);
      alert("✅ Dictamen guardado. Queda como el 'deber ser' del expediente.");
    } catch (e) {
      alert("❌ Error al guardar el dictamen: " + e.message);
    }
    setGuardando(false);
  };

  const validadoManual = !!exp.dictamenValidadoManual && !exp.dictamen;

  const marcarValidado = async () => {
    if (!confirm("¿Marcar el dictamen como validado en este expediente? Usalo para expedientes anteriores que ya pasaron por Auditoría antes de este cambio.")) return;
    try {
      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), { dictamenValidadoManual: true });
    } catch (e) { alert("❌ Error: " + e.message); }
  };
  const quitarValidado = async () => {
    try {
      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), { dictamenValidadoManual: false });
    } catch (e) { alert("❌ Error: " + e.message); }
  };

  const borde = (exp.dictamen || validadoManual) ? "5px solid #16a34a" : "5px solid #f59e0b";

  return (
    <div style={{ ...S.card, borderLeft: borde }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800, color: (exp.dictamen || validadoManual) ? "#166534" : "#92400e" }}>
          {exp.dictamen
            ? "🩺 Dictamen de Auditoría Médica cargado"
            : validadoManual
              ? "✅ Dictamen validado (expediente anterior)"
              : "⚠️ Falta cargar el Dictamen de Auditoría Médica"}
        </div>
        <div style={{ flex: 1 }} />
        {!exp.dictamen && !validadoManual && (
          <button style={S.btnSec} onClick={marcarValidado} title="Para expedientes que ya pasaron por Auditoría antes de este cambio">
            ✓ Marcar como validado
          </button>
        )}
        {validadoManual && (
          <button style={S.btnSec} onClick={quitarValidado}>✕ Quitar validación</button>
        )}
        <button style={S.btnSec} onClick={() => setAbierto((v) => !v)}>
          {abierto ? "▲ Ocultar" : exp.dictamen ? "▼ Ver / editar" : "▼ Cargar dictamen"}
        </button>
      </div>

      {/* Resumen cuando ya está cargado y el panel está cerrado */}
      {exp.dictamen && !abierto && (
        <div style={{ fontSize: 14, color: "#334155", marginTop: 8 }}>
          {exp.dictamen.nroDictamen && (<><b>Dictamen N°:</b> {exp.dictamen.nroDictamen} · </>)}
          {exp.dictamen.fechaDictamen && (<><b>Fecha:</b> {exp.dictamen.fechaDictamen} · </>)}
          {exp.dictamen.esRenovacion && <span style={{ color: "#0e7490", fontWeight: 700 }}>Renovación</span>}
          {exp.dictamen.solicita && (<div style={{ marginTop: 2 }}><b>Solicita:</b> {exp.dictamen.solicita}</div>)}
          {exp.dictamen.periodoAutorizado && (<div><b>Período autorizado:</b> {exp.dictamen.periodoAutorizado}</div>)}
          <div style={{ marginTop: 6 }}>
            <b>Prestaciones autorizadas ({autorizadas.length}):</b>{" "}
            {autorizadas.length
              ? autorizadas.map((p) => `${p.nombre}: ${p.cantidad}`).join(" · ")
              : "— (ninguna con cantidad cargada)"}
          </div>
          {alim && (
            <div style={{ marginTop: 4, fontWeight: 700, color: "#b45309" }}>
              🍽️ Alimentación autorizada: {alim.cantidad}
            </div>
          )}
        </div>
      )}

      {/* Formulario de carga / edición */}
      {abierto && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>
            Cargá lo que autorizó Auditoría Médica. Esto es el <b>documento madre</b>: contra estos datos se van a cruzar
            después el presupuesto ganador, la nota y la resolución. El dato más importante son los <b>días de Alimentación</b>.
          </div>

          {/* Subir el PDF/foto del dictamen y pre-llenar automáticamente */}
          <div style={{ background: "#f0f9ff", border: "1.5px dashed #38bdf8", borderRadius: 10, padding: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#075985", marginBottom: 4 }}>
              📎 Subí el dictamen y lo pre-lleno automáticamente
            </div>
            <div style={{ fontSize: 12, color: "#0369a1", marginBottom: 10 }}>
              Si es un PDF de texto lo leo casi perfecto. Si es una foto o escaneo uso OCR y puede salir con algún error, así que después
              revisá y corregí lo que falte. Lo que el dictamen no autoriza, dejalo en blanco.
            </div>
            <label
              style={{
                ...S.btn, display: "inline-block", cursor: leyendo ? "default" : "pointer",
                opacity: leyendo ? 0.6 : 1,
              }}
            >
              {leyendo ? "Leyendo… (puede tardar unos segundos)" : "📎 Elegir archivo del dictamen (PDF o foto)"}
              <input
                type="file"
                accept=".pdf,image/*"
                style={{ display: "none" }}
                disabled={leyendo}
                onChange={(e) => {
                  const file = e.target.files && e.target.files[0];
                  if (file) prefillDesdeArchivo(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={S.label}>N° de dictamen (opcional)</label>
              <input style={S.input} value={f.nroDictamen} onChange={set("nroDictamen")} placeholder="Ej: 2143/623/G/2026" />
            </div>
            <div>
              <label style={S.label}>Fecha del dictamen</label>
              <input style={S.input} value={f.fechaDictamen} onChange={set("fechaDictamen")} placeholder="Ej: 20/07/2026" />
            </div>
          </div>

          <label style={S.label}>Detalle solicitado (línea "Solicita …" del dictamen)</label>
          <input style={S.input} value={f.solicita} onChange={set("solicita")} placeholder="Ej: Módulo de Internación Domiciliaria" />

          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center", marginTop: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: "#334155" }}>
              <input type="checkbox" checked={f.esRenovacion} onChange={set("esRenovacion")} /> Es renovación
            </label>
            <div>
              <label style={{ ...S.label, marginTop: 0 }}>Período autorizado</label>
              <input style={S.input} value={f.periodoAutorizado} onChange={set("periodoAutorizado")} placeholder="Ej: Septiembre 2026 a Febrero 2027" />
            </div>
          </div>

          <label style={{ ...S.label, marginTop: 16 }}>Prestaciones autorizadas — cantidad tal cual figura en el dictamen</label>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>
            Dejá en blanco la cantidad de las prestaciones que el dictamen NO autoriza. Podés agregar o quitar filas.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {f.prestaciones.map((p, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr auto", gap: 6, alignItems: "center" }}>
                <input
                  style={{ ...S.input, marginTop: 0, fontWeight: 700 }}
                  value={p.nombre}
                  onChange={(e) => setPrest(i, "nombre", e.target.value)}
                  placeholder="Prestación"
                />
                <input
                  style={{ ...S.input, marginTop: 0 }}
                  value={p.cantidad}
                  onChange={(e) => setPrest(i, "cantidad", e.target.value)}
                  placeholder="Cantidad (ej: 16hs L-D · 31 días · 3 ses/sem)"
                />
                <button
                  style={{ ...S.btnRojo, padding: "8px 10px" }}
                  title="Quitar esta prestación"
                  onClick={() => quitarPrest(i)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button style={{ ...S.btnSec, marginTop: 8 }} onClick={agregarPrest}>➕ Agregar prestación</button>

          <label style={{ ...S.label, marginTop: 16 }}>Firmante del dictamen (opcional)</label>
          <input style={S.input} value={f.firmante} onChange={set("firmante")} placeholder="Ej: Farm. Gabriela Policelli — Jefe Dpto. Auditoría Médica" />

          <label style={{ ...S.label, marginTop: 12 }}>Observaciones (opcional)</label>
          <input style={S.input} value={f.observaciones} onChange={set("observaciones")} placeholder="Ej: Se rectifica dictamen de fecha 15/07/2026" />

          <button
            style={{ ...S.btn, marginTop: 16, width: "100%", fontSize: 16, opacity: guardando ? 0.6 : 1 }}
            onClick={guardar}
            disabled={guardando}
          >
            {guardando ? "Guardando…" : "💾 Guardar dictamen"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   PASO 2 — CRUCE Dictamen (autorizado) ↔ Presupuesto (cotizado)
   Compara, prestación por prestación, lo que autorizó Auditoría
   contra los ítems cotizados/adjudicados (itemsPrestacion). Marca:
   - verde: coincide;  ámbar: coincide la prestación pero difiere la cantidad;
   - rojo "falta": autorizado por Auditoría pero NO cotizado;
   - rojo "de más": cotizado pero NO autorizado por el dictamen.
   Es una ayuda visual para confirmar de un vistazo; Jorge decide.
   ================================================================ */

// ¿Refieren a la misma prestación? (tolerante a acentos, mayúsculas y texto extra)
function matchPrestacion(a, b) {
  const na = _norm(a).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const nb = _norm(b).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  // claves específicas (distingue kinesio respiratoria de motora)
  const claves = [
    ["kinesi", "respirator"], ["kinesi", "motor"],
    ["medic"], ["enfermer"], ["fonoaud"], ["aliment"], ["internac"],
  ];
  for (const ks of claves) {
    if (ks.every((k) => na.includes(k)) && ks.every((k) => nb.includes(k))) return true;
  }
  if (na.length >= 5 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

// Normaliza una cantidad para comparar (saca espacios/acentos/puntuación menor)
function _normCant(s) {
  let t = _norm(s);                              // minúsculas, sin acentos
  t = t.replace(/[.\-–,;/]/g, " ").replace(/\s+/g, " ").trim();
  // equivalencias de rango de días (Auditoría abrevia a veces)
  t = t.replace(/\bl\s+a\s+d\b/g, "lunes a domingo");
  t = t.replace(/\blun\s+a\s+dom\b/g, "lunes a domingo");
  t = t.replace(/\bde\s+lunes\s+a\s+domingo\b/g, "lunes a domingo");
  // unidades y conectores
  t = t.replace(/hs\b/g, "horas").replace(/\bhrs\b/g, "horas").replace(/\bh\b/g, "horas");
  t = t.replace(/\b(x|por)\b/g, " ");            // "x" / "por" son conectores
  t = t.replace(/\bdiaria(s)?\b/g, "dia").replace(/\bdiario(s)?\b/g, "dia").replace(/\bdias\b/g, "dia");
  t = t.replace(/\bsesiones\b/g, "sesion");
  t = t.replace(/\bsemanales\b/g, "semana").replace(/\bsemanal\b/g, "semana").replace(/\bsemanas\b/g, "semana");
  t = t.replace(/\bde\b/g, " ");                 // relleno
  return t.replace(/\s+/g, "");                  // comparar sin espacios
}

function cruzarDictamen(autorizadas, items) {
  const usados = new Set();
  const filas = [];
  autorizadas.forEach((a) => {
    let mIdx = -1;
    for (let i = 0; i < items.length; i++) {
      if (usados.has(i)) continue;
      if (matchPrestacion(a.nombre, items[i].nombre)) { mIdx = i; break; }
    }
    if (mIdx >= 0) {
      usados.add(mIdx);
      const it = items[mIdx];
      const cotCant = it.cantTexto || (it.cantNum ? String(it.cantNum) : "") || "";
      const igual = _normCant(a.cantidad) === _normCant(cotCant);
      filas.push({ tipo: igual ? "ok" : "dif", izq: a, der: { nombre: it.nombre, cantidad: cotCant } });
    } else {
      filas.push({ tipo: "falta", izq: a, der: null });
    }
  });
  items.forEach((it, i) => {
    if (usados.has(i)) return;
    const cotCant = it.cantTexto || (it.cantNum ? String(it.cantNum) : "") || "";
    if (!(it.nombre || "").trim() && !cotCant.trim()) return; // ítem vacío, ignorar
    filas.push({ tipo: "extra", izq: null, der: { nombre: it.nombre, cantidad: cotCant } });
  });
  return filas;
}

function CruceDictamenPresupuesto({ exp }) {
  if (!exp.dictamen) return null; // sin dictamen no hay contra qué cruzar

  const autorizadas = (exp.dictamen.prestaciones || []).filter((p) => (p.cantidad || "").trim() !== "");
  const items = exp.itemsPrestacion || [];

  // Sin ítems cargados todavía: aviso suave, el cruce aparece después
  if (!items.length) {
    return (
      <div style={{ ...S.card, borderLeft: "5px solid #cbd5e1" }}>
        <div style={{ fontWeight: 800, color: "#475569" }}>🔀 Cruce con lo cotizado</div>
        <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
          Todavía no hay ítems de presupuesto cargados en el expediente. El cruce contra el dictamen aparece acá en cuanto los cargues.
        </div>
      </div>
    );
  }

  const filas = cruzarDictamen(autorizadas, items);
  const difs = filas.filter((f) => f.tipo !== "ok").length;
  const colores = {
    ok: { bg: "#f0fdf4", bd: "#86efac", tag: "#166534", txt: "✔ coincide" },
    dif: { bg: "#fffbeb", bd: "#fcd34d", tag: "#b45309", txt: "⚠ cantidad distinta" },
    falta: { bg: "#fef2f2", bd: "#fca5a5", tag: "#b91c1c", txt: "✖ autorizado, no cotizado" },
    extra: { bg: "#fef2f2", bd: "#fca5a5", tag: "#b91c1c", txt: "✖ cotizado, no autorizado" },
  };

  const borde = difs === 0 ? "5px solid #16a34a" : "5px solid #ef4444";

  return (
    <div style={{ ...S.card, borderLeft: borde }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800, color: difs === 0 ? "#166534" : "#b91c1c" }}>
          🔀 Cruce Dictamen ↔ Cotizado
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: difs === 0 ? "#166534" : "#b91c1c" }}>
          {difs === 0 ? "✅ Todo lo autorizado coincide con lo cotizado" : `⚠️ ${difs} diferencia${difs === 1 ? "" : "s"} para revisar`}
        </div>
      </div>

      {/* encabezado de las dos columnas */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginTop: 12, fontSize: 12, fontWeight: 800, color: "#334155" }}>
        <div>🩺 AUTORIZADO (Dictamen)</div>
        <div>💰 COTIZADO / ADJUDICADO</div>
        <div style={{ textAlign: "right" }}>Estado</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
        {filas.map((f, i) => {
          const c = colores[f.tipo];
          return (
            <div
              key={i}
              style={{
                display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "center",
                background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 8, padding: "8px 10px",
              }}
            >
              <div style={{ fontSize: 13 }}>
                {f.izq ? (
                  <><b>{f.izq.nombre}</b>{f.izq.cantidad ? `: ${f.izq.cantidad}` : ""}</>
                ) : (
                  <span style={{ color: "#94a3b8", fontStyle: "italic" }}>— sin autorización —</span>
                )}
              </div>
              <div style={{ fontSize: 13 }}>
                {f.der ? (
                  <><b>{f.der.nombre}</b>{f.der.cantidad ? `: ${f.der.cantidad}` : ""}</>
                ) : (
                  <span style={{ color: "#94a3b8", fontStyle: "italic" }}>— no cotizado —</span>
                )}
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, color: c.tag, textAlign: "right", whiteSpace: "nowrap" }}>
                {c.txt}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 12, color: "#64748b", marginTop: 10 }}>
        El cruce es una ayuda para revisar de un vistazo: puede marcar diferencias por cómo esté redactado un ítem. Confirmá vos antes de avanzar.
      </div>
    </div>
  );
}

/* ---------- DICTAMEN DEFINITIVO → valores autorizados (override que recalcula) ----------
   Se sube el PDF que vuelve del SIGEDIG (tabla Cant. autorizada / Valor unitario /
   Valor total). El sistema lo lee libre, muestra sistema (adjudicado) vs dictamen,
   y al aplicar deja un único objeto canónico del que derivan la nota y la resolución.
   Nunca pisa nada en silencio: primero muestra, confirma, y recién ahí recalcula. */
function CargarDictamenDefinitivo({ exp }) {
  const [leyendo, setLeyendo] = useState(false);
  const [prop, setProp] = useState(null);          // { va, dictDef, texto }
  const [mensualEdit, setMensualEdit] = useState("");
  const [aplicando, setAplicando] = useState(false);
  const meses = Number(exp.periodoMeses || 6) || 6;
  const va0 = exp.valoresAutorizados;
  const adj = adjMensualPorBucket(exp);

  const leer = async (file) => {
    if (!file) return;
    setLeyendo(true);
    try {
      let texto = "";
      const esPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name);
      if (esPdf) {
        texto = await textoDePdf(file);
        if (_norm(texto).replace(/[^a-z]/g, "").length < 30) texto = await ocrPdfEscaneado(file);
      } else {
        texto = await ocrImagen(file);
      }
      if (!texto || texto.length < 10) { alert("No pude leer texto del archivo. Probá con el PDF original (no una foto borrosa)."); return; }
      const dictDef = parsearDictamenDefinitivo(texto);
      console.log("[DICTAMEN DEFINITIVO] " + texto.length + " caracteres:\n" + texto);
      if (!dictDef.lineas.length) {
        alert(
          "⚠️ Leí el archivo pero no reconocí filas de prestación con valores.\n\n" +
          "Caracteres leídos: " + texto.length + "\n\nPrimeros 240:\n" + (texto.slice(0, 240) || "(vacío)") +
          "\n\nSacá captura de este aviso si querés que ajuste la lectura."
        );
        return;
      }
      const vaProp = construirValoresAutorizados(exp, dictDef);
      setProp({ va: vaProp, dictDef });
      setMensualEdit(String(vaProp.mensualTotal || ""));
    } catch (e) {
      alert("No pude leer el archivo (" + (e.message || e) + ").");
    } finally { setLeyendo(false); }
  };

  const aplicar = async () => {
    if (!prop) return;
    setAplicando(true);
    try {
      let va = prop.va;
      const mEdit = Number(mensualEdit);
      if (mEdit > 0 && Math.abs(mEdit - va.mensualTotal) > 0.5) {
        va = { ...va, mensualTotal: mEdit, totalAfectar: mEdit * meses };
      }
      const patch = { valoresAutorizados: va };
      // Mantengo en sincronía los totales YA guardados (si existen) para que ninguna
      // vista quede mostrando el número viejo. Uso dot-paths: no piso el resto del objeto.
      if (exp.nota) {
        patch["nota.monto"] = va.totalAfectar;
        patch["nota.montoLetras"] = numeroALetras(va.totalAfectar);
        patch["nota.aclaracion"] = va.aclaraciones.map((a) => textoAclaracionObj(a, true));
      }
      if (exp.resolucion) {
        patch["resolucion.total"] = va.totalAfectar;
        patch["resolucion.montoLetras"] = numeroALetras(va.totalAfectar);
        patch["resolucion.aclaracionDias"] = va.aclaraciones.map((a) => textoAclaracionObj(a, false));
      }
      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), patch);
      setProp(null);
      alert(
        "✅ Dictamen definitivo aplicado.\n\nLa nota y la resolución toman ahora " + formatoPesos(va.totalAfectar) +
        " (por " + meses + " meses).\n\nRegenerá los documentos: ya salen con este valor y la aclaración que corresponda."
      );
    } catch (e) {
      alert("❌ No se pudo aplicar: " + (e.message || e));
    } finally { setAplicando(false); }
  };

  const quitar = async () => {
    if (!confirm("¿Quitar los valores del dictamen definitivo?\n\nLa nota y la resolución vuelven a calcularse con lo adjudicado en el cuadro comparativo.")) return;
    try {
      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), { valoresAutorizados: null });
      alert("Listo. Se quitó el override del dictamen definitivo.");
    } catch (e) { alert("❌ " + (e.message || e)); }
  };

  const buckets = ["Internación Domiciliaria", "Alimentación Domiciliaria"];
  const filaBucket = (b, dictVal) => {
    const av = adj[b] || 0, dv = dictVal || 0;
    if (!av && !dv) return null;
    const dif = dv - av;
    const color = Math.abs(dif) <= 1 ? "#166534" : (dif > 0 ? "#b45309" : "#b91c1c");
    return (
      <div key={b} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1.1fr", gap: 8, fontSize: 13, padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
        <div style={{ fontWeight: 700, color: "#334155" }}>{b}</div>
        <div>{formatoPesos(av)}</div>
        <div style={{ fontWeight: 700 }}>{formatoPesos(dv)}</div>
        <div style={{ fontWeight: 700, color }}>
          {Math.abs(dif) <= 1 ? "✔ coincide" : (dif > 0 ? "▲ " + formatoPesos(dif) : "▼ " + formatoPesos(Math.abs(dif)))}
        </div>
      </div>
    );
  };

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #0891b2", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800, color: "#075e75" }}>🩺 Dictamen definitivo (valores autorizados)</div>
        <div style={{ flex: 1 }} />
        {va0 && (
          va0.fuente === "estimado" ? (
            <span style={{ fontSize: 12, fontWeight: 700, color: "#b45309", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "3px 8px" }}>
              ⏳ Estimado provisorio — {formatoPesos(va0.totalAfectar)} · falta confirmar con dictamen
            </span>
          ) : (
            <span style={{ fontSize: 12, fontWeight: 700, color: "#166534", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "3px 8px" }}>
              ✅ Dictamen aplicado — {formatoPesos(va0.totalAfectar)} ({meses} meses)
            </span>
          )
        )}
      </div>

      <div style={{ fontSize: 13, color: "#64748b", marginTop: 6 }}>
        Cuando vuelve el dictamen del SIGEDIG con la tabla de valores autorizados, subilo acá. Se lee solo, te muestro
        <b> sistema vs. dictamen</b>, y al aplicar la <b>nota</b> y la <b>resolución</b> se recalculan de un único número.
        Si Auditoría difiere del presupuesto (31 días o recorte), la aclaración sale sola en el considerando.
      </div>

      {va0 && !prop && (
        <div style={{ marginTop: 10, fontSize: 13, color: "#334155", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" }}>
          <div><b>Mensual:</b> {formatoPesos(va0.mensualTotal)} · <b>Total {meses} meses:</b> {formatoPesos(va0.totalAfectar)}{va0.diasBase ? <> · <b>Base:</b> {va0.diasBase} días</> : null}</div>
          {(va0.aclaraciones || []).length > 0 && (
            <div style={{ marginTop: 6 }}>
              {va0.aclaraciones.map((a, k) => (
                <div key={k} style={{ fontStyle: "italic", color: "#475569", marginTop: 2 }}>« {textoAclaracionObj(a, false)} »</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
        <label style={{ ...S.btnSec, cursor: "pointer", margin: 0 }} title="Subí el PDF del dictamen definitivo">
          {leyendo ? "Leyendo…" : (va0 ? "📎 Volver a cargar dictamen definitivo" : "📎 Cargar dictamen definitivo y recalcular")}
          <input type="file" accept="application/pdf,image/*" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) leer(f); }} />
        </label>
        {va0 && !prop && (
          <button style={{ ...S.btnSec, margin: 0, color: "#b91c1c", borderColor: "#fca5a5" }} onClick={quitar}>🗑️ Quitar override</button>
        )}
      </div>

      {prop && (
        <div style={{ marginTop: 12, border: "1.5px solid #bae6fd", borderRadius: 12, padding: "12px 14px", background: "#f0f9ff" }}>
          <div style={{ fontWeight: 800, color: "#075e75", marginBottom: 8 }}>Comparación mensual por módulo</div>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1.1fr", gap: 8, fontSize: 12, fontWeight: 800, color: "#334155", paddingBottom: 4, borderBottom: "2px solid #e2e8f0" }}>
            <div>Módulo</div><div>Sistema (adjudicado)</div><div>Dictamen</div><div>Diferencia</div>
          </div>
          {buckets.map((b) => filaBucket(b, prop.va.mensualPorModulo[b]))}

          <div style={{ marginTop: 10, fontSize: 13, color: "#334155" }}>
            <b>Prestaciones leídas del dictamen:</b>
            <div style={{ marginTop: 4 }}>
              {prop.va.lineas.map((l, k) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "2px 0", borderBottom: "1px dashed #e2e8f0" }}>
                  <span>{l.nombre}{l.cantAut ? " — " + l.cantAut + " × " + formatoPesos(l.unitario) : ""}</span>
                  <b>{formatoPesos(l.mensual)}</b>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 10, alignItems: "center", marginTop: 12 }}>
            <div>
              <label style={S.label}>Mensual autorizado (editable)</label>
              <input style={S.input} type="number" value={mensualEdit} onChange={(e) => setMensualEdit(e.target.value)} />
            </div>
            <div style={{ fontSize: 14, color: "#334155" }}>
              <div><b>Total {meses} meses:</b> {formatoPesos((Number(mensualEdit) || 0) * meses)}</div>
              {prop.va.diasBase ? <div style={{ color: "#64748b", fontSize: 13 }}>Base de cálculo del dictamen: <b>{prop.va.diasBase} días</b></div> : null}
            </div>
          </div>

          {prop.va.aclaraciones.length > 0 ? (
            <div style={{ marginTop: 10, background: "#fff", border: "1px solid #fcd34d", borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#b45309", marginBottom: 4 }}>Aclaración que irá al considerando / nota:</div>
              {prop.va.aclaraciones.map((a, k) => (
                <div key={k} style={{ fontStyle: "italic", color: "#475569", marginTop: 2 }}>« {textoAclaracionObj(a, false)} »</div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 10, fontSize: 13, color: "#166534" }}>✔ El dictamen coincide con lo adjudicado: no hace falta aclaración.</div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <button style={{ ...S.btn, margin: 0 }} disabled={aplicando} onClick={aplicar}>
              {aplicando ? "Aplicando…" : "✅ Aplicar y recalcular nota + resolución"}
            </button>
            <button style={{ ...S.btnSec, margin: 0 }} disabled={aplicando} onClick={() => setProp(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Tarjeta de ADELANTO: afectación estimada a 31 días (provisoria) ----------
   Aparece sola apenas hay cuadro y todavía no hay valores del dictamen. Muestra el
   número a 31 días y, si querés, lo dejás como afectación provisoria (sin frase de
   dictamen). Cuando vuelve el dictamen definitivo, ese lo confirma o corrige. */
function AfectacionEstimada31({ exp }) {
  const [aplicando, setAplicando] = useState(false);
  const est = estimarAfectacion31(exp);
  if (!est) return null;
  const meses = est.meses;

  const aplicar = async () => {
    setAplicando(true);
    try {
      const va = valoresDesdeEstimacion(exp, est);
      const patch = { valoresAutorizados: va };
      // Provisorio: número sí, frase NO (todavía no hay dictamen que citar).
      if (exp.nota) { patch["nota.monto"] = va.totalAfectar; patch["nota.montoLetras"] = numeroALetras(va.totalAfectar); patch["nota.aclaracion"] = ""; }
      if (exp.resolucion) { patch["resolucion.total"] = va.totalAfectar; patch["resolucion.montoLetras"] = numeroALetras(va.totalAfectar); patch["resolucion.aclaracionDias"] = ""; }
      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), patch);
      alert(
        "🧮 Estimado provisorio aplicado: " + formatoPesos(va.totalAfectar) + " (por " + meses + " meses).\n\n" +
        "La nota y la resolución toman este número, SIN aclaración (todavía no hay dictamen).\n" +
        "Cuando vuelva el dictamen definitivo, subilo en la tarjeta de abajo: confirma o corrige, y recién ahí sale la frase."
      );
    } catch (e) { alert("❌ " + (e.message || e)); }
    finally { setAplicando(false); }
  };

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #f59e0b", marginBottom: 12, background: "#fffdf5" }}>
      <div style={{ fontWeight: 800, color: "#b45309" }}>🧮 Afectación estimada a 31 días (provisoria)</div>
      <div style={{ fontSize: 13, color: "#7c5b13", marginTop: 6 }}>
        Adelanto automático mientras no llega el dictamen: reescala a 31 días las prestaciones por <b>hora/día</b> y deja
        las <b>semanales</b> como están. <b>No reemplaza al dictamen</b> ni predice recortes — cuando vuelva de Auditoría, ese manda.
      </div>

      {est.hayCambio ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10, fontSize: 13, color: "#334155" }}>
            <div><span style={{ color: "#64748b" }}>Adjudicado (30 días)</span><br /><b>{formatoPesos(est.base)}</b>/mes</div>
            <div><span style={{ color: "#64748b" }}>Estimado (31 días)</span><br /><b style={{ color: "#b45309" }}>{formatoPesos(est.mensual31)}</b>/mes</div>
            <div><span style={{ color: "#64748b" }}>Total {meses} meses</span><br /><b>{formatoPesos(est.total31)}</b></div>
          </div>
          <div style={{ fontSize: 12.5, color: "#475569", marginTop: 8 }}>
            Reescalado por día:{" "}
            {est.lineas.filter((l) => l.porDia && l.m31 !== l.m30).map((l) => l.nombre + " (" + formatoPesos(l.m30) + " → " + formatoPesos(l.m31) + ")").join("; ") || "—"}
          </div>
          <button style={{ ...S.btnSec, marginTop: 12 }} disabled={aplicando} onClick={aplicar}>
            {aplicando ? "Aplicando…" : "Usar como afectación provisoria (31 días)"}
          </button>
        </>
      ) : (
        <div style={{ fontSize: 13, color: "#64748b", marginTop: 8 }}>
          A 31 días no cambia respecto de lo adjudicado (no hay prestaciones por día para reescalar, o falta el desglose de
          precios por ítem). Se mantiene el número del cuadro; esperá el dictamen para confirmar.
        </div>
      )}
    </div>
  );
}

function DetalleExpediente({ exp, proveedores, volver, editar, renovar }) {
  // Etapa que se está mirando. Arranca en la actual y se mueve sola cuando el expediente avanza.
  const [abierta, setAbierta] = useState(Math.min(exp.etapa, ETAPAS.length - 1));
  const etapaRef = useRef(exp.etapa);
  useEffect(() => {
    if (etapaRef.current !== exp.etapa) {
      etapaRef.current = exp.etapa;
      setAbierta(Math.min(exp.etapa, ETAPAS.length - 1));
    }
  }, [exp.etapa]);

  const aviso = (texto) => (
    <div style={{ ...S.card, color: "#64748b", fontSize: 14, borderLeft: "5px solid #cbd5e1" }}>{texto}</div>
  );

  // Aviso de plazo: se ve SIEMPRE, aunque la etapa esté cerrada
  const diasPlazo = exp.cotizacion ? diasHabilesDesde(exp.cotizacion.fecha) : null;
  const plazoVencido = exp.etapa <= 1 && diasPlazo != null && diasPlazo > 5;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button style={S.btnSec} onClick={volver}>← Volver al tablero</button>
        <div style={{ flex: 1 }} />
        <button style={S.btnSec} onClick={editar}>✏️ Editar datos</button>
        <button style={S.btnSec} onClick={renovar}>🔄 Renovar período</button>
      </div>

      <div style={S.card}>
        <div style={{ fontWeight: 800, fontSize: 18, color: "#075e75" }}>{exp.paciente.toUpperCase()}</div>
        <div style={{ fontSize: 14, color: "#475569", marginTop: 4 }}>
          <b>Expte.:</b> {exp.nroExpediente} · <b>DNI:</b> {exp.dni} · <b>Edad:</b> {exp.edad} años
        </div>
        <div style={{ fontSize: 14, color: "#475569" }}><b>Diagnóstico:</b> {exp.diagnostico}</div>
        <div style={{ fontSize: 14, color: "#475569" }}><b>Módulo:</b> {exp.modulo}</div>
        <div style={{ fontSize: 14, color: "#475569" }}><b>Período:</b> {exp.periodoMeses} meses {exp.periodoTexto && `(${exp.periodoTexto})`}</div>
        <div style={{ fontSize: 13, marginTop: 4, fontWeight: 700, color: "#0e7490" }}>👤 Responsable: {exp.responsable || "sin asignar"}</div>
      </div>

      {/* ====== DICTAMEN DE AUDITORÍA MÉDICA (documento madre — ancla de todo el expediente) ====== */}
      <FichaDictamen exp={exp} />

      {/* ====== PASO 2: cruce de lo autorizado (dictamen) contra lo cotizado/adjudicado ====== */}
      <CruceDictamenPresupuesto exp={exp} />

      {/* semáforo de etapas: ahora cada chip abre su etapa */}
      <div style={S.card}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ETAPAS.map((nombre, i) => {
            const hecha = i < exp.etapa;
            const actual = i === exp.etapa;
            const alcanzable = i <= exp.etapa;
            const mirando = i === abierta;
            return (
              <button
                key={i}
                onClick={() => setAbierta(i)}
                title={alcanzable ? "Ver esta etapa" : "Todavía no llegaste a esta etapa"}
                style={{
                  ...S.chip(actual, hecha),
                  border: mirando ? "2.5px solid #0891b2" : "2.5px solid transparent",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  opacity: alcanzable ? 1 : 0.55,
                }}
              >
                {hecha ? "✓ " : ""}{nombre}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
          Estás viendo: <b style={{ color: "#0891b2" }}>{ETAPAS[abierta]}</b>. Tocá cualquier etapa para abrirla.
        </div>
      </div>

      {plazoVencido && (
        <div style={{ ...S.card, borderLeft: "5px solid #dc2626", background: "#fef2f2", padding: "10px 14px" }}>
          <span style={{ color: "#dc2626", fontWeight: 800, fontSize: 14 }}>
            ⚠️ Plazo vencido — pasaron {diasPlazo} días hábiles desde el pedido de cotización
          </span>
        </div>
      )}

      {/* ---------- 0) Cotización enviada ---------- */}
      {abierta === 0 && (<>
        {exp.etapa === 0 && <EnvioCotizacion exp={exp} proveedores={proveedores} />}
        {exp.etapa >= 1 && exp.cotizacion && (
          <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
            <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Cotización enviada</div>
            <div style={{ fontSize: 14, color: "#334155" }}>
              <b>Fecha de envío:</b> {formatearFecha(exp.cotizacion.fecha)}{exp.cotizacion.manual && <span style={{ color: "#64748b" }}> (registrado manualmente — el mail salió por fuera del sistema)</span>}<br />
              {exp.cotizacion.firmante && (<><b>Enviado por:</b> {exp.cotizacion.firmante}<br /></>)}
              <b>Proveedores consultados:</b> {exp.cotizacion.proveedores}<br />
              <b>Plazo:</b>{" "}
              {diasPlazo > 5
                ? <span style={{ color: "#dc2626", fontWeight: 700 }}>⚠️ Vencido — pasaron {diasPlazo} días hábiles</span>
                : <span style={{ color: "#f59e0b", fontWeight: 700 }}>Día hábil {diasPlazo} de 5</span>}
              {exp.cotizacion.carpetaUrl && (
                <><br /><a href={exp.cotizacion.carpetaUrl} target="_blank" rel="noreferrer" style={{ color: "#0891b2", fontWeight: 700 }}>📁 Ver carpeta del expediente en Drive</a></>
              )}
            </div>
          </div>
        )}
      </>)}

      {/* ---------- 1) Presupuestos ---------- */}
      {abierta === 1 && (<>
        {exp.etapa === 1 && <RegistroPresupuestos exp={exp} />}
        {exp.etapa < 1 && aviso("Primero hay que enviar el pedido de cotización.")}
        {exp.etapa > 1 && aviso("Los presupuestos ya están cargados y el cuadro generado. Si necesitás corregir un precio o un estado, entrá a la etapa Cuadro comparativo y usá ↩️ Reabrir presupuestos.")}
      </>)}

      {/* ---------- 2) Cuadro comparativo ---------- */}
      {abierta === 2 && (<>
        {exp.etapa >= 3 && exp.cuadro && (
          <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
            <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Cuadro comparativo generado — Adjudicado: {exp.cuadro.adjudicado}</div>
            <div style={{ fontSize: 14, color: "#334155" }}>
              <b>Fecha de adjudicación:</b> {formatearFecha(exp.cuadro.fecha)}<br />
              <b>Precio mensual:</b> {formatoPesos(exp.cuadro.mensual)} · <b>Total {exp.periodoMeses} meses:</b> {formatoPesos(exp.cuadro.total)}
            </div>
            {(exp.cuadro.adjudicaciones || []).length > 1 && (
              <div style={{ fontSize: 14, color: "#334155", marginTop: 4 }}>
                {exp.cuadro.adjudicaciones.map((a, k) => (
                  <div key={k}>🧩 <b>{a.modulo || "Sin módulo"}:</b> {a.proveedor} — {formatoPesos(a.mensual)}/mes</div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <RevisarCuadro exp={exp} proveedores={proveedores} />
              <button
                style={{ ...S.btnSec, marginTop: 10, color: "#b91c1c", borderColor: "#fca5a5" }}
                onClick={async () => {
                  if (!confirm(
                    "↩️ REABRIR PRESUPUESTOS\n\n" +
                    "El expediente vuelve a la etapa de Presupuestos para modificar estados o precios " +
                    "(ej: un proveedor que mandó negativa y después se arrepintió y cotizó).\n\n" +
                    "• Todo lo ya cargado se mantiene (precios, ítems, PDFs, estados)\n" +
                    "• El cuadro comparativo ya generado queda DESACTUALIZADO: cuando termines, generalo de nuevo\n" +
                    (exp.etapa >= 4 ? "• ⚠️ OJO: este expediente ya avanzó a etapas posteriores (nota/pases/resolución). Al reabrir, esas etapas se vuelven a recorrer y esos documentos también habrá que regenerarlos si cambia la adjudicación.\n" : "") +
                    "\n¿Confirmás la reapertura?"
                  )) return;
                  try {
                    await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), { etapa: 1 });
                    alert("✅ Presupuestos reabiertos. Modificá lo que necesites y volvé a generar el cuadro.");
                  } catch (e) {
                    alert("❌ Error al reabrir: " + e.message);
                  }
                }}
              >↩️ Reabrir presupuestos</button>
            </div>
          </div>
        )}
        {exp.etapa < 3 && aviso("El cuadro comparativo se arma desde la etapa Presupuestos, con el botón 👁️ GENERAR Y REVISAR EL CUADRO.")}
      </>)}

      {/* ---------- 3) Nota de afectación ---------- */}
      {abierta === 3 && (<>
        {exp.cuadro && !exp.valoresAutorizados && <AfectacionEstimada31 exp={exp} />}
        {exp.cuadro && <CargarDictamenDefinitivo exp={exp} />}
        {exp.etapa === 3 && <GenerarNota exp={exp} />}
        {exp.etapa >= 4 && exp.nota && (
          <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
            <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Nota de afectación presupuestaria generada</div>
            <div style={{ fontSize: 14, color: "#334155" }}>
              <b>Importe total:</b> {formatoPesos(exp.nota.monto)} ({exp.nota.montoLetras})
            </div>
            <ReabrirGenerador etiqueta="✏️ Modificar y regenerar (fecha, subpartidas, importe)" render={() => <GenerarNota exp={exp} />} />
          </div>
        )}
        {exp.etapa < 3 && aviso("Todavía falta generar el cuadro comparativo.")}
      </>)}

      {/* ---------- 4) Pase a Auditoría Médica ---------- */}
      {abierta === 4 && (<>
        {exp.etapa === 4 && <PaseAuditoria exp={exp} />}
        {exp.etapa >= 5 && (
          exp.paseAuditoria ? (
            <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
              <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Pase a Auditoría Médica generado</div>
              <div style={{ fontSize: 14, color: "#334155" }}>
                <b>Fecha:</b> {formatearFecha(exp.paseAuditoria.fecha)}{exp.paseAuditoria.destinataria ? <> · <b>Dirigido a:</b> {exp.paseAuditoria.destinataria}</> : null}
              </div>
              <ReabrirGenerador etiqueta="✏️ Modificar y regenerar (destinataria, asunto)" render={() => <PaseAuditoria exp={exp} />} />
            </div>
          ) : (
            <>
              {aviso("Este expediente ya avanzó más allá de esta etapa. Si necesitás el pase a Auditoría Médica, generalo acá abajo — ya sale prellenado con los datos del paciente.")}
              <PaseAuditoria exp={exp} />
            </>
          )
        )}
        {exp.etapa < 4 && aviso("Todavía falta la nota de afectación presupuestaria.")}
      </>)}

      {/* ---------- 5) Asesoría Letrada ---------- */}
      {abierta === 5 && (<>
        {exp.etapa === 5 && <PaseLetrada exp={exp} />}
        {exp.etapa >= 6 && exp.paseLetrada && (
          <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
            <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Pase a Asesoría Letrada generado</div>
            <div style={{ fontSize: 14, color: "#334155" }}>
              <b>Fecha:</b> {formatearFecha(exp.paseLetrada.fecha)}
            </div>
            <BotonRevisar construirPlantilla={(logos) => plantillaPase(datosPaseLetrada(exp), logos)} />
          </div>
        )}
        {exp.etapa < 5 && aviso("Todavía falta el pase a Auditoría Médica.")}
      </>)}

      {/* ---------- 6) Resolución ---------- */}
      {abierta === 6 && (<>
        {exp.cuadro && !exp.valoresAutorizados && <AfectacionEstimada31 exp={exp} />}
        {exp.cuadro && <CargarDictamenDefinitivo exp={exp} />}
        {exp.etapa === 6 && <GenerarResolucion exp={exp} />}
        {exp.etapa >= 7 && exp.resolucion && (
          <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
            <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Resolución Interna Nº {exp.resolucion.nro} generada</div>
            <div style={{ fontSize: 14, color: "#334155" }}>
              <b>Fecha:</b> {formatearFecha(exp.resolucion.fecha)}<br />
              <b>Adjudicado:</b> {exp.resolucion.adjudicado} · <b>Monto total:</b> {formatoPesos(exp.resolucion.total)}
            </div>
            <ReabrirGenerador etiqueta="✏️ Modificar y regenerar (firmante, subpartidas, fojas, N°)" render={() => <GenerarResolucion exp={exp} />} />
          </div>
        )}
        {exp.etapa < 6 && aviso("Todavía falta el pase a Auditoría Médica.")}
      </>)}

      {/* ---------- 7) Tribunal de Cuentas ---------- */}
      {abierta === 7 && (<>
        {exp.etapa === 7 && <PaseTribunal exp={exp} />}
        {exp.etapa >= 8 && exp.paseTribunal && (
          <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
            <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Pase al Tribunal de Cuentas generado</div>
            <div style={{ fontSize: 14, color: "#334155" }}>
              <b>Fecha:</b> {formatearFecha(exp.paseTribunal.fecha)}
            </div>
            <BotonRevisar construirPlantilla={(logos) => plantillaPase(datosPaseTribunal(exp), logos)} />
          </div>
        )}
        {exp.etapa < 7 && aviso("Todavía falta la Resolución Interna.")}
      </>)}

      {/* ---------- 8) Orden de compra ---------- */}
      {abierta === 8 && (<>
        {exp.etapa === 8 && <OrdenCompraEnvio exp={exp} proveedores={proveedores} />}
        {exp.etapa >= 9 && exp.oc && (
          <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
            <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Orden de Compra Nº {exp.oc.nro} enviada al adjudicado</div>
            <div style={{ fontSize: 14, color: "#334155" }}>
              <b>Fecha de envío:</b> {formatearFecha(exp.oc.fecha)}<br />
              {exp.oc.firmante && (<><b>Enviado por:</b> {exp.oc.firmante}<br /></>)}
              <b>Destinatarios:</b> {exp.oc.destinatarios}<br />
              {(exp.oc.envios || []).length > 1 && exp.oc.envios.map((e, k) => (
                <div key={k}>🧾 <b>{e.proveedor}</b> — OC Nº {e.nro}{e.modulo ? " (" + e.modulo + ")" : ""}</div>
              ))}
              {exp.oc.pdfUrl && <a href={exp.oc.pdfUrl} target="_blank" rel="noreferrer" style={{ color: "#0891b2", fontWeight: 700 }}>📄 Orden de compra en el Drive</a>}
            </div>
          </div>
        )}
        {exp.etapa >= 9 && (
          <div style={{ ...S.card, background: "#f0fdf4", border: "2px solid #16a34a", textAlign: "center" }}>
            <div style={{ fontSize: 22 }}>🎉</div>
            <div style={{ fontWeight: 800, color: "#166534", fontSize: 16 }}>Expediente completo</div>
            <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
              Las 9 etapas del circuito están cerradas. Cuando se acerque el fin del período, usá <b>🔄 Renovar período</b> para arrancar el trámite nuevo con los datos ya cargados.
            </div>
          </div>
        )}
        {exp.etapa < 8 && aviso("Todavía falta el pase al Tribunal de Cuentas.")}
      </>)}

      <BotonEliminar exp={exp} volver={volver} />
    </div>
  );
}

function BotonEliminar({ exp, volver }) {
  return (
    <div style={{ textAlign: "right" }}>
      <button
        style={S.btnRojo}
        onClick={async () => {
          if (confirm(`¿Eliminar el expediente de ${exp.paciente}? Esta acción no se puede deshacer.`)) {
            await deleteDoc(doc(db, COL_EXPEDIENTES, exp.id));
            volver();
          }
        }}
      >🗑️ Eliminar expediente</button>
    </div>
  );
}

/* ---------- Botón para volver a descargar un documento ya generado ---------- */

function BotonRedescargar({ construirPayload }) {
  const [ocupado, setOcupado] = useState(false);
  return (
    <button
      style={{ ...S.btnSec, marginTop: 10, opacity: ocupado ? 0.6 : 1 }}
      disabled={ocupado}
      onClick={async () => {
        setOcupado(true);
        try { await llamarYDescargar(construirPayload()); }
        catch (e) { alert("\u274c Error al descargar: " + e.message); }
        setOcupado(false);
      }}
    >{ocupado ? "\u23f3 Generando..." : "\u2b07\ufe0f Descargar de nuevo (Excel + PDF)"}</button>
  );
}

/* ---------- Vista previa editable de documentos ---------- */

function VistaPrevia({ construirPlantilla, onListo, onCerrar }) {
  const [plantilla, setPlantilla] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const hojaRef = useRef(null);

  useEffect(() => {
    let vivo = true;
    obtenerLogos().then((logos) => { if (vivo) setPlantilla(construirPlantilla(logos)); });
    return () => { vivo = false; };
  }, []);

  const generar = async (conWord) => {
    setOcupado(true);
    try {
      const body = hojaRef.current.innerHTML;
      const payload = {
        accion: "htmlAPdf",
        titulo: plantilla.titulo,
        html: envolverHtml(plantilla.css, '<div class="hoja">' + body + "</div>", plantilla.apaisado),
      };
      if (conWord) payload.htmlWord = envolverHtml(plantilla.css, '<div class="hoja">' + logosAUrl(body) + "</div>", plantilla.apaisado);
      const data = await llamarYDescargar(payload);
      if (onListo) await onListo({ ...data, montoLetras: plantilla.montoLetras || "" });
      alert("✅ PDF generado y descargado a tu máquina." + (conWord ? "\n📄 También se descargó la versión Word." : ""));
      if (onCerrar) onCerrar();
    } catch (e) {
      alert("❌ Error al generar el PDF: " + e.message);
    }
    setOcupado(false);
  };

  if (!plantilla) {
    return <div style={{ ...S.card, textAlign: "center", color: "#64748b" }}>⏳ Preparando la vista previa...</div>;
  }

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #0891b2", background: "#f8fafc" }}>
      <div style={{ fontWeight: 800, color: "#075e75", marginBottom: 4 }}>👁️ Revisión del documento</div>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>
        Así va a salir el PDF. <b>Si hay algo que corregir, hacé clic sobre el texto y editalo directamente acá</b> — nombres, fechas, fojas, montos, lo que sea. Cuando esté bien, apretá el botón verde.
      </div>
      <style>{plantilla.css + " .hoja .pagina { background:#fff; box-shadow:0 1px 6px rgba(0,0,0,0.3); margin:0 auto 14px; width:" + (plantilla.apaisado ? "1123px" : "794px") + "; min-height:" + (plantilla.apaisado ? "794px" : "1122px") + "; box-sizing:border-box; }"}</style>
      <div style={{ overflowX: "auto", background: "#cbd5e1", padding: 12, borderRadius: 8 }}>
        <div
          className="hoja"
          ref={hojaRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          style={{ outline: "none", minWidth: plantilla.apaisado ? 1123 : 794 }}
          dangerouslySetInnerHTML={{ __html: plantilla.body }}
        />
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button style={{ ...S.btn, flex: 2, minWidth: 220, fontSize: 15, background: "#16a34a", opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => generar(false)}>
          {ocupado ? "⏳ Generando..." : "✅ ESTÁ BIEN — GENERAR PDF"}
        </button>
        <button style={{ ...S.btnSec, flex: 1, minWidth: 130, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => generar(true)}>
          {ocupado ? "⏳..." : "📄 PDF + Word"}
        </button>
        {onCerrar && (
          <button style={{ ...S.btnSec, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={onCerrar}>✖ Cancelar</button>
        )}
      </div>
    </div>
  );
}

function ReabrirGenerador({ etiqueta, render }) {
  const [abierto, setAbierto] = useState(false);
  if (!abierto) {
    return (
      <button style={{ ...S.btnSec, marginTop: 10 }} onClick={() => setAbierto(true)}>
        {etiqueta}
      </button>
    );
  }
  return (
    <div style={{ marginTop: 10 }}>
      <button style={{ ...S.btnSec, marginBottom: 8 }} onClick={() => setAbierto(false)}>▲ Cerrar</button>
      {render()}
    </div>
  );
}

function BotonRevisar({ construirPlantilla, etiqueta }) {
  const [abierto, setAbierto] = useState(false);
  if (!abierto) {
    return (
      <button style={{ ...S.btnSec, marginTop: 10 }} onClick={() => setAbierto(true)}>
        {etiqueta || "👁️ Revisar / descargar de nuevo (PDF o Word)"}
      </button>
    );
  }
  return <VistaPrevia construirPlantilla={construirPlantilla} onCerrar={() => setAbierto(false)} />;
}

/* Revisión del cuadro ya generado: misma pantalla de revisión que en la generación inicial,
   con los textos editables, antes de volver a descargar el PDF/Excel */
function RevisarCuadro({ exp, proveedores = [] }) {
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [textos, setTextos] = useState(null);

  // Envío del cuadro comparativo al proveedor por email
  const [mailAbierto, setMailAbierto] = useState(false);
  const [enviandoMail, setEnviandoMail] = useState(false);
  const [mail, setMail] = useState({ destino: "", asunto: "", cuerpo: "" });

  const payload = payloadCuadro(exp);

  const adjsGuardadas = payload.adjudicaciones && payload.adjudicaciones.length
    ? payload.adjudicaciones
    : [{ modulo: modulosDeItems(payload.items)[0], proveedor: payload.adjudicado.nombre || "", mensual: payload.adjudicado.mensual || 0 }];

  const abrir = () => {
    const previos = (payload.textosAdjudicacion && payload.textosAdjudicacion.length)
      ? payload.textosAdjudicacion
      : (payload.textoAdjudicacion ? [payload.textoAdjudicacion] : []);
    setTextos({
      adjudicaciones: previos.length ? previos : adjsGuardadas.filter((a) => a.proveedor).map((a) =>
        "CONFORME A LO DETALLADO EN EL CUADRO COMPARATIVO , SE ADJUDICA SERVICIO DE " +
        (modulosDeItems(payload.items).length > 1
          ? fraseServicioAdjudicacion(a.modulo, exp)
          : ((exp.modulo || a.modulo) || "").toUpperCase()) +
        " A LA FIRMA : " + (a.proveedor || "").toUpperCase()),
      constancia: payload.textoConstancia || "",
    });
    setAbierto(true);
  };

  const generar = async (conExcel) => {
    setOcupado(true);
    try {
      if (!window.PDFLib) throw new Error("Falta pdf-lib: subí pdf-lib.min.js a la carpeta public y agregá la línea al index.html");
      const logosB = await obtenerLogosBytes();
      const bytes = await crearPdfCuadro(window.PDFLib, {
        nroExpediente: exp.nroExpediente, paciente: exp.paciente, modulo: exp.modulo,
        periodoTexto: exp.periodoTexto, periodoMeses: exp.periodoMeses,
        fechaCorta: fechaCortaHoy(), fmt: formatoPesos,
        items: payload.items, proveedores: payload.proveedores,
        adjudicado: payload.adjudicado,
        adjudicaciones: adjsGuardadas,
        textosAdjudicacion: textos.adjudicaciones,
        textoAdjudicacion: (textos.adjudicaciones || []).join("  "),
        textoConstancia: textos.constancia,
      }, logosB.pris, logosB.gob);
      descargarBytes(bytes, "CUADRO COMPARATIVO " + exp.nroExpediente.replace(/\//g, "-") + " " + exp.paciente.toUpperCase() + ".pdf");
      if (conExcel) {
        await llamarYDescargar({
          ...payload,
          textoAdjudicacion: (textos.adjudicaciones || []).join("  "),
          textosAdjudicacion: textos.adjudicaciones,
          textoConstancia: textos.constancia,
        }, true, false);
      }
      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
        "cuadro.textoAdjudicacion": (textos.adjudicaciones || []).join("  "),
        "cuadro.textosAdjudicacion": textos.adjudicaciones,
        "cuadro.textoConstancia": textos.constancia,
      });
      alert("✅ Cuadro descargado" + (conExcel ? " (PDF + Excel)." : " (PDF)."));
      setAbierto(false);
    } catch (e) {
      alert("❌ Error: " + e.message);
    }
    setOcupado(false);
  };

  /* ---- Envío del cuadro comparativo al proveedor por email ---- */
  const firmaResponsable = (USUARIOS.find((u) => u.id === exp.responsable)?.firma) || FIRMANTES[0];

  const nombresAdjudicados = () => {
    const ns = adjsGuardadas.map((a) => a.proveedor).filter(Boolean);
    const uniq = [...new Set(ns)];
    return uniq.length ? uniq : (payload.adjudicado.nombre ? [payload.adjudicado.nombre] : []);
  };

  const emailsDeProveedores = (nombres) =>
    nombres
      .map((n) => (proveedores.find((p) => p.nombre === n)?.emails) || "")
      .filter(Boolean)
      .join(", ");

  const abrirEnvioMail = () => {
    const nombres = nombresAdjudicados();
    const destino = emailsDeProveedores(nombres);
    const listaProv = nombres.join(" / ") || "el proveedor adjudicado";
    const modTxt = exp.modulo ? (", módulo " + limpiarModulo(exp.modulo)) : "";
    const periodoTxt = exp.periodoTexto ? (", período " + exp.periodoTexto) : "";
    setMail({
      destino,
      asunto: "Cuadro Comparativo — Expte. " + exp.nroExpediente + " — " + exp.paciente,
      cuerpo:
        "Estimados " + listaProv + ":\n\n" +
        "Adjuntamos el Cuadro Comparativo correspondiente al expediente " + exp.nroExpediente +
        ", paciente " + exp.paciente + modTxt + periodoTxt + ".\n\n" +
        "Ante cualquier consulta quedamos a disposición.\n\n" +
        "Saludos cordiales,\n" +
        firmaResponsable + "\n" +
        "Internación Domiciliaria — PRIS",
    });
    setMailAbierto(true);
  };

  const enviarMail = async () => {
    const destinatarios = (mail.destino || "").split(",").map((e) => e.trim()).filter(Boolean);
    if (destinatarios.length === 0) { alert("Poné al menos un correo de destino."); return; }
    if (!mail.asunto.trim()) { alert("El asunto no puede quedar vacío."); return; }
    if (!confirm("Se enviará el cuadro comparativo (PDF) a:\n\n" + destinatarios.map((e) => "• " + e).join("\n") + "\n\n¿Confirmás el envío?")) return;

    setEnviandoMail(true);
    try {
      if (!window.PDFLib) throw new Error("Falta pdf-lib: subí pdf-lib.min.js a la carpeta public y agregá la línea al index.html");
      const logosB = await obtenerLogosBytes();
      const textosAdj = (textos && textos.adjudicaciones)
        ? textos.adjudicaciones
        : (payload.textosAdjudicacion && payload.textosAdjudicacion.length
            ? payload.textosAdjudicacion
            : (payload.textoAdjudicacion ? [payload.textoAdjudicacion] : []));
      const bytes = await crearPdfCuadro(window.PDFLib, {
        nroExpediente: exp.nroExpediente, paciente: exp.paciente, modulo: exp.modulo,
        periodoTexto: exp.periodoTexto, periodoMeses: exp.periodoMeses,
        fechaCorta: fechaCortaHoy(), fmt: formatoPesos,
        items: payload.items, proveedores: payload.proveedores,
        adjudicado: payload.adjudicado,
        adjudicaciones: adjsGuardadas,
        textosAdjudicacion: textosAdj,
        textoAdjudicacion: (textosAdj || []).join("  "),
        textoConstancia: (textos && textos.constancia) || payload.textoConstancia || "",
      }, logosB.pris, logosB.gob);

      const nombrePdf = "CUADRO COMPARATIVO " + exp.nroExpediente.replace(/\//g, "-") + " " + exp.paciente.toUpperCase() + ".pdf";
      const adjuntos = [{ nombre: nombrePdf, mimeType: "application/pdf", base64: bytesABase64(bytes) }];

      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({
          accion: "enviarCotizacion",
          clave: APPS_SCRIPT_CLAVE,
          nroExpediente: exp.nroExpediente,
          paciente: exp.paciente,
          firmante: firmaResponsable,
          asunto: mail.asunto,
          cuerpo: mail.cuerpo,
          destinatarios,
          adjuntos,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Error desconocido en Apps Script");

      alert("✅ Cuadro comparativo enviado por email a " + destinatarios.length + " destinatario(s).");
      setMailAbierto(false);
    } catch (e) {
      alert("❌ Error al enviar: " + e.message + "\n\nRevisá la conexión y el correo de destino.");
    }
    setEnviandoMail(false);
  };

  // Panel de composición del mail (tiene prioridad si está abierto)
  if (mailAbierto) {
    return (
      <div style={{ marginTop: 10, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: 14 }}>
        <div style={{ fontWeight: 800, color: "#166534", marginBottom: 4 }}>📧 Enviar cuadro comparativo al proveedor</div>
        <div style={{ fontSize: 13, color: "#475569", marginBottom: 6 }}>
          Sale desde <b>internaciondomiciliariapris@gmail.com</b> con el PDF del cuadro adjunto. Revisá el destino y el texto antes de enviar.
        </div>

        <label style={S.label}>Para (correo del proveedor — separá con comas si son varios)</label>
        <input style={S.input} value={mail.destino} onChange={(e) => setMail({ ...mail, destino: e.target.value })} placeholder="proveedor@correo.com" />

        <label style={S.label}>Asunto</label>
        <input style={S.input} value={mail.asunto} onChange={(e) => setMail({ ...mail, asunto: e.target.value })} />

        <label style={S.label}>Cuerpo del mensaje</label>
        <textarea style={{ ...S.input, minHeight: 200, fontFamily: "inherit", fontSize: 14 }} value={mail.cuerpo} onChange={(e) => setMail({ ...mail, cuerpo: e.target.value })} />

        <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
          📎 Se adjunta el cuadro comparativo completo, tal cual se descarga (PDF).
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <button style={{ ...S.btn, flex: 2, minWidth: 180, background: "#16a34a", opacity: enviandoMail ? 0.6 : 1 }} disabled={enviandoMail} onClick={enviarMail}>
            {enviandoMail ? "⏳ Generando PDF y enviando..." : "📨 ENVIAR AL PROVEEDOR"}
          </button>
          <button style={{ ...S.btnSec, opacity: enviandoMail ? 0.6 : 1 }} disabled={enviandoMail} onClick={() => setMailAbierto(false)}>✖ Cancelar</button>
        </div>
      </div>
    );
  }

  if (!abierto) {
    return (
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button style={{ ...S.btnSec, marginTop: 10 }} onClick={abrir}>
          👁️ Revisar / descargar de nuevo (PDF o Excel)
        </button>
        <button style={{ ...S.btnSec, marginTop: 10 }} onClick={abrirEnvioMail}>
          📧 Enviar al proveedor por email
        </button>
      </div>
    );
  }

  const listaVisible = payload.proveedores.filter((p) => p.estado !== "sin_respuesta");
  const items = payload.items;
  const modsRev = modulosDeItems(items);
  const variosRev = modsRev.length > 1;
  const adjRevDe = (mod) => adjsGuardadas.find((a) => a.modulo === mod) || { proveedor: "" };
  const ganaRev = (mod, nombre) => !!nombre && adjRevDe(mod).proveedor === nombre;
  const ganaAlgoRev = (nombre) => adjsGuardadas.some((a) => a.proveedor === nombre);
  const ganador = payload.adjudicado.nombre;

  return (
    <div style={{ marginTop: 10, background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 800, color: "#075e75", marginBottom: 8 }}>👁️ Revisión del cuadro comparativo</div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, background: "#fff" }}>
          <thead>
            <tr>
              <th style={{ border: "1px solid #334155", padding: 6, background: "#F2F2F2" }}>PRESTACION</th>
              <th style={{ border: "1px solid #334155", padding: 6, background: "#F2F2F2" }}>CANT</th>
              {listaVisible.map((p) => (
                <th key={p.nombre} colSpan={2} style={{ border: "1px solid #334155", padding: 6, background: ganaAlgoRev(p.nombre) ? "#D9D9D9" : "#F2F2F2" }}>
                  {p.nombre.toUpperCase()}{ganaAlgoRev(p.nombre) ? " 🏆" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modsRev.map((mod) => {
              const delModulo = itemsDelModulo(items, mod);
              const primerIndice = delModulo.length ? delModulo[0].i : -1;
              return (
                <Fragment key={mod}>
                  {variosRev && (
                    <tr>
                      <td colSpan={2 + listaVisible.length * 2} style={{ border: "1px solid #334155", padding: 6, background: "#e2e8f0", fontWeight: 800 }}>
                        🧩 {(mod || "SIN MÓDULO").toUpperCase()}
                        {adjRevDe(mod).proveedor ? " — ADJUDICADO A: " + adjRevDe(mod).proveedor.toUpperCase() : ""}
                      </td>
                    </tr>
                  )}
                  {delModulo.map(({ it, i }) => (
                    <tr key={i}>
                      <td style={{ border: "1px solid #334155", padding: 6 }}>{it.nombre}</td>
                      <td style={{ border: "1px solid #334155", padding: 6, textAlign: "center" }}>{[it.cantTexto, it.cantNum].filter(Boolean).join(" / ")}</td>
                      {listaVisible.map((p) => {
                        const inf = infoModulo(p, mod);
                        const fondo = ganaRev(mod, p.nombre) ? "#E7E6E6" : "#fff";
                        const primero = i === primerIndice;
                        const sinPrecio = p.estado !== "cotizo" || inf.noCotiza;
                        return (
                          <Fragment key={p.nombre}>
                            <td style={{ border: "1px solid #334155", padding: 6, textAlign: "center", fontWeight: 700, background: fondo, fontSize: inf.modo === "modulo" ? 11 : 13 }}>
                              {sinPrecio
                                ? (primero ? "NO COTIZÓ" : "")
                                : inf.modo === "modulo"
                                  ? (primero ? (inf.leyenda || "COTIZA POR MÓDULO") : "")
                                  : formatoPesos(p.items[i]?.unitario)}
                            </td>
                            <td style={{ border: "1px solid #334155", padding: 6, textAlign: "center", fontWeight: 700, background: fondo }}>
                              {!sinPrecio && inf.modo !== "modulo" ? formatoPesos(p.items[i]?.mensual) : ""}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  ))}
                  {(variosRev || items.length > 1) && (
                    <tr>
                      <td colSpan={2} style={{ border: "1px solid #334155", padding: 6, fontWeight: 800 }}>
                        {variosRev ? "SUBTOTAL " + (mod || "SIN MÓDULO").toUpperCase() : "TOTAL MENSUAL"}
                      </td>
                      {listaVisible.map((p) => {
                        const st = subtotalModulo(p, items, mod);
                        const fondo = ganaRev(mod, p.nombre) ? "#E7E6E6" : "#fff";
                        return (
                          <Fragment key={p.nombre}>
                            <td style={{ border: "1px solid #334155", padding: 6, background: fondo }}></td>
                            <td style={{ border: "1px solid #334155", padding: 6, textAlign: "center", fontWeight: 800, background: fondo }}>
                              {st != null ? formatoPesos(st) : ""}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {variosRev && (
              <tr>
                <td colSpan={2 + listaVisible.length * 2} style={{ border: "1px solid #334155", padding: 6, background: "#D9D9D9", fontWeight: 800, textAlign: "right" }}>
                  TOTAL MENSUAL ADJUDICADO: {formatoPesos(totalMensualAdjudicado(adjsGuardadas))}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
        Los precios salen de los presupuestos cargados — si hay que corregir un precio, usá "↩️ Reabrir presupuestos". Los textos de abajo sí podés editarlos acá.
      </div>

      <label style={S.label}>
        {(textos.adjudicaciones || []).length > 1 ? "Textos de adjudicación (un recuadro gris por módulo)" : "Texto de adjudicación (recuadro gris del cuadro)"}
      </label>
      {(textos.adjudicaciones || []).map((t, k) => (
        <textarea key={k} style={{ ...S.input, minHeight: 60, marginBottom: 6 }} value={t}
          onChange={(e) => {
            const arr = [...textos.adjudicaciones];
            arr[k] = e.target.value;
            setTextos({ ...textos, adjudicaciones: arr });
          }} />
      ))}

      <label style={S.label}>Texto de constancia (proveedores consultados)</label>
      <textarea style={{ ...S.input, minHeight: 90 }} value={textos.constancia}
        onChange={(e) => setTextos({ ...textos, constancia: e.target.value })} placeholder="Se genera automáticamente si lo dejás vacío" />

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button style={{ ...S.btn, flex: 2, minWidth: 180, background: "#16a34a", opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => generar(false)}>
          {ocupado ? "⏳ Generando..." : "✅ ESTÁ BIEN — GENERAR PDF"}
        </button>
        <button style={{ ...S.btnSec, flex: 1, minWidth: 130, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => generar(true)}>
          {ocupado ? "⏳..." : "📊 PDF + Excel"}
        </button>
        <button style={{ ...S.btnSec, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => setAbierto(false)}>✖ Cancelar</button>
      </div>
    </div>
  );
}

/* ---------- Pase a Auditoría Médica (documento del inicio del trámite) ---------- */

function PaseAuditoria({ exp }) {
  const [destinataria, setDestinataria] = useState(exp.paseAuditoria?.destinataria || "Farm. María Gabriela Policelli");
  const [asunto, setAsunto] = useState(exp.paseAuditoria?.asunto || asuntoAuditoria(exp));
  const [revisando, setRevisando] = useState(false);

  if (revisando) {
    return (
      <VistaPrevia
        construirPlantilla={(logos) => plantillaPase(datosPaseAuditoria(exp, { destinataria, asunto }), logos)}
        onCerrar={() => setRevisando(false)}
        onListo={async () => {
          await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
            etapa: Math.max(exp.etapa, 5),
            paseAuditoria: { fecha: new Date().toISOString(), destinataria, asunto },
          });
        }}
      />
    );
  }

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #f59e0b" }}>
      <h3 style={{ color: "#075e75", marginBottom: 4 }}>🩺 Pase a Auditoría Médica</h3>
      <div style={{ fontSize: 13, color: "#64748b" }}>
        Nota dirigida al Departamento de Auditoría Médica solicitando intervención de competencia (para el dictamen). La revisás en pantalla y generás el PDF. Ya sale prellenada con los datos del paciente. Después seguís con Asesoría Letrada.
      </div>

      <label style={S.label}>Jefa del Departamento (destinataria)</label>
      <input style={S.input} value={destinataria} onChange={(e) => setDestinataria(e.target.value)} />

      <label style={S.label}>Asunto (3ª línea de la REF)</label>
      <input style={S.input} value={asunto} onChange={(e) => setAsunto(e.target.value)} placeholder="Renovación Internación Domiciliaria" />

      <button style={{ ...S.btn, marginTop: 16, width: "100%", fontSize: 16 }} onClick={() => setRevisando(true)}>
        👁️ GENERAR Y REVISAR EL PASE
      </button>
    </div>
  );
}

/* ---------- Envío de cotización ---------- */

function EnvioCotizacion({ exp, proveedores }) {
  const activos = proveedores.filter((p) => p.activo);
  const firmaInicial = (USUARIOS.find((u) => u.id === exp.responsable)?.firma) || FIRMANTES[0];
  const [seleccion, setSeleccion] = useState({});
  const [firmante, setFirmante] = useState(firmaInicial);
  const [asunto, setAsunto] = useState(`SOLICITAMOS COTIZACION PARA ${exp.paciente.toUpperCase()}`);
  const [cuerpo, setCuerpo] = useState(generarCuerpoMail(exp, firmaInicial));
  const [archivos, setArchivos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [fechaManual, setFechaManual] = useState(new Date().toISOString().slice(0, 10));

  const cambiarFirmante = (nuevo) => {
    setFirmante(nuevo);
    setCuerpo(generarCuerpoMail(exp, nuevo)); // regenera el texto con la firma nueva
  };

  // por defecto, todos los proveedores activos marcados
  useEffect(() => {
    const sel = {};
    activos.forEach((p) => (sel[p.id] = true));
    setSeleccion(sel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedores.length]);

  // Para cuando el mail ya salió por fuera del sistema (ej: bloqueo de red en la oficina):
  // registra la cotización como enviada SIN mandar ningún mail, con la fecha real del envío.
  const registrarManual = async () => {
    const elegidos = activos.filter((p) => seleccion[p.id]);
    if (elegidos.length === 0) { alert("Seleccioná los proveedores a los que les mandaste el mail."); return; }
    if (!fechaManual) { alert("Cargá la fecha en que enviaste el mail."); return; }
    if (!confirm(`REGISTRO MANUAL (no envía ningún mail)\n\nSe va a registrar que el pedido de cotización ya fue enviado por fuera del sistema:\n\n• Fecha: ${fechaManual.split("-").reverse().join("/")}\n• Enviado por: ${firmante}\n• Proveedores: ${elegidos.map((p) => p.nombre).join(", ")}\n\nEl expediente pasa a la etapa de Presupuestos. ¿Confirmás?`)) return;

    setEnviando(true);
    try {
      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
        etapa: 1,
        cotizacion: {
          fecha: new Date(fechaManual + "T12:00:00").toISOString(),
          firmante,
          proveedores: elegidos.map((p) => p.nombre).join(", "),
          manual: true,
        },
      });
      alert("✅ Cotización registrada como enviada manualmente. El expediente pasó a la etapa de Presupuestos.");
    } catch (e) {
      alert("❌ Error al registrar: " + e.message);
    }
    setEnviando(false);
  };

  const enviar = async () => {
    const elegidos = activos.filter((p) => seleccion[p.id]);
    if (elegidos.length === 0) { alert("Seleccioná al menos un proveedor."); return; }
    if (archivos.length === 0 && !confirm("No adjuntaste la historia clínica. ¿Enviar igual sin adjuntos?")) return;
    if (!confirm(`Se enviará el mail de cotización a ${elegidos.length} proveedor(es):\n\n${elegidos.map((p) => "• " + p.nombre).join("\n")}\n\n¿Confirmás el envío?`)) return;

    setEnviando(true);
    try {
      const adjuntos = [];
      for (const a of archivos) {
        adjuntos.push({ nombre: a.name, mimeType: a.type || "application/pdf", base64: await leerArchivoBase64(a) });
      }
      const destinatarios = elegidos.flatMap((p) => p.emails.split(",").map((e) => e.trim()).filter(Boolean));

      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({
          accion: "enviarCotizacion",
          clave: APPS_SCRIPT_CLAVE,
          nroExpediente: exp.nroExpediente,
          paciente: exp.paciente,
          firmante,
          asunto, cuerpo, destinatarios, adjuntos,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Error desconocido en Apps Script");

      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
        etapa: 1,
        cotizacion: {
          fecha: new Date().toISOString(),
          proveedores: elegidos.map((p) => p.nombre).join(", "),
          destinatarios: destinatarios.join(", "),
          firmante,
          asunto,
          carpetaUrl: data.carpetaUrl || "",
        },
      });
      alert("✅ Mail de cotización enviado correctamente a " + elegidos.length + " proveedor(es).");
    } catch (e) {
      alert("❌ Error al enviar: " + e.message + "\n\nRevisá la URL del Apps Script y la conexión.");
    }
    setEnviando(false);
  };

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #f59e0b" }}>
      <h3 style={{ color: "#075e75", marginBottom: 4 }}>✉️ Enviar pedido de cotización</h3>
      <div style={{ fontSize: 13, color: "#64748b" }}>
        El mail sale desde <b>internaciondomiciliariapris@gmail.com</b> con copia (CC) a todos los proveedores seleccionados, igual que lo hacés hoy. Todo queda guardado en el Drive.
      </div>

      <label style={S.label}>Proveedores a consultar</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {activos.map((p) => (
          <label key={p.id} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
            borderRadius: 8, border: "1.5px solid " + (seleccion[p.id] ? "#0891b2" : "#cbd5e1"),
            background: seleccion[p.id] ? "#e0f2fe" : "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600,
          }}>
            <input type="checkbox" checked={!!seleccion[p.id]} onChange={(e) => setSeleccion({ ...seleccion, [p.id]: e.target.checked })} />
            {p.nombre}
          </label>
        ))}
        {activos.length === 0 && <div style={{ color: "#dc2626", fontSize: 14 }}>No hay proveedores activos. Cargalos en la pestaña 🏢 Proveedores.</div>}
      </div>

      <label style={S.label}>¿Quién envía este pedido? (la firma sale en el mail)</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {FIRMANTES.map((f) => (
          <label key={f} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
            borderRadius: 8, border: "1.5px solid " + (firmante === f ? "#0891b2" : "#cbd5e1"),
            background: firmante === f ? "#e0f2fe" : "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600,
          }}>
            <input type="radio" name="firmante" checked={firmante === f} onChange={() => cambiarFirmante(f)} />
            {f}
          </label>
        ))}
      </div>

      <label style={S.label}>Asunto</label>
      <input style={S.input} value={asunto} onChange={(e) => setAsunto(e.target.value)} />

      <label style={S.label}>Cuerpo del mail — lo que ves acá es lo que sale. Para poner una palabra en NEGRITA encerrala entre asteriscos: *así*. Las viñetas (•) y los centrados del formato oficial se aplican solos.</label>
      <textarea style={{ ...S.input, minHeight: 260, fontFamily: "inherit", fontSize: 14 }} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} />

      <label style={S.label}>Adjuntos (historia clínica, pedido médico, etc. — PDF)</label>
      <input type="file" accept="application/pdf" multiple style={{ marginTop: 6 }} onChange={(e) => setArchivos([...e.target.files])} />
      {archivos.length > 0 && (
        <div style={{ fontSize: 13, color: "#334155", marginTop: 6 }}>
          {archivos.map((a, i) => <div key={i}>📎 {a.name} ({(a.size / 1024 / 1024).toFixed(1)} MB)</div>)}
        </div>
      )}

      <button style={{ ...S.btn, marginTop: 18, width: "100%", fontSize: 16, opacity: enviando ? 0.6 : 1 }} onClick={enviar} disabled={enviando}>
        {enviando ? "⏳ Enviando mail y guardando en Drive..." : "📨 ENVIAR PEDIDO DE COTIZACIÓN"}
      </button>

      <div style={{ marginTop: 16, padding: 12, background: "#f8fafc", borderRadius: 8, border: "1px dashed #94a3b8" }}>
        <div style={{ fontWeight: 700, color: "#334155", fontSize: 14 }}>✔️ ¿Ya mandaste este mail a mano, por fuera del sistema?</div>
        <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
          Registralo acá para que el expediente avance sin enviar nada: marcá arriba los proveedores a los que se lo mandaste, elegí quién lo envió, poné la fecha real (así el plazo de 5 días hábiles corre bien) y confirmá.
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={{ ...S.label, marginTop: 0 }}>Fecha en que lo enviaste</label>
            <input type="date" style={S.input} value={fechaManual} onChange={(e) => setFechaManual(e.target.value)} />
          </div>
          <button style={{ ...S.btnSec, opacity: enviando ? 0.6 : 1, padding: "10px 16px" }} disabled={enviando} onClick={registrarManual}>
            ✔️ Registrar como ya enviado (sin mandar mail)
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Registro de presupuestos (Fase 2) ---------- */

function RegistroPresupuestos({ exp }) {
  const consultados = (exp.cotizacion?.proveedores || "").split(",").map((s) => s.trim()).filter(Boolean);
  const guardados = exp.presupuestos || {};

  // ---- Ítems del módulo (una fila del cuadro por cada uno) ----
  // Saca las prestaciones de lo que ya cargaste para el mail de cotización:
  // solo toma las líneas tipo "Nombre: cantidad" (descarta encabezados y frases largas)
  // y deduce el número de hs/sesiones del texto de la cantidad.
  // Propone las prestaciones desde el detalle de servicios cargado para el mail,
  // y COMPLETA con las prestaciones autorizadas del dictamen que no hayan quedado
  // en ese detalle (así no se cae ninguna autorizada aunque el detalle salga
  // incompleto del parseo del PDF). El detalle manda en la redacción; el dictamen
  // solo agrega lo que falte.
  const proponerItems = () => {
    const propuestos = extraerItemsDeTexto(exp.detalleServicios);
    const autorizadas = (exp.dictamen?.prestaciones || [])
      .filter((p) => (p.nombre || "").trim() !== "" && (p.cantidad || "").trim() !== "");
    autorizadas.forEach((p) => {
      const yaEsta = propuestos.some((it) => matchPrestacion(it.nombre, p.nombre));
      if (!yaEsta) propuestos.push({ nombre: p.nombre.trim(), cantTexto: p.cantidad.trim(), cantNum: "" });
    });
    if (propuestos.length === 0) propuestos.push({ nombre: exp.modulo || "", cantTexto: "", cantNum: "" });
    return propuestos;
  };
  const itemsIniciales = () => (exp.itemsPrestacion?.length ? exp.itemsPrestacion : proponerItems());
  const [items, setItems] = useState(itemsIniciales);
  const [editandoItems, setEditandoItems] = useState(false);
  const [pegando, setPegando] = useState(false);
  const [textoPegado, setTextoPegado] = useState("");

  const setItem = (i, campo, valor) => {
    const nuevos = items.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it));
    setItems(nuevos);
  };
  const agregarItem = () => setItems([...items, {
    nombre: "", cantTexto: "", cantNum: "",
    modulo: items.length ? (items[items.length - 1].modulo || "") : "",
  }]);

  const aplicarItemsNuevos = (nuevos, origen) => {
    if (!confirm(`Se van a reemplazar los ítems actuales por los extraídos ${origen}:\n\n${nuevos.map((p) => "• " + p.nombre + (p.cantTexto ? " (" + p.cantTexto + ")" : "")).join("\n")}\n\nLos precios ya cargados por ítem se limpian (los estados de los proveedores se mantienen). ¿Continuar?`)) return false;
    setItems(nuevos);
    setDatos((d) => {
      const nd = {};
      Object.keys(d).forEach((n) => { nd[n] = { ...d[n], items: [] }; });
      return nd;
    });
    return true;
  };
  const quitarItem = (i) => {
    if (items.length === 1) { alert("Tiene que quedar al menos un ítem."); return; }
    if (!confirm(`¿Quitar el ítem "${items[i].nombre || "(sin nombre)"}"? Se borran también los precios cargados en esa fila.`)) return;
    setItems(items.filter((_, idx) => idx !== i));
    setDatos((d) => {
      const nd = {};
      Object.keys(d).forEach((n) => {
        nd[n] = { ...d[n], items: (d[n].items || []).filter((_, idx) => idx !== i) };
      });
      return nd;
    });
  };

  // ---- Datos por proveedor: precios por ítem ----
  const itemsProveedorIniciales = (g) => {
    if (g?.items?.length) return g.items.map((it) => ({ unitario: it.unitario ?? "", mensual: it.mensual ?? "" }));
    if (g?.mensual != null) return [{ unitario: g.unitario ?? "", mensual: g.mensual ?? "" }]; // compatibilidad con lo cargado antes
    return [];
  };
  const [datos, setDatos] = useState(() => {
    const d = {};
    consultados.forEach((n) => {
      d[n] = {
        estado: guardados[n]?.estado || "",
        pdfNombre: guardados[n]?.pdfNombre || "",
        items: itemsProveedorIniciales(guardados[n]),
        modulos: guardados[n]?.modulos ? JSON.parse(JSON.stringify(guardados[n].modulos)) : {},
      };
    });
    return d;
  });
  const [archivos, setArchivos] = useState({});
  const [ocupado, setOcupado] = useState(false);
  const [abiertos, setAbiertos] = useState({});
  const [autoInfo, setAutoInfo] = useState("");
  const [leyendoPdf, setLeyendoPdf] = useState({}); // { [proveedor]: true } mientras lee el PDF
  const [infoPdf, setInfoPdf] = useState({});       // { [proveedor]: "mensaje del resultado" }
  const primerRender = useRef(true);
  const timerAuto = useRef(null);

  const setProv = (nombre, campo, valor) =>
    setDatos({ ...datos, [nombre]: { ...datos[nombre], [campo]: valor } });

  const setProvItem = (nombre, i, campo, valor) => {
    const d = datos[nombre];
    const arr = [];
    for (let k = 0; k < items.length; k++) arr[k] = d.items?.[k] || { unitario: "", mensual: "" };
    arr[i] = { ...arr[i], [campo]: valor };
    setDatos({ ...datos, [nombre]: { ...d, items: arr } });
  };

  // 📄→💲 Lee el PDF recién elegido y precarga los casilleros (unitario/mensual)
  // por ítem. NO sube nada al Drive todavía (eso sigue pasando al tocar "Guardar");
  // acá solo llenamos los precios, y todo queda editable.
  const leerPreciosDelPdf = async (nombre, file) => {
    if (!file) return;
    setLeyendoPdf((s) => ({ ...s, [nombre]: true }));
    setInfoPdf((s) => ({ ...s, [nombre]: "" }));
    try {
      let texto = "";
      const esPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name);
      if (esPdf) {
        texto = await textoDePdf(file);
        // PDF escaneado (sin capa de texto) → rasterizar y OCR
        if (_norm(texto).replace(/[^a-z]/g, "").length < 30) texto = await ocrPdfEscaneado(file);
      } else {
        texto = await ocrImagen(file);
      }
      const precios = extraerPreciosDePdf(texto, items);
      const enc = precios.filter((p) => p.encontrado).length;
      if (enc === 0) {
        setInfoPdf((s) => ({ ...s, [nombre]: "⚠️ Leí el PDF pero no pude identificar precios por ítem. Cargalos a mano — el PDF igual se sube al guardar." }));
      } else {
        setDatos((prev) => {
          const d = prev[nombre] || {};
          const arr = [];
          for (let k = 0; k < items.length; k++) {
            const base = d.items?.[k] || { unitario: "", mensual: "" };
            const p = precios[k];
            arr[k] = p && p.encontrado
              ? {
                  unitario: p.unitario !== "" ? p.unitario : base.unitario,
                  mensual: p.mensual !== "" ? p.mensual : base.mensual,
                }
              : base;
          }
          return { ...prev, [nombre]: { ...d, estado: d.estado || "cotizo", items: arr } };
        });
        const faltan = precios.map((p, i) => (!p.encontrado ? (items[i]?.nombre || "ítem " + (i + 1)) : null)).filter(Boolean);
        setInfoPdf((s) => ({
          ...s,
          [nombre]: `✅ Precargué ${enc} de ${items.length} ítem(s) desde el PDF. Revisá y corregí lo que haga falta.` +
            (faltan.length ? ` Quedaron sin precio: ${faltan.join(", ")}.` : ""),
        }));
      }
    } catch (e) {
      setInfoPdf((s) => ({ ...s, [nombre]: "❌ No pude leer el PDF automáticamente (" + (e.message || e) + "). Cargá los precios a mano — el archivo igual se sube al guardar." }));
    }
    setLeyendoPdf((s) => ({ ...s, [nombre]: false }));
  };

  const setProvModulo = (nombre, mod, campo, valor) => {
    const d = datos[nombre] || {};
    const mods = { ...(d.modulos || {}) };
    mods[mod] = { ...(mods[mod] || {}), [campo]: valor };
    setDatos({ ...datos, [nombre]: { ...d, modulos: mods } });
  };

  const sumaMensual = (arrItems) => (arrItems || []).reduce((s, it) => s + (Number(it?.mensual) || 0), 0);

  // Lista de módulos del expediente y si hay más de uno
  const modulos = modulosDeItems(items);
  const variosModulos = modulos.length > 1;
  const nombreModulo = (m) => m || "Sin módulo";

  // ---- Adjudicación partida (Internación / Alimentación por separado) ----
  const MOD_INTERNACION = "INTERNACION DOMICILIARIA";
  const MOD_ALIMENTACION = "ALIMENTACION ENTERAL";
  const esItemAlimentacion = (it) => /aliment|nutric/i.test((it && it.nombre) || "");

  const activarSplit = () => {
    const idxAlim = items.findIndex(esItemAlimentacion);
    if (idxAlim < 0 && !confirm(
      "No encontré una prestación de Alimentación por el nombre.\n\nPuedo asignar todo a Internación y vos ponés a mano el módulo de la fila de alimentación. ¿Seguir igual?"
    )) return;
    // 1) Asignar módulo a cada ítem: alimentación → ALIMENTACIÓN, el resto → INTERNACIÓN.
    setItems(items.map((it) => ({ ...it, modulo: esItemAlimentacion(it) ? MOD_ALIMENTACION : MOD_INTERNACION })));
    // 2) A quien cotizó pero NO cargó alimentación (fila vacía o en 0), marcarle
    //    "no cotiza" ese módulo, para que no compita en $0 y no lo gane por error.
    if (idxAlim >= 0) {
      setDatos((prev) => {
        const nd = { ...prev };
        consultados.forEach((n) => {
          const d = prev[n];
          if (!d || d.estado !== "cotizo") return;
          const fila = d.items && d.items[idxAlim];
          const m = fila ? Number(fila.mensual) : NaN;
          const sinAlim = !fila || fila.mensual === "" || fila.mensual == null || m === 0 || isNaN(m);
          if (sinAlim) {
            const mods = { ...(d.modulos || {}) };
            mods[MOD_ALIMENTACION] = { ...(mods[MOD_ALIMENTACION] || {}), noCotiza: true };
            nd[n] = { ...d, modulos: mods };
          }
        });
        return nd;
      });
    }
  };

  const desactivarSplit = () => {
    if (!confirm("Vas a volver a una sola firma para todo el expediente.\n\nSe quitan los módulos de las prestaciones (los precios cargados se mantienen). ¿Seguir?")) return;
    setItems(items.map((it) => ({ ...it, modulo: "" })));
  };

  // Subtotal en pantalla de un proveedor para un módulo (con lo tipeado, no lo guardado)
  const subtotalEnPantalla = (nombre, mod) => {
    const d = datos[nombre] || {};
    const inf = (d.modulos || {})[mod] || {};
    if (inf.noCotiza) return null;
    if (inf.modo === "modulo") {
      return inf.montoModulo !== "" && inf.montoModulo != null ? Number(inf.montoModulo) : null;
    }
    let suma = 0, hay = false;
    itemsDelModulo(items, mod).forEach(({ i }) => {
      const v = d.items?.[i]?.mensual;
      if (v !== "" && v != null && !isNaN(Number(v))) { suma += Number(v); hay = true; }
    });
    return hay ? suma : null;
  };
  const mensualEnPantalla = (nombre) =>
    modulos.reduce((s, m) => s + (subtotalEnPantalla(nombre, m) || 0), 0);

  // Registro parcial de un proveedor con lo tipeado hasta ahora (para el autoguardado)
  const registroParcial = (nombre) => {
    const d = datos[nombre] || {};
    if (!d.estado) return null;
    const its = d.estado === "cotizo"
      ? items.map((it, i) => ({
          nombre: it.nombre,
          unitario: d.items?.[i]?.unitario !== "" && d.items?.[i]?.unitario != null ? Number(d.items[i].unitario) : null,
          mensual: d.items?.[i]?.mensual !== "" && d.items?.[i]?.mensual != null ? Number(d.items[i].mensual) : null,
        }))
      : [];
    const mods = {};
    if (d.estado === "cotizo") {
      modulos.forEach((m) => {
        const inf = (d.modulos || {})[m] || {};
        mods[m] = {
          modo: inf.modo === "modulo" ? "modulo" : "item",
          noCotiza: !!inf.noCotiza,
          montoModulo: inf.montoModulo !== "" && inf.montoModulo != null ? Number(inf.montoModulo) : null,
          leyenda: inf.leyenda || "",
        };
      });
    }
    const totalMes = d.estado === "cotizo" ? mensualEnPantalla(nombre) : null;
    return {
      estado: d.estado,
      items: its,
      modulos: mods,
      mensual: totalMes || null,
      unitario: d.estado === "cotizo" && its.length === 1 && its[0].unitario != null ? its[0].unitario : null,
      pdfNombre: d.pdfNombre || "",
      fecha: guardados[nombre]?.fecha || new Date().toISOString(),
    };
  };

  // 💾 GUARDADO AUTOMÁTICO: todo lo que se tipea (ítems, estados y precios)
  // se graba solo en la base ~1,5 s después del último cambio.
  useEffect(() => {
    if (primerRender.current) { primerRender.current = false; return; }
    if (timerAuto.current) clearTimeout(timerAuto.current);
    setAutoInfo("💾 Guardando...");
    timerAuto.current = setTimeout(async () => {
      try {
        const cambios = { itemsPrestacion: items };
        consultados.forEach((n) => {
          const r = registroParcial(n);
          if (r) cambios["presupuestos." + n] = r;
        });
        await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), cambios);
        setAutoInfo("✓ Guardado automáticamente " + new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }));
      } catch (e) {
        setAutoInfo("⚠️ No se pudo autoguardar — usá los botones Guardar");
      }
    }, 1500);
    return () => { if (timerAuto.current) clearTimeout(timerAuto.current); };
  }, [datos, items]);

  const guardarProveedor = async (nombre) => {
    const d = datos[nombre];
    if (!d.estado) { alert("Marcá el estado del presupuesto de " + nombre); return; }
    if (d.estado === "cotizo") {
      let algunModulo = false;
      for (const mod of modulos) {
        const inf = (d.modulos || {})[mod] || {};
        if (inf.noCotiza) continue;
        if (inf.modo === "modulo") {
          if (inf.montoModulo === "" || inf.montoModulo == null) {
            alert(`Cargá el monto mensual del módulo "${nombreModulo(mod)}" para ${nombre}, o marcalo como "no cotiza".`);
            return;
          }
          algunModulo = true;
          continue;
        }
        for (const { it, i } of itemsDelModulo(items, mod)) {
          const pi = d.items?.[i];
          if (!pi || pi.unitario === "" || pi.unitario == null || pi.mensual === "" || pi.mensual == null) {
            alert(`Cargá el precio unitario y el mensual de "${it.nombre || "ítem " + (i + 1)}" para ${nombre}.`);
            return;
          }
        }
        algunModulo = true;
      }
      if (!algunModulo) {
        alert(`${nombre} quedó con todos los módulos marcados como "no cotiza". Si no cotizó nada, marcalo como negativa o sin respuesta.`);
        return;
      }
    }
    setOcupado(true);
    try {
      let pdfNombre = d.pdfNombre || "";
      const archivo = archivos[nombre];
      if (archivo) {
        const base64 = await leerArchivoBase64(archivo);
        const res = await fetch(APPS_SCRIPT_URL, {
          method: "POST",
          body: JSON.stringify({
            accion: "subirPresupuesto", clave: APPS_SCRIPT_CLAVE,
            nroExpediente: exp.nroExpediente, paciente: exp.paciente,
            proveedor: nombre, esNegativa: d.estado === "desestimo",
            adjunto: { nombre: archivo.name, mimeType: archivo.type || "application/pdf", base64 },
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Error al subir el PDF");
        pdfNombre = archivo.name;
      }
      const itemsRegistro = d.estado === "cotizo"
        ? items.map((it, i) => ({
            nombre: it.nombre,
            unitario: d.items?.[i]?.unitario !== "" && d.items?.[i]?.unitario != null ? Number(d.items[i].unitario) : null,
            mensual: d.items?.[i]?.mensual !== "" && d.items?.[i]?.mensual != null ? Number(d.items[i].mensual) : null,
          }))
        : [];
      const modulosRegistro = {};
      if (d.estado === "cotizo") {
        modulos.forEach((m) => {
          const inf = (d.modulos || {})[m] || {};
          modulosRegistro[m] = {
            modo: inf.modo === "modulo" ? "modulo" : "item",
            noCotiza: !!inf.noCotiza,
            montoModulo: inf.montoModulo !== "" && inf.montoModulo != null ? Number(inf.montoModulo) : null,
            leyenda: inf.leyenda || "",
          };
        });
      }
      const registro = {
        estado: d.estado,
        items: itemsRegistro,
        modulos: modulosRegistro,
        mensual: d.estado === "cotizo" ? mensualEnPantalla(nombre) : null,
        unitario: d.estado === "cotizo" && itemsRegistro.length === 1 ? itemsRegistro[0].unitario : null,
        pdfNombre,
        fecha: new Date().toISOString(),
      };
      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
        ["presupuestos." + nombre]: registro,
        itemsPrestacion: items,
      });
      setDatos({ ...datos, [nombre]: { ...d, pdfNombre } });
      setAbiertos({ ...abiertos, [nombre]: false });
      alert("✅ Guardado: " + nombre + (d.estado === "cotizo" ? " — Mensual total: " + formatoPesos(registro.mensual) : ""));
    } catch (e) {
      alert("❌ Error: " + e.message);
    }
    setOcupado(false);
  };

  const cotizantes = consultados.filter((n) => (guardados[n]?.estado) === "cotizo");
  const pendientes = consultados.filter((n) => !guardados[n]?.estado);

  const [previa, setPrevia] = useState(null);

  const itemsDeGuardado = (g) => {
    if (g?.items?.length) return g.items;
    if (g?.mensual != null) return [{ nombre: items[0]?.nombre || exp.modulo, unitario: g.unitario, mensual: g.mensual }];
    return [];
  };

  const textoAdjudicacionDe = (a) =>
    "CONFORME A LO DETALLADO EN EL CUADRO COMPARATIVO , SE ADJUDICA SERVICIO DE " +
    (variosModulos ? fraseServicioAdjudicacion(a.modulo, exp) : ((exp.modulo || a.modulo) || "").toUpperCase()) +
    " A LA FIRMA : " + (a.proveedor || "").toUpperCase();

  const abrirPrevia = () => {
    if (cotizantes.length === 0) { alert("Todavía no hay ningún proveedor con presupuesto cargado (Cotizó)."); return; }
    if (pendientes.length > 0 && !confirm(`Hay proveedores sin marcar: ${pendientes.join(", ")}.\n\nSi seguís, quedarán registrados como SIN RESPUESTA. ¿Continuar?`)) return;

    const lista = consultados.map((n) => ({
      nombre: n,
      estado: guardados[n]?.estado || "sin_respuesta",
      mensual: guardados[n]?.mensual ?? null,
      items: itemsDeGuardado(guardados[n]),
      modulos: guardados[n]?.modulos || {},
    }));

    // Cada proveedor que cotizó tiene que tener, en cada módulo, precios completos o "no cotiza"
    for (const p of lista.filter((x) => x.estado === "cotizo")) {
      for (const mod of modulos) {
        const inf = infoModulo(p, mod);
        if (inf.noCotiza) continue;
        if (inf.modo === "modulo") {
          if (inf.montoModulo == null) {
            alert(`A ${p.nombre} le falta el monto mensual del módulo "${nombreModulo(mod)}".`); return;
          }
          continue;
        }
        const falta = itemsDelModulo(items, mod).some(({ i }) => {
          const v = (p.items || [])[i]?.mensual;
          return v == null || v === "" || isNaN(Number(v));
        });
        if (falta) {
          alert(`A ${p.nombre} le faltan precios en el módulo "${nombreModulo(mod)}". Completá el mensual de cada prestación (o marcá el módulo como "no cotiza") antes de generar el cuadro.`);
          return;
        }
      }
    }

    const sinOferta = modulos.filter((m) => !ganadorDeModulo(lista, items, m));
    if (sinOferta.length > 0 &&
        !confirm(`Estos módulos quedaron sin ninguna oferta: ${sinOferta.map(nombreModulo).join(", ")}.\n\nEl cuadro se va a generar igual, pero sin firma adjudicada para ellos. ¿Continuar?`)) return;

    const adjs = calcularAdjudicaciones(lista, items, {});
    const cotizaron = lista.filter((p) => p.estado === "cotizo").map((p) => p.nombre.toUpperCase());
    const negativas = lista.filter((p) => p.estado === "desestimo").map((p) => p.nombre.toUpperCase() + " (NEGATIVA)");
    const criterioPartido = variosModulos
      ? " Asimismo, se deja constancia que la presente adjudicacion se efectuo comparando cada modulo por separado (Internacion Domiciliaria y Alimentacion), adjudicandose cada uno a la firma que presento el menor costo mensual total en dicho modulo, con prescindencia del precio de las prestaciones individuales.-"
      : "";
    setPrevia({
      lista, adjs, forzados: {},
      textosAdjudicacion: adjs.filter((a) => a.proveedor).map(textoAdjudicacionDe),
      textoConstancia:
        "Se deja constancia que, habiendose solicitado cotizacion a " + lista.length +
        " proveedores del rubro, unicamente las firmas comerciales: " + cotizaron.concat(negativas).join("/") +
        " ; presentaron presupuestos dentro del plazo establecido. Los restantes proveedores convocados no remitieron cotizacion ni emitieron respuesta alguna al requerimiento efectuado a la fecha de adjudicacion.-" +
        criterioPartido,
    });
  };

  // Cambiar a mano la firma adjudicada de un módulo (los textos se rehacen solos)
  const adjudicarAMano = (mod, nombre) => {
    const forzados = { ...(previa.forzados || {}) };
    if (nombre) forzados[mod] = nombre; else delete forzados[mod];
    const adjs = calcularAdjudicaciones(previa.lista, items, forzados);
    setPrevia({
      ...previa, forzados, adjs,
      textosAdjudicacion: adjs.filter((a) => a.proveedor).map(textoAdjudicacionDe),
    });
  };

  const confirmarCuadro = async (conExcel) => {
    setOcupado(true);
    try {
      // PDF fabricado en el navegador con pdf-lib (grises y logos grabados en el archivo)
      if (!window.PDFLib) throw new Error("Falta pdf-lib: subí pdf-lib.min.js a la carpeta public y agregá la línea al index.html");
      const logosB = await obtenerLogosBytes();
      const firmas = firmasAdjudicadas(previa.adjs);
      const mensualAdj = totalMensualAdjudicado(previa.adjs);
      const totalAdj = mensualAdj * Number(exp.periodoMeses || 6);
      const bytes = await crearPdfCuadro(window.PDFLib, {
        nroExpediente: exp.nroExpediente, paciente: exp.paciente, modulo: exp.modulo,
        periodoTexto: exp.periodoTexto, periodoMeses: exp.periodoMeses,
        fechaCorta: fechaCortaHoy(), fmt: formatoPesos,
        items, proveedores: previa.lista,
        adjudicado: { nombre: firmas.join(" / ") },
        adjudicaciones: previa.adjs,
        textosAdjudicacion: previa.textosAdjudicacion,
        textoAdjudicacion: (previa.textosAdjudicacion || []).join("  "),
        textoConstancia: previa.textoConstancia,
      }, logosB.pris, logosB.gob);
      descargarBytes(bytes, "CUADRO COMPARATIVO " + exp.nroExpediente.replace(/\//g, "-") + " " + exp.paciente.toUpperCase() + ".pdf");
      // Excel editable (opcional) por el motor de planillas
      if (conExcel) {
        await llamarYDescargar({
          accion: "generarCuadro",
          nroExpediente: exp.nroExpediente, paciente: exp.paciente,
          modulo: exp.modulo, detalleServicios: exp.detalleServicios,
          periodoTexto: exp.periodoTexto, periodoMeses: exp.periodoMeses,
          items,
          textoAdjudicacion: (previa.textosAdjudicacion || []).join("  "),
          textosAdjudicacion: previa.textosAdjudicacion,
          textoConstancia: previa.textoConstancia,
          proveedores: previa.lista,
          adjudicaciones: previa.adjs,
          adjudicado: { nombre: firmas.join(" / "), mensual: mensualAdj, total: totalAdj },
        }, true, false);
      }
      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
        etapa: 3,
        itemsPrestacion: items,
        cuadro: {
          fecha: new Date().toISOString(),
          adjudicado: firmas.join(" / "),
          adjudicaciones: previa.adjs,
          mensual: mensualAdj, total: totalAdj,
          textoAdjudicacion: (previa.textosAdjudicacion || []).join("  "),
          textosAdjudicacion: previa.textosAdjudicacion,
          textoConstancia: previa.textoConstancia,
        },
      });
      alert("✅ Cuadro comparativo generado. Adjudicado: " + firmas.join(" / ") +
        "\n\nSe descargó el PDF apaisado con los logos (para el SIGEDIG)" + (conExcel ? " y el Excel editable." : "."));
    } catch (e) {
      alert("❌ Error al generar el cuadro: " + e.message);
    }
    setOcupado(false);
  };

  if (previa) {
    const listaVisible = previa.lista.filter((p) => p.estado !== "sin_respuesta");
    const nCols = 2 + listaVisible.length * 2;
    const adjDe = (mod) => previa.adjs.find((a) => a.modulo === mod) || { proveedor: "" };
    const ganaMod = (mod, nombre) => !!nombre && adjDe(mod).proveedor === nombre;
    const mensualAdj = totalMensualAdjudicado(previa.adjs);
    const bc = { border: "1px solid #334155", padding: 6 };
    return (
      <div style={{ ...S.card, borderLeft: "5px solid #0891b2", background: "#f8fafc" }}>
        <div style={{ fontWeight: 800, color: "#075e75", marginBottom: 4 }}>👁️ Revisión del cuadro comparativo</div>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>
          {variosModulos
            ? "El cuadro se agrupa por módulo. En cada fila de subtotal está marcada la firma adjudicada: el sistema propone la más barata y vos podés cambiarla con el redondel."
            : "Una fila por prestación y el total mensual abajo. Revisá los precios y corregí los textos si hace falta."}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, background: "#fff" }}>
            <thead>
              <tr>
                <th style={{ ...bc, background: "#F2F2F2" }}>PRESTACION</th>
                <th style={{ ...bc, background: "#F2F2F2" }}>CANT</th>
                {listaVisible.map((p) => {
                  const gana = previa.adjs.some((a) => a.proveedor === p.nombre);
                  return (
                    <th key={p.nombre} colSpan={2} style={{ ...bc, background: gana ? "#D9D9D9" : "#F2F2F2" }}>
                      {p.nombre.toUpperCase()}{gana ? " 🏆" : ""}
                    </th>
                  );
                })}
              </tr>
              <tr>
                <th style={bc}></th>
                <th style={bc}></th>
                {listaVisible.map((p) => (
                  <Fragment key={p.nombre}>
                    <th style={bc}>P. UNITARIO</th>
                    <th style={bc}>P. MENSUAL</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {modulos.map((mod) => {
                const delModulo = itemsDelModulo(items, mod);
                const primerIndice = delModulo.length ? delModulo[0].i : -1;
                return (
                  <Fragment key={mod}>
                    {variosModulos && (
                      <tr>
                        <td colSpan={nCols} style={{ ...bc, background: "#e2e8f0", fontWeight: 800, color: "#0f172a" }}>
                          🧩 {nombreModulo(mod).toUpperCase()}
                          {adjDe(mod).proveedor
                            ? " — ADJUDICADO A: " + adjDe(mod).proveedor.toUpperCase()
                            : " — sin oferta"}
                        </td>
                      </tr>
                    )}
                    {delModulo.map(({ it, i }) => (
                      <tr key={i}>
                        <td style={bc}>{it.nombre}</td>
                        <td style={{ ...bc, textAlign: "center" }}>{[it.cantTexto, it.cantNum].filter(Boolean).join(" / ")}</td>
                        {listaVisible.map((p) => {
                          const inf = infoModulo(p, mod);
                          const fondo = ganaMod(mod, p.nombre) ? "#E7E6E6" : "#fff";
                          const primero = i === primerIndice;
                          const sinPrecio = p.estado !== "cotizo" || inf.noCotiza;
                          return (
                            <Fragment key={p.nombre}>
                              <td style={{ ...bc, textAlign: "center", fontWeight: 700, background: fondo, fontSize: inf.modo === "modulo" ? 11 : 13 }}>
                                {sinPrecio
                                  ? (primero ? "NO COTIZÓ" : "")
                                  : inf.modo === "modulo"
                                    ? (primero ? (inf.leyenda || "COTIZA POR MÓDULO") : "")
                                    : formatoPesos(p.items[i]?.unitario)}
                              </td>
                              <td style={{ ...bc, textAlign: "center", fontWeight: 700, background: fondo }}>
                                {!sinPrecio && inf.modo !== "modulo" ? formatoPesos(p.items[i]?.mensual) : ""}
                              </td>
                            </Fragment>
                          );
                        })}
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={2} style={{ ...bc, fontWeight: 800, background: "#f1f5f9" }}>
                        {variosModulos ? "SUBTOTAL " + nombreModulo(mod).toUpperCase() : "TOTAL MENSUAL"}
                      </td>
                      {listaVisible.map((p) => {
                        const st = subtotalModulo(p, items, mod);
                        const gana = ganaMod(mod, p.nombre);
                        const fondo = gana ? "#E7E6E6" : "#f8fafc";
                        return (
                          <Fragment key={p.nombre}>
                            <td style={{ ...bc, textAlign: "center", background: fondo }}>
                              {st != null && (
                                <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", fontSize: 11, fontWeight: 800, color: gana ? "#166534" : "#94a3b8" }}>
                                  <input type="radio" name={"adj-" + mod} checked={gana} onChange={() => adjudicarAMano(mod, p.nombre)} />
                                  {gana ? "ADJUDICADO" : "adjudicar"}
                                </label>
                              )}
                            </td>
                            <td style={{ ...bc, textAlign: "center", fontWeight: 800, background: fondo }}>
                              {st != null ? formatoPesos(st) : ""}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  </Fragment>
                );
              })}
              {variosModulos && (
                <tr>
                  <td colSpan={nCols} style={{ ...bc, background: "#D9D9D9", fontWeight: 800, textAlign: "right" }}>
                    TOTAL MENSUAL ADJUDICADO: {formatoPesos(mensualAdj)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ background: "#e0f2fe", borderRadius: 8, padding: 10, marginTop: 12, fontSize: 14, color: "#075e75", fontWeight: 700 }}>
          🏆 {previa.adjs.filter((a) => a.proveedor).map((a) => (variosModulos ? nombreModulo(a.modulo) + ": " : "") + a.proveedor + " (" + formatoPesos(a.mensual) + ")").join(" · ") || "Sin firma adjudicada"}
          <div style={{ fontWeight: 600, marginTop: 4 }}>
            Mensual adjudicado: {formatoPesos(mensualAdj)} · Total {exp.periodoMeses} meses: {formatoPesos(mensualAdj * Number(exp.periodoMeses || 6))}
          </div>
          {previa.adjs.some((a) => a.forzado) && (
            <div style={{ fontWeight: 600, marginTop: 4, color: "#b45309" }}>
              ⚠️ Hay adjudicaciones cambiadas a mano (no son la oferta más baja). Conviene dejar el motivo asentado en el expediente.
            </div>
          )}
        </div>

        <label style={S.label}>
          {previa.textosAdjudicacion.length > 1 ? "Textos de adjudicación (un recuadro gris por módulo)" : "Texto de adjudicación (recuadro gris del cuadro)"}
        </label>
        {previa.textosAdjudicacion.map((t, k) => (
          <textarea key={k} style={{ ...S.input, minHeight: 60, marginBottom: 6 }} value={t}
            onChange={(e) => {
              const arr = [...previa.textosAdjudicacion];
              arr[k] = e.target.value;
              setPrevia({ ...previa, textosAdjudicacion: arr });
            }} />
        ))}

        <label style={S.label}>Texto de constancia (proveedores consultados)</label>
        <textarea style={{ ...S.input, minHeight: 90 }} value={previa.textoConstancia}
          onChange={(e) => setPrevia({ ...previa, textoConstancia: e.target.value })} />

        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button style={{ ...S.btn, flex: 2, minWidth: 200, background: "#16a34a", fontSize: 15, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => confirmarCuadro(false)}>
            {ocupado ? "⏳ Generando..." : "✅ ESTÁ BIEN — GENERAR PDF"}
          </button>
          <button style={{ ...S.btnSec, flex: 1, minWidth: 140, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => confirmarCuadro(true)}>
            {ocupado ? "⏳..." : "📊 PDF + Excel"}
          </button>
          <button style={{ ...S.btnSec, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => setPrevia(null)}>✖ Cancelar</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #f59e0b" }}>
      <h3 style={{ color: "#075e75", marginBottom: 4 }}>📬 Registro de presupuestos</h3>
      <div style={{ fontSize: 13, color: "#64748b" }}>
        Primero definí los <b>ítems del módulo</b> (una fila del cuadro por cada prestación: bomba, enfermería, visita médica, etc.). Después cargá los precios de cada proveedor <b>por ítem</b> — el mensual total se suma solo y se adjudica al total más bajo. <b>Todo se va guardando automáticamente mientras cargás</b>; el botón Guardar de cada proveedor sube además el PDF del presupuesto al Drive.
      </div>

      <div style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 12px", marginTop: 12, border: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800, color: "#334155" }}>🧩 Ítems del módulo ({items.length})</div>
          <div style={{ flex: 1, fontSize: 13, color: "#64748b", minWidth: 180 }}>
            {items.map((it) => it.nombre).filter(Boolean).join(" · ") || "sin definir"}
          </div>
          <button style={S.btnSec} onClick={() => setEditandoItems(!editandoItems)}>
            {editandoItems ? "▲ Listo" : "✏️ Editar ítems"}
          </button>
        </div>

        {/* ---- Interruptor de adjudicación partida ---- */}
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid " + (variosModulos ? "#0891b2" : "#e2e8f0"), background: variosModulos ? "#ecfeff" : "#fff" }}>
          <div style={{ fontWeight: 800, color: "#334155", marginBottom: 4 }}>
            ⚖️ ¿Se adjudica partido? (Internación y Alimentación por separado)
          </div>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>
            Activalo cuando una firma pueda ganar la <b>internación</b> y otra la <b>alimentación</b>, o cuando alguien no cotiza la alimentación. El cuadro va a comparar <b>cada módulo por su cuenta</b> (manzana con manzana) y va a salir un texto de adjudicación por módulo. Si lo dejás apagado, se adjudica todo a una sola firma por el total más bajo.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={activarSplit}
              style={{ ...S.btnSec, fontWeight: 700, borderColor: variosModulos ? "#0891b2" : "#cbd5e1", background: variosModulos ? "#0891b2" : "#fff", color: variosModulos ? "#fff" : "#334155" }}>
              🍽️ Sí — separar Internación y Alimentación
            </button>
            <button
              onClick={desactivarSplit}
              style={{ ...S.btnSec, fontWeight: 700, borderColor: !variosModulos ? "#0891b2" : "#cbd5e1", background: !variosModulos ? "#0891b2" : "#fff", color: !variosModulos ? "#fff" : "#334155" }}>
              ↩️ No — una sola firma para todo
            </button>
          </div>
          {variosModulos && (
            <div style={{ fontSize: 12, color: "#075e75", marginTop: 8, fontWeight: 600 }}>
              ✔ Partido activo. En cada proveedor vas a ver dos bloques (🧩 Internación y 🧩 Alimentación), cada uno con su casillero "No cotiza este módulo". A quien no cargó alimentación ya se lo marqué solo.
            </div>
          )}
        </div>

        {editandoItems && (
          <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
            {items.map((it, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 140px 80px 190px 40px", gap: 8, marginBottom: 8, alignItems: "end" }}>
                <div>
                  {i === 0 && <label style={{ ...S.label, marginTop: 0 }}>Prestación</label>}
                  <input style={S.input} value={it.nombre} onChange={(e) => setItem(i, "nombre", e.target.value)} placeholder="Ej: Enfermería 12 hs diarias" />
                </div>
                <div>
                  {i === 0 && <label style={{ ...S.label, marginTop: 0 }}>Cantidad (texto)</label>}
                  <input style={S.input} value={it.cantTexto} onChange={(e) => setItem(i, "cantTexto", e.target.value)} placeholder="31 dias" />
                </div>
                <div>
                  {i === 0 && <label style={{ ...S.label, marginTop: 0 }}>Hs/Ses. (opcional)</label>}
                  <input style={S.input} value={it.cantNum} onChange={(e) => setItem(i, "cantNum", e.target.value)} placeholder="—" />
                </div>
                <div>
                  {i === 0 && <label style={{ ...S.label, marginTop: 0 }}>Módulo (opcional)</label>}
                  <input style={S.input} list="modulos-sugeridos" value={it.modulo || ""}
                    onChange={(e) => setItem(i, "modulo", e.target.value)}
                    placeholder="dejar vacío = uno solo" />
                </div>
                <button style={{ ...S.btnSec, padding: "10px 0", color: "#b91c1c", borderColor: "#fca5a5" }} title="Quitar ítem" onClick={() => quitarItem(i)}>🗑</button>
              </div>
            ))}
            <datalist id="modulos-sugeridos">
              {["INTERNACION DOMICILIARIA", "ALIMENTACION ENTERAL"].concat(modulos.filter(Boolean)).filter((v, k, a) => a.indexOf(v) === k)
                .map((m) => <option key={m} value={m} />)}
            </datalist>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
              Normalmente <b>no hace falta tocar esta columna a mano</b>: usá el interruptor <b>"¿Se adjudica partido?"</b> de arriba y se completa sola (Internación / Alimentación). Dejala acá solo para casos especiales.
              Con la columna vacía en todos los ítems, el cuadro sale con una sola firma adjudicada.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              <button style={S.btnSec} onClick={agregarItem}>➕ Agregar ítem</button>
              <button style={S.btnSec} onClick={() => {
                const propuestos = proponerItems();
                aplicarItemsNuevos(propuestos, "del pedido de cotización");
              }}>🔁 Recargar desde el pedido de cotización</button>
              <button style={S.btnSec} onClick={() => setPegando(!pegando)}>
                📋 Pegar desde el mail
              </button>
            </div>

            {pegando && (
              <div style={{ marginTop: 10, padding: 10, background: "#fffbeb", border: "1px dashed #f59e0b", borderRadius: 8 }}>
                <div style={{ fontSize: 13, color: "#92400e", marginBottom: 6 }}>
                  Abrí el mail enviado en Gmail, <b>copiá el bloque de los servicios</b> (las líneas tipo "Enfermería: 24hs por día") y pegalo acá. El sistema extrae las prestaciones automáticamente — las líneas que no sean servicios se descartan solas.
                </div>
                <textarea style={{ ...S.input, minHeight: 110 }} value={textoPegado}
                  onChange={(e) => setTextoPegado(e.target.value)}
                  placeholder={"Ej:\n• Enfermería: 24hs por día.\n• Kinesiología Motora: 2 sesiones por semana.\n• Visita médica: 1 visita semanal."} />
                <button style={{ ...S.btn, marginTop: 8 }} onClick={() => {
                  const extraidos = extraerItemsDeTexto(textoPegado);
                  if (extraidos.length === 0) {
                    alert("No encontré líneas de servicios en el texto pegado.\n\nTienen que tener el formato \"Nombre: cantidad\" (ej: Enfermería: 24hs por día). Revisá lo copiado e intentá de nuevo.");
                    return;
                  }
                  if (aplicarItemsNuevos(extraidos, "del texto pegado")) {
                    setPegando(false);
                    setTextoPegado("");
                  }
                }}>✅ Extraer ítems del texto</button>
              </div>
            )}
          </div>
        )}
      </div>

      {consultados.map((nombre) => {
        const d = datos[nombre] || { estado: "", items: [] };
        const mensualTotal = mensualEnPantalla(nombre);
        const abierto = abiertos[nombre] ?? !guardados[nombre]?.estado;
        return (
          <div key={nombre} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontWeight: 800, color: "#075e75" }}>
              {nombre}{" "}
              {guardados[nombre]?.estado === "cotizo" && <span style={{ color: "#16a34a" }}>✅ Cotizó: {formatoPesos(guardados[nombre].mensual)}/mes · {formatoPesos((guardados[nombre].mensual || 0) * Number(exp.periodoMeses || 6))} por {exp.periodoMeses} meses</span>}
              {guardados[nombre]?.estado === "desestimo" && <span style={{ color: "#b91c1c" }}>🚫 No cotizó (negativa){guardados[nombre]?.pdfNombre ? " 📎" : ""}</span>}
              {guardados[nombre]?.estado === "sin_respuesta" && <span style={{ color: "#64748b" }}>⏳ No respondió</span>}
              <div style={{ flex: 1 }} />
              <button style={S.btnSec} onClick={() => setAbiertos({ ...abiertos, [nombre]: !abierto })}>
                {abierto ? "▲ Cerrar" : "▼ Editar"}
              </button>
            </div>
            {abierto && (<>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {[["cotizo", "💰 Cotizó"], ["desestimo", "🚫 No cotizó (mandó negativa)"], ["sin_respuesta", "⏳ No respondió"]].map(([v, t]) => (
                <label key={v} style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
                  borderRadius: 8, border: "1.5px solid " + (d.estado === v ? "#0891b2" : "#cbd5e1"),
                  background: d.estado === v ? "#e0f2fe" : "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600,
                }}>
                  <input type="radio" name={"estado-" + nombre} checked={d.estado === v} onChange={() => setProv(nombre, "estado", v)} />
                  {t}
                </label>
              ))}
            </div>

            {(d.estado === "cotizo" || d.estado === "desestimo") && (
              <div style={{ marginTop: 10 }}>
                {d.estado === "cotizo" && modulos.map((mod) => {
                  const inf = (d.modulos || {})[mod] || {};
                  const modo = inf.modo === "modulo" ? "modulo" : "item";
                  const noCotiza = !!inf.noCotiza;
                  const st = subtotalEnPantalla(nombre, mod);
                  return (
                    <div key={mod} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, marginBottom: 10, background: noCotiza ? "#f8fafc" : "#fff" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                        {variosModulos && (
                          <div style={{ fontWeight: 800, color: "#334155", fontSize: 13 }}>🧩 {nombreModulo(mod)}</div>
                        )}
                        <div style={{ display: "flex", gap: 0, border: "1px solid #cbd5e1", borderRadius: 8, overflow: "hidden", opacity: noCotiza ? 0.4 : 1 }}>
                          {[["item", "Detalle por ítem"], ["modulo", "Un solo monto"]].map(([v, t]) => (
                            <button key={v} disabled={noCotiza}
                              onClick={() => setProvModulo(nombre, mod, "modo", v)}
                              style={{
                                padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: noCotiza ? "default" : "pointer",
                                border: "none", background: modo === v ? "#0891b2" : "#fff", color: modo === v ? "#fff" : "#475569",
                              }}>{t}</button>
                          ))}
                        </div>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#b91c1c", fontWeight: 600, cursor: "pointer" }}>
                          <input type="checkbox" checked={noCotiza}
                            onChange={(e) => setProvModulo(nombre, mod, "noCotiza", e.target.checked)} />
                          No cotiza {variosModulos ? "este módulo" : ""}
                        </label>
                        <div style={{ flex: 1 }} />
                        {!noCotiza && st != null && (
                          <div style={{ fontSize: 13, fontWeight: 800, color: "#075e75" }}>Subtotal: {formatoPesos(st)}</div>
                        )}
                      </div>

                      {!noCotiza && modo === "item" && itemsDelModulo(items, mod).map(({ it, i }) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 150px 150px", gap: 8, marginBottom: 6, alignItems: "center" }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>
                            {it.nombre || "Ítem " + (i + 1)}
                            {it.cantTexto && <span style={{ color: "#94a3b8", fontWeight: 500 }}> — {it.cantTexto}</span>}
                          </div>
                          <input style={S.input} type="number" placeholder="P. unitario ($)" value={d.items?.[i]?.unitario ?? ""}
                            onChange={(e) => setProvItem(nombre, i, "unitario", e.target.value)} />
                          <input style={S.input} type="number" placeholder="P. mensual ($)" value={d.items?.[i]?.mensual ?? ""}
                            onChange={(e) => setProvItem(nombre, i, "mensual", e.target.value)} />
                        </div>
                      ))}

                      {!noCotiza && modo === "modulo" && (
                        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 8, alignItems: "center" }}>
                          <input style={S.input} type="number" placeholder="Monto mensual ($)"
                            value={inf.montoModulo ?? ""}
                            onChange={(e) => setProvModulo(nombre, mod, "montoModulo", e.target.value)} />
                          <input style={S.input} placeholder="Leyenda para la columna unitario (ej: COTIZA POR MODULO/DIA)"
                            value={inf.leyenda ?? ""}
                            onChange={(e) => setProvModulo(nombre, mod, "leyenda", e.target.value)} />
                        </div>
                      )}

                      {noCotiza && (
                        <div style={{ fontSize: 13, color: "#64748b" }}>
                          En el cuadro va a figurar <b>NO COTIZÓ</b> {variosModulos ? "para este módulo" : ""}, y no compite en la adjudicación.
                        </div>
                      )}
                    </div>
                  );
                })}
                {d.estado === "cotizo" && (
                  <div style={{ textAlign: "right", fontWeight: 800, color: "#075e75", fontSize: 14, marginTop: 4 }}>
                    Mensual total: {formatoPesos(mensualTotal)} · Total por {exp.periodoMeses} meses: {formatoPesos(mensualTotal * Number(exp.periodoMeses || 6))}
                  </div>
                )}
                <label style={{ ...S.label }}>{d.estado === "desestimo" ? "PDF de la respuesta (mail con la negativa)" : "PDF del presupuesto"}{d.pdfNombre ? ` — guardado: ${d.pdfNombre}` : ""}</label>
                {d.estado === "cotizo" && (
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    Al elegir el PDF, leo los importes y <b>precargo los casilleros de precios</b> (unitario y mensual). Todo queda editable por si hay que corregir algo.
                  </div>
                )}
                <input type="file" accept="application/pdf" style={{ marginTop: 4 }}
                  onChange={(e) => {
                    const file = e.target.files[0];
                    setArchivos({ ...archivos, [nombre]: file });
                    if (file && d.estado === "cotizo") leerPreciosDelPdf(nombre, file);
                  }} />
                {leyendoPdf[nombre] && (
                  <div style={{ fontSize: 13, color: "#0891b2", marginTop: 4, fontWeight: 600 }}>⏳ Leyendo el PDF y precargando precios…</div>
                )}
                {!leyendoPdf[nombre] && infoPdf[nombre] && (
                  <div style={{ fontSize: 13, color: "#334155", marginTop: 4 }}>{infoPdf[nombre]}</div>
                )}
              </div>
            )}

            <button style={{ ...S.btnSec, marginTop: 10, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => guardarProveedor(nombre)}>
              💾 Guardar {nombre}{archivos[nombre] ? " (sube el PDF)" : ""}
            </button>
            </>)}
          </div>
        );
      })}

      {autoInfo && (
        <div style={{ textAlign: "right", fontSize: 12, color: autoInfo.startsWith("⚠️") ? "#b45309" : "#16a34a", marginTop: 8 }}>{autoInfo}</div>
      )}

      <button style={{ ...S.btn, marginTop: 10, width: "100%", fontSize: 16, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={abrirPrevia}>
        {ocupado ? "⏳ Procesando..." : "👁️ GENERAR Y REVISAR EL CUADRO (adjudica al menor total)"}
      </button>
    </div>
  );
}

function GenerarNota({ exp }) {
  const total = (exp.cuadro?.mensual || 0) * Number(exp.periodoMeses || 6);
  // Si el cuadro adjudicó más de un módulo, el gasto toca las dos subpartidas
  const subDefecto = (exp.cuadro?.adjudicaciones || []).length > 1 ? "ambas" : "322";
  const [monto, setMonto] = useState(
    Number(exp.valoresAutorizados?.totalAfectar) > 0
      ? Number(exp.valoresAutorizados.totalAfectar)
      : (exp.nota?.monto ?? total)
  );
  const [directora, setDirectora] = useState(exp.nota?.directora || "Dra. Noellia Bottone");
  const [fechaTexto, setFechaTexto] = useState(exp.nota?.fechaTexto || fechaLargaHoy());
  const [subpartida, setSubpartida] = useState(exp.nota?.subpartida || subDefecto);
  const [imputacion, setImputacion] = useState(exp.nota?.imputacion || imputacionNotaPorSubpartida(exp.nota?.subpartida || subDefecto));
  const [revisando, setRevisando] = useState(false);

  const cambiarSubpartida = (s) => {
    setSubpartida(s);
    setImputacion(imputacionNotaPorSubpartida(s));
  };

  if (revisando) {
    return (
      <VistaPrevia
        construirPlantilla={(logos) => plantillaNota(datosNota(exp, { monto: Number(monto), directora, imputacion, fechaTexto }), logos)}
        onCerrar={() => setRevisando(false)}
        onListo={async (data) => {
          await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
            etapa: Math.max(exp.etapa, 4),
            nota: {
              fecha: new Date().toISOString(),
              monto: Number(monto), montoLetras: data.montoLetras || "",
              directora, imputacion, subpartida, fechaTexto,
            },
          });
        }}
      />
    );
  }

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #f59e0b" }}>
      <h3 style={{ color: "#075e75", marginBottom: 4 }}>💰 Nota de afectación presupuestaria</h3>
      <div style={{ fontSize: 13, color: "#64748b" }}>
        Con el formato oficial del Word real (Times New Roman). El importe sale del cuadro comparativo y las letras se escriben solas. Primero la revisás en pantalla, la corregís si hace falta, y recién ahí generás el PDF.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 1fr", gap: 10 }}>
        <div>
          <label style={S.label}>Importe total ({exp.periodoMeses} meses)</label>
          <input style={S.input} type="number" value={monto} onChange={(e) => setMonto(e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Fecha que sale en la nota</label>
          <input style={S.input} value={fechaTexto} onChange={(e) => setFechaTexto(e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Directora del Programa</label>
          <input style={S.input} value={directora} onChange={(e) => setDirectora(e.target.value)} />
        </div>
      </div>

      <label style={S.label}>Subpartida(s) del gasto</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {[["322", "322"], ["342", "342"], ["ambas", "322 y 342 (internación + alimentación)"]].map(([v, t]) => (
          <label key={v} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
            borderRadius: 8, border: "1.5px solid " + (subpartida === v ? "#0891b2" : "#cbd5e1"),
            background: subpartida === v ? "#e0f2fe" : "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600,
          }}>
            <input type="radio" name="subpartida-nota" checked={subpartida === v} onChange={() => cambiarSubpartida(v)} />
            {t}
          </label>
        ))}
      </div>

      <label style={S.label}>Imputación presupuestaria</label>
      <textarea style={{ ...S.input, minHeight: 70 }} value={imputacion} onChange={(e) => setImputacion(e.target.value)} />

      <button style={{ ...S.btn, marginTop: 16, width: "100%", fontSize: 16 }} onClick={() => setRevisando(true)}>
        👁️ GENERAR Y REVISAR LA NOTA
      </button>
    </div>
  );
}

function mesAnioActual() {
  const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const d = new Date();
  return meses[d.getMonth()] + " " + d.getFullYear();
}

/* ---------- Pase a Asesoría Letrada ---------- */

function PaseLetrada({ exp }) {
  const [fechaTexto, setFechaTexto] = useState(mesAnioActual());
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [revisando, setRevisando] = useState(false);

  if (revisando) {
    return (
      <VistaPrevia
        construirPlantilla={(logos) => plantillaPase(datosPaseLetrada(exp, { fechaTexto, anio }), logos)}
        onCerrar={() => setRevisando(false)}
        onListo={async () => {
          await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
            etapa: Math.max(exp.etapa, 6),
            paseLetrada: { fecha: new Date().toISOString(), fechaTexto, anio },
          });
        }}
      />
    );
  }

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #f59e0b" }}>
      <h3 style={{ color: "#075e75", marginBottom: 4 }}>⚖️ Pase a Asesoría Letrada</h3>
      <div style={{ fontSize: 13, color: "#64748b" }}>
        Nota de pase con la firma de la Gerente. La revisás en pantalla y generás el PDF. Cuando vuelva el informe jurídico favorable, seguís con la resolución.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 10 }}>
        <div>
          <label style={S.label}>Fecha que sale en la nota</label>
          <input style={S.input} value={fechaTexto} onChange={(e) => setFechaTexto(e.target.value)} placeholder="Julio 2026" />
        </div>
        <div>
          <label style={S.label}>Presupuesto (año)</label>
          <input style={S.input} value={anio} onChange={(e) => setAnio(e.target.value)} placeholder="2026" />
        </div>
      </div>

      <button style={{ ...S.btn, marginTop: 16, width: "100%", fontSize: 16 }} onClick={() => setRevisando(true)}>
        👁️ GENERAR Y REVISAR EL PASE
      </button>
    </div>
  );
}

function GenerarResolucion({ exp }) {
  const total = Number(exp.valoresAutorizados?.totalAfectar) > 0
    ? Number(exp.valoresAutorizados.totalAfectar)
    : (exp.cuadro?.mensual || 0) * Number(exp.periodoMeses || 6);
  const r = exp.resolucion || {};
  const nombresItems = (exp.itemsPrestacion || []).map((it) => it.nombre).join("; ");

  // Lo que el cuadro comparativo adjudicó: prestaciones y precios del ganador,
  // para armar la resolución sin volver a escribir nada.
  const esAlimentacion = (n) => /aliment|bomba|nutri|enteral|m[oó]dulo alim/i.test(n || "");

  // Módulos del expediente y qué firma ganó cada uno (viene del cuadro comparativo)
  const adjsExp = exp.cuadro?.adjudicaciones || [];
  const modsExp = modulosDeItems(exp.itemsPrestacion || []);
  const variosExp = modsExp.length > 1;
  const provDelModulo = (mod) => {
    const a = adjsExp.find((x) => x.modulo === mod);
    return (a && a.proveedor) || exp.cuadro?.adjudicado || "";
  };
  // Por convención de la oficina: bloque A = internación (subp. 342), bloque B = alimentación (subp. 322)
  let modInternacion = modsExp[0], modAlimentacion = modsExp[1];
  if (variosExp) {
    const kAli = modsExp.findIndex((m) => esAlimentacion(m));
    if (kAli >= 0) {
      modAlimentacion = modsExp[kAli];
      modInternacion = modsExp.find((m, k) => k !== kAli);
    }
  }

  // Precios de cada ítem, tomados del proveedor que ganó SU módulo
  const itemsAdjudicados = (() => {
    const its = exp.itemsPrestacion || [];
    return its.map((it, i) => {
      const mod = it.modulo ? String(it.modulo).trim() : "";
      const g = (exp.presupuestos || {})[provDelModulo(mod)];
      const inf = (g?.modulos || {})[mod] || {};
      let mensual;
      if (inf.modo === "modulo") {
        // cotizado por módulo global: el importe se muestra en el primer ítem del módulo
        const primero = itemsDelModulo(its, mod)[0];
        mensual = primero && primero.i === i ? Number(inf.montoModulo || 0) : 0;
      } else {
        mensual = Number(g?.items?.[i]?.mensual ?? (its.length === 1 ? g?.mensual : 0)) || 0;
      }
      return { nombre: it.nombre, cantTexto: it.cantTexto || "", modulo: mod, mensual: mensual || 0 };
    });
  })();
  const detalleDeItems = (lista) =>
    lista.map((it) => it.nombre + (it.cantTexto ? ": " + it.cantTexto : "")).join("\n");
  const itemsInternacion = variosExp
    ? itemsAdjudicados.filter((it) => it.modulo === modInternacion)
    : itemsAdjudicados.filter((it) => !esAlimentacion(it.nombre));
  const itemsAlimentacion = variosExp
    ? itemsAdjudicados.filter((it) => it.modulo === modAlimentacion)
    : itemsAdjudicados.filter((it) => esAlimentacion(it.nombre));
  const sumar = (lista) => lista.reduce((s, it) => s + (it.mensual || 0), 0);

  // Modo sugerido: dos firmas distintas -> modelo doble; misma firma en los dos módulos -> mismo proveedor
  const firmaInt = variosExp ? provDelModulo(modInternacion) : (exp.cuadro?.adjudicado || "");
  const firmaAli = variosExp ? provDelModulo(modAlimentacion) : "";
  const subModoSugerido = !variosExp ? "una" : (firmaInt && firmaAli && firmaInt !== firmaAli ? "dos" : "dosMismo");

  const [f, setF] = useState({
    nroResolucion: r.nro || "/DGPRIS",
    tipoTramite: r.tipoTramite || "inicio",
    firmante: r.firmante || "directora",
    subModo: r.subModo || subModoSugerido,
    subpartida: r.subpartida || "322",
    fsSolicitud: r.fojas?.solicitud || "02,04",
    fsPresupuesto: r.fojas?.presupuesto || "",
    fsCuadro: r.fojas?.cuadro || "",
    fsDictamen: r.fojas?.dictamen || "",
    anio: r.anio || String(new Date().getFullYear()),
    imputacion: r.imputacion || imputacionResolucionPorSubpartida(r.subpartida || "322"),
    // modelo doble (322 y 342)
    subA: r.subA || "342",
    firmaA: r.firmaA || firmaInt,
    tituloA: r.tituloA || "",
    detalleA: r.detalleA || detalleDeItems(itemsInternacion.length ? itemsInternacion : itemsAdjudicados),
    mensualA: r.mensualA || (Number(exp.valoresAutorizados?.mensualPorModulo?.["Internación Domiciliaria"]) > 0
      ? Number(exp.valoresAutorizados.mensualPorModulo["Internación Domiciliaria"])
      : (sumar(itemsInternacion.length ? itemsInternacion : itemsAdjudicados) || "")),
    subB: r.subB || "322",
    firmaB: r.firmaB || firmaAli,
    tituloB: r.tituloB || "",
    detalleB: r.detalleB || detalleDeItems(itemsAlimentacion),
    mensualB: r.mensualB || (Number(exp.valoresAutorizados?.mensualPorModulo?.["Alimentación Domiciliaria"]) > 0
      ? Number(exp.valoresAutorizados.mensualPorModulo["Alimentación Domiciliaria"])
      : (sumar(itemsAlimentacion) || "")),
    // modelo mismo proveedor: un solo bloque con todos los ítems
    detalleUnico: r.detalleUnico || detalleDeItems(itemsAdjudicados),
    montoSub342: r.montoSub342 || (sumar(itemsInternacion.length ? itemsInternacion : itemsAdjudicados) || ""),
  });
  const [revisando, setRevisando] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const cambiarSubpartidaSimple = (s) => setF({ ...f, subpartida: s, imputacion: imputacionResolucionPorSubpartida(s) });

  const chip = (activo) => ({
    display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
    borderRadius: 8, border: "1.5px solid " + (activo ? "#0891b2" : "#cbd5e1"),
    background: activo ? "#e0f2fe" : "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600,
  });

  const esDoble = f.subModo === "dos";
  const esDobleMismo = f.subModo === "dosMismo";
  const totalA = Number(f.mensualA || 0) * Number(exp.periodoMeses || 6);
  const totalB = Number(f.mensualB || 0) * Number(exp.periodoMeses || 6);

  if (revisando) {
    return (
      <VistaPrevia
        construirPlantilla={(logos) => plantillaResolucion(datosResolucion(exp, {
          total, nroResolucion: f.nroResolucion, tipoTramite: f.tipoTramite,
          firmante: f.firmante, subModo: f.subModo, subpartida: f.subpartida,
          fsSolicitud: f.fsSolicitud, fsPresupuesto: f.fsPresupuesto,
          fsCuadro: f.fsCuadro, fsDictamen: f.fsDictamen,
          imputacion: f.imputacion, anio: f.anio,
          subA: f.subA, firmaA: f.firmaA,
          mensualA: esDobleMismo ? Number(f.montoSub342 || 0) : f.mensualA,
          tituloA: f.tituloA || ("SERVICIOS INTERNACION DOMICILIARIA: " + f.firmaA.toUpperCase()),
          detalleA: esDobleMismo ? f.detalleUnico : (f.detalleA || nombresItems || limpiarModulo(exp.modulo)),
          subB: f.subB, firmaB: esDobleMismo ? f.firmaA : f.firmaB,
          mensualB: esDobleMismo
            ? Math.max(0, Number(f.mensualUnico ?? exp.cuadro?.mensual ?? 0) - Number(f.montoSub342 || 0))
            : f.mensualB,
          tituloB: f.tituloB || ("SERVICIO: MODULO ALIMENTACION DOMICILIARIA: " + (f.firmaB || "").toUpperCase()),
          detalleB: f.detalleB || "Servicio de Alimentación domiciliaria C/Bomba de Infusión",
          mensualUnico: esDobleMismo ? Number(f.mensualUnico ?? exp.cuadro?.mensual ?? 0) : null,
          detalleUnico: f.detalleUnico,
        }), logos)}
        onCerrar={() => setRevisando(false)}
        onListo={async (data) => {
          await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
            etapa: Math.max(exp.etapa, 7),
            resolucion: {
              fecha: new Date().toISOString(),
              nro: f.nroResolucion, tipoTramite: f.tipoTramite,
              firmante: f.firmante, subModo: f.subModo, subpartida: f.subpartida,
              adjudicado: exp.cuadro?.adjudicado || "",
              total: (esDoble || esDobleMismo) ? totalA + totalB : total,
              montoLetras: data.montoLetras || "",
              fojas: { solicitud: f.fsSolicitud, presupuesto: f.fsPresupuesto, cuadro: f.fsCuadro, dictamen: f.fsDictamen },
              imputacion: f.imputacion, anio: f.anio,
              subA: f.subA, firmaA: f.firmaA, tituloA: f.tituloA, detalleA: f.detalleA, mensualA: f.mensualA,
              detalleUnico: f.detalleUnico, mensualUnico: f.mensualUnico ?? exp.cuadro?.mensual ?? "", montoSub342: f.montoSub342,
              subB: f.subB, firmaB: f.firmaB, tituloB: f.tituloB, detalleB: f.detalleB, mensualB: f.mensualB,
            },
          });
        }}
      />
    );
  }

  const generar = () => {
    if (!f.nroResolucion) { alert("Cargá el N° de la resolución (ej: 3123/DGPRIS)."); return; }
    if (esDoble) {
      if (!f.firmaA || !f.firmaB) { alert("Cargá las dos firmas comerciales (bloques A y B)."); return; }
      if (!f.mensualA || !f.mensualB) { alert("Cargá el precio mensual de cada firma (bloques A y B)."); return; }
    }
    if (esDobleMismo) {
      if (!f.firmaA) { alert("Cargá la firma comercial adjudicada."); return; }
      const mensualTot = Number(f.mensualUnico ?? exp.cuadro?.mensual ?? 0);
      if (!mensualTot) { alert("Cargá el precio mensual total adjudicado."); return; }
      const m342 = Number(f.montoSub342 || 0);
      if (m342 <= 0 || m342 > mensualTot) {
        alert(`Revisá el reparto del ARTÍCULO 2º: el monto mensual de internación (Subp. ${f.subA}) tiene que ser mayor a cero y no puede superar el mensual total de ${formatoPesos(mensualTot)}.`);
        return;
      }
    }
    if (!f.fsPresupuesto || !f.fsCuadro || !f.fsDictamen) {
      if (!confirm("Faltan números de fojas (presupuesto, cuadro o dictamen). El documento va a salir con esos espacios vacíos — igual podés completarlos a mano en la vista previa. ¿Continuar?")) return;
    }
    setRevisando(true);
  };

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #f59e0b" }}>
      <h3 style={{ color: "#075e75", marginBottom: 4 }}>📜 Resolución Interna de contratación</h3>
      <div style={{ fontSize: 13, color: "#64748b" }}>
        Elegí quién firma y las subpartidas: con una sola sale el modelo habitual; con 322 y 342 sale el modelo de dos firmas y dos tablas (internación + alimentación). Después la revisás en pantalla y generás el PDF.
      </div>

      <div style={{ background: "#e0f2fe", borderRadius: 8, padding: 10, marginTop: 12, fontSize: 14, color: "#075e75", fontWeight: 700 }}>
        Adjudicado en el cuadro: {exp.cuadro?.adjudicado} · {formatoPesos(exp.cuadro?.mensual)}/mes · Total {exp.periodoMeses} meses: {formatoPesos(total)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 10 }}>
        <div>
          <label style={S.label}>N° de Resolución Interna</label>
          <input style={S.input} value={f.nroResolucion} onChange={(e) => setF({ ...f, nroResolucion: e.target.value.toUpperCase() })} placeholder="3123/DGPRIS" />
        </div>
        <div>
          <label style={S.label}>Presupuesto (año)</label>
          <input style={S.input} value={f.anio} onChange={set("anio")} placeholder="2026" />
        </div>
      </div>

      <label style={S.label}>¿Quién firma la resolución? (cambia el POR ELLO y la firma final)</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        <label style={chip(f.firmante === "directora")}>
          <input type="radio" name="firmante-res" checked={f.firmante === "directora"} onChange={() => setF({ ...f, firmante: "directora" })} />
          Directora — Dra. Noelia Bottone
        </label>
        <label style={chip(f.firmante === "gerente")}>
          <input type="radio" name="firmante-res" checked={f.firmante === "gerente"} onChange={() => setF({ ...f, firmante: "gerente" })} />
          Gerente — C.P.N Mariela A. Castillo
        </label>
      </div>

      <label style={S.label}>Subpartida(s)</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        <label style={chip(f.subModo === "una" && f.subpartida === "322")}>
          <input type="radio" name="submodo-res" checked={f.subModo === "una" && f.subpartida === "322"} onChange={() => { setF({ ...f, subModo: "una", subpartida: "322", imputacion: imputacionResolucionPorSubpartida("322") }); }} />
          Subpartida 322
        </label>
        <label style={chip(f.subModo === "una" && f.subpartida === "342")}>
          <input type="radio" name="submodo-res" checked={f.subModo === "una" && f.subpartida === "342"} onChange={() => { setF({ ...f, subModo: "una", subpartida: "342", imputacion: imputacionResolucionPorSubpartida("342") }); }} />
          Subpartida 342
        </label>
        <label style={chip(esDoble)}>
          <input type="radio" name="submodo-res" checked={esDoble} onChange={() => setF({ ...f, subModo: "dos" })} />
          322 y 342 — dos proveedores distintos
        </label>
        <label style={chip(esDobleMismo)}>
          <input type="radio" name="submodo-res" checked={esDobleMismo} onChange={() => setF({ ...f, subModo: "dosMismo", firmaA: f.firmaA || (exp.cuadro?.adjudicado || "") })} />
          322 y 342 — mismo proveedor (una firma, imputación separada)
        </label>
      </div>

      <label style={{ ...S.label, marginTop: 14 }}>Tipo de trámite</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {["inicio", "ampliación", "renovación"].map((t) => (
          <label key={t} style={chip(f.tipoTramite === t)}>
            <input type="radio" name="tipoTramite" checked={f.tipoTramite === t} onChange={() => setF({ ...f, tipoTramite: t })} />
            {t}
          </label>
        ))}
      </div>

      <label style={{ ...S.label, marginTop: 16 }}>📑 Fojas del expediente</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
        <div>
          <label style={{ ...S.label, marginTop: 4, fontWeight: 600 }}>Solicitud (fs.)</label>
          <input style={S.input} value={f.fsSolicitud} onChange={set("fsSolicitud")} placeholder="02,04" />
        </div>
        <div>
          <label style={{ ...S.label, marginTop: 4, fontWeight: 600 }}>Presupuesto (fs.)</label>
          <input style={S.input} value={f.fsPresupuesto} onChange={set("fsPresupuesto")} placeholder="31" />
        </div>
        <div>
          <label style={{ ...S.label, marginTop: 4, fontWeight: 600 }}>Cuadro comp. (fs.)</label>
          <input style={S.input} value={f.fsCuadro} onChange={set("fsCuadro")} placeholder="32" />
        </div>
        <div>
          <label style={{ ...S.label, marginTop: 4, fontWeight: 600 }}>Dictamen aud. (fs.)</label>
          <input style={S.input} value={f.fsDictamen} onChange={set("fsDictamen")} placeholder="34" />
        </div>
      </div>

      {!esDoble && !esDobleMismo && (
        <div>
          <label style={S.label}>Imputación presupuestaria (Artículo 2º)</label>
          <textarea style={{ ...S.input, minHeight: 70 }} value={f.imputacion} onChange={set("imputacion")} />
        </div>
      )}

      {esDobleMismo && (
        <div style={{ marginTop: 14, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 800, color: "#334155" }}>📋 Servicios adjudicados (un solo cuadro, todos los ítems)</div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
            Se completó solo con lo que adjudicó el cuadro comparativo — retocalo si hace falta.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 190px", gap: 10 }}>
            <div>
              <label style={{ ...S.label, fontWeight: 600 }}>Firma comercial adjudicada</label>
              <input style={S.input} value={f.firmaA} onChange={set("firmaA")} placeholder="QUIMUR SRL" />
            </div>
            <div>
              <label style={{ ...S.label, fontWeight: 600 }}>Precio mensual total ($)</label>
              <input style={S.input} type="number" value={f.mensualUnico ?? exp.cuadro?.mensual ?? ""}
                onChange={(e) => setF({ ...f, mensualUnico: e.target.value })} />
            </div>
          </div>

          <label style={{ ...S.label, fontWeight: 600 }}>Detalle de las prestaciones (celda del cuadro)</label>
          <textarea style={{ ...S.input, minHeight: 78 }} value={f.detalleUnico} onChange={set("detalleUnico")} />

          <div style={{ marginTop: 12, borderTop: "1px dashed #cbd5e1", paddingTop: 10 }}>
            <div style={{ fontWeight: 800, color: "#334155", fontSize: 14 }}>
              💰 Reparto para el ARTÍCULO 2º — las subpartidas se imputan por separado
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, marginBottom: 8 }}>
              Cargá cuánto del mensual corresponde a internación. El resto se imputa solo a alimentación.
            </div>
            {(() => {
              const mensualTot = Number(f.mensualUnico ?? exp.cuadro?.mensual ?? 0);
              const m342 = Number(f.montoSub342 || 0);
              const m322 = mensualTot - m342;
              const meses = Number(exp.periodoMeses || 6);
              const mal = m342 < 0 || m322 < 0 || m342 > mensualTot;
              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ ...S.label, fontWeight: 600 }}>Mensual internación — Subp. {f.subA} ($)</label>
                      <input style={S.input} type="number" value={f.montoSub342 ?? ""}
                        onChange={(e) => setF({ ...f, montoSub342: e.target.value })} />
                    </div>
                    <div>
                      <label style={{ ...S.label, fontWeight: 600 }}>Mensual alimentación — Subp. {f.subB} ($)</label>
                      <div style={{ ...S.input, background: "#f1f5f9", fontWeight: 800, color: mal ? "#b91c1c" : "#075e75" }}>
                        {formatoPesos(m322)}
                      </div>
                    </div>
                  </div>
                  {mal && (
                    <div style={{ color: "#b91c1c", fontWeight: 700, fontSize: 13, marginTop: 6 }}>
                      ⚠️ El monto de internación no puede ser mayor que el mensual total.
                    </div>
                  )}
                  {mensualTot > 0 && (
                    <div style={{ background: "#e0f2fe", borderRadius: 8, padding: 10, marginTop: 10, fontSize: 14, color: "#075e75" }}>
                      <div style={{ fontWeight: 700 }}>Por {meses} meses el Artículo 2º va a decir:</div>
                      <div style={{ marginTop: 4 }}>Subp. <b>{f.subA}</b> (internación): <b>{formatoPesos(m342 * meses)}</b></div>
                      <div>Subp. <b>{f.subB}</b> (alimentación): <b>{formatoPesos(m322 * meses)}</b></div>
                      <div style={{ borderTop: "1px solid #bae6fd", marginTop: 6, paddingTop: 6, fontWeight: 800, textAlign: "right" }}>
                        Total: {formatoPesos(mensualTot * meses)}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {esDoble && (
        <div style={{ marginTop: 14 }}>
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 800, color: "#334155" }}>🅰️ Firma A — Internación Domiciliaria (Subpartida {f.subA})</div>
            <div style={{ display: "grid", gridTemplateColumns: esDobleMismo ? "110px 170px" : "1fr 110px 170px", gap: 10 }}>
              {!esDobleMismo && <div>
                <label style={{ ...S.label, fontWeight: 600 }}>Firma comercial</label>
                <input style={S.input} value={f.firmaA} onChange={set("firmaA")} placeholder="VISALUD" />
              </div>}
              <div>
                <label style={{ ...S.label, fontWeight: 600 }}>Subpartida</label>
                <input style={S.input} value={f.subA} onChange={set("subA")} />
              </div>
              <div>
                <label style={{ ...S.label, fontWeight: 600 }}>Precio mensual ($)</label>
                <input style={S.input} type="number" value={f.mensualA} onChange={set("mensualA")} />
              </div>
            </div>
            <label style={{ ...S.label, fontWeight: 600 }}>Detalle de servicios (celda de la tabla A)</label>
            <textarea style={{ ...S.input, minHeight: 55 }} value={f.detalleA} onChange={set("detalleA")} placeholder={nombresItems || "Enfermería 12hs de lunes a Domingo; Kinesiología..."} />
            {f.mensualA && <div style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: "#075e75", marginTop: 4 }}>Total A por {exp.periodoMeses} meses: {formatoPesos(totalA)}</div>}
          </div>

          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginTop: 10 }}>
            <div style={{ fontWeight: 800, color: "#334155" }}>🅱️ Firma B — Alimentación Domiciliaria (Subpartida {f.subB})</div>
            <div style={{ display: "grid", gridTemplateColumns: esDobleMismo ? "110px 170px" : "1fr 110px 170px", gap: 10 }}>
              {!esDobleMismo && <div>
                <label style={{ ...S.label, fontWeight: 600 }}>Firma comercial</label>
                <input style={S.input} value={f.firmaB} onChange={set("firmaB")} placeholder="NUTRIHOME" />
              </div>}
              <div>
                <label style={{ ...S.label, fontWeight: 600 }}>Subpartida</label>
                <input style={S.input} value={f.subB} onChange={set("subB")} />
              </div>
              <div>
                <label style={{ ...S.label, fontWeight: 600 }}>Precio mensual ($)</label>
                <input style={S.input} type="number" value={f.mensualB} onChange={set("mensualB")} />
              </div>
            </div>
            <label style={{ ...S.label, fontWeight: 600 }}>Detalle de servicios (celda de la tabla B)</label>
            <textarea style={{ ...S.input, minHeight: 55 }} value={f.detalleB} onChange={set("detalleB")} placeholder="Módulo de alimentación domiciliaria por 31 días" />
            {f.mensualB && <div style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: "#075e75", marginTop: 4 }}>Total B por {exp.periodoMeses} meses: {formatoPesos(totalB)}</div>}
          </div>

          {f.mensualA && f.mensualB && (
            <div style={{ background: "#e0f2fe", borderRadius: 8, padding: 10, marginTop: 10, fontSize: 14, color: "#075e75", fontWeight: 800, textAlign: "right" }}>
              Monto total por {exp.periodoMeses} meses: {formatoPesos(totalA + totalB)}
            </div>
          )}
        </div>
      )}

      <button style={{ ...S.btn, marginTop: 16, width: "100%", fontSize: 16 }} onClick={generar}>
        👁️ GENERAR Y REVISAR LA RESOLUCIÓN
      </button>
    </div>
  );
}

function PaseTribunal({ exp }) {
  const [revisando, setRevisando] = useState(false);

  if (revisando) {
    return (
      <VistaPrevia
        construirPlantilla={(logos) => plantillaPase(datosPaseTribunal(exp), logos)}
        onCerrar={() => setRevisando(false)}
        onListo={async () => {
          await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
            etapa: Math.max(exp.etapa, 8),
            paseTribunal: { fecha: new Date().toISOString() },
          });
        }}
      />
    );
  }

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #f59e0b" }}>
      <h3 style={{ color: "#075e75", marginBottom: 4 }}>🏛️ Pase al Tribunal de Cuentas</h3>
      <div style={{ fontSize: 13, color: "#64748b" }}>
        Nota solicitando la intervención de competencia del Honorable Tribunal de Cuentas sobre el <b>Expediente {exp.nroExpediente}</b>, con fecha de hoy y la firma de la Gerente. La revisás en pantalla y generás el PDF.
      </div>

      <button style={{ ...S.btn, marginTop: 16, width: "100%", fontSize: 16 }} onClick={() => setRevisando(true)}>
        👁️ GENERAR Y REVISAR EL PASE
      </button>
    </div>
  );
}

function generarCuerpoAdjudicacion(exp, nroOC, firmante, moduloTexto) {
  const moduloMail = String(moduloTexto || exp.modulo || "").toUpperCase();
  return (
`Estimados:

*INICIO DE PRESTACIÓN expte ${exp.nroExpediente} ${exp.paciente.toUpperCase()}. ${moduloMail}.* En la que se Adjudica a uds como Proveedores de la Prestación de Servicios.

*Se solicita se nos informe vía mail:*

• *RECEPCIÓN DEL MAIL.*
• *FECHA DE INICIO EN LA QUE SE BRINDARÁ LA PRESTACIÓN.*

ENVÍO *Nº DE ORDEN ${nroOC || "____"}*.-

--
Confirmar Recepción
Atte. ${firmante}

Internaciones Domiciliarias.
Oficina de Compras y Contrataciones.
Gerencia Administrativa.`
  );
}

function OrdenCompraEnvio({ exp, proveedores }) {
  // Firmas que quedaron adjudicadas en el cuadro (una o varias)
  const adjsExp = exp.cuadro?.adjudicaciones || [];
  const firmasAdj = firmasAdjudicadas(adjsExp);
  const firmas = firmasAdj.length
    ? firmasAdj
    : String(exp.cuadro?.adjudicado || "").split(" / ").map((x) => x.trim()).filter(Boolean);
  const varias = firmas.length > 1;
  const firmaInicial = (USUARIOS.find((u) => u.id === exp.responsable)?.firma) || FIRMANTES[0];

  const emailsDe = (nombres) =>
    nombres.map((n) => (proveedores.find((p) => p.nombre === n)?.emails) || "").filter(Boolean).join(", ");
  const modulosDe = (nombres) => {
    const ms = [];
    adjsExp.forEach((a) => {
      if (nombres.includes(a.proveedor) && a.modulo && !ms.includes(a.modulo)) ms.push(a.modulo);
    });
    return ms;
  };
  const textoModulo = (nombres) => modulosDe(nombres).join(" y ") || exp.modulo || "";

  // Órdenes que YA se enviaron (quedan grabadas en el expediente).
  // Sirve para que, si cerrás la pantalla o se corta a mitad de camino,
  // al volver no se pueda mandar dos veces la misma orden al mismo proveedor.
  const ocGuardada = exp.oc || {};
  const yaEnviados = ocGuardada.envios || [];
  const modoInicial = ocGuardada.modo || (varias ? "porFirma" : "una");

  // Un bloque = una orden de compra a enviar
  const armarBloques = (m, quien) => {
    const grupos = m === "porFirma" ? firmas.map((fm) => [fm]) : [firmas];
    return grupos.map((g) => {
      const clave = g.join(" / ");
      const ya = yaEnviados.find((e) => e.proveedor === clave);
      return {
        clave,
        firmas: g,
        nro: ya ? ya.nro || "" : "",
        destinatarios: ya ? ya.destinatarios || emailsDe(g) : emailsDe(g),
        asunto: "ENVIO ORDEN DE COMPRA " + textoModulo(g).toUpperCase() + " " + exp.paciente.toUpperCase(),
        cuerpo: generarCuerpoAdjudicacion(exp, ya ? ya.nro || "" : "", quien, textoModulo(g)),
        archivo: null,
        enviado: !!ya,
        pdfUrl: ya ? ya.pdfUrl || "" : "",
        fechaEnvio: ya ? ya.fecha || "" : "",
      };
    });
  };

  const [modo, setModo] = useState(modoInicial);
  const [firmante, setFirmante] = useState(ocGuardada.firmante || firmaInicial);
  const [bloques, setBloques] = useState(() => armarBloques(modoInicial, ocGuardada.firmante || firmaInicial));
  const [enviando, setEnviando] = useState("");

  const cambiarModo = (m) => {
    if (bloques.some((b) => b.enviado)) {
      alert("Ya enviaste una de las órdenes. Si necesitás cambiar el modo, recargá la pantalla.");
      return;
    }
    setModo(m);
    setBloques(armarBloques(m, firmante));
  };
  const cambiarFirmante = (nuevo) => {
    setFirmante(nuevo);
    setBloques(bloques.map((b) => ({
      ...b, cuerpo: generarCuerpoAdjudicacion(exp, b.nro, nuevo, textoModulo(b.firmas)),
    })));
  };
  const setB = (k, campo, valor) =>
    setBloques(bloques.map((b, i) => (i === k
      ? {
          ...b,
          [campo]: valor,
          cuerpo: campo === "nro" ? generarCuerpoAdjudicacion(exp, valor, firmante, textoModulo(b.firmas)) : b.cuerpo,
        }
      : b)));

  const enviar = async (k) => {
    const b = bloques[k];
    if (!b.nro) { alert("Cargá el N° de la orden de compra de " + b.clave + "."); return; }
    if (!b.archivo) { alert("Adjuntá el PDF de la orden de compra de " + b.clave + "."); return; }
    const listaDest = b.destinatarios.split(",").map((e) => e.trim()).filter(Boolean);
    if (listaDest.length === 0) { alert("Cargá al menos un correo de destino para " + b.clave + "."); return; }
    if (!confirm(`Se enviará el mail de adjudicación con la OC Nº ${b.nro} adjunta a:\n\n${listaDest.map((d) => "• " + d).join("\n")}\n\n¿Confirmás el envío?`)) return;

    setEnviando(b.clave);
    try {
      const base64 = await leerArchivoBase64(b.archivo);
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({
          accion: "enviarAdjudicacion", clave: APPS_SCRIPT_CLAVE,
          nroExpediente: exp.nroExpediente, paciente: exp.paciente,
          modulo: textoModulo(b.firmas), nroOC: b.nro, firmante,
          asunto: b.asunto, cuerpo: b.cuerpo, destinatarios: listaDest,
          adjunto: { nombre: b.archivo.name, mimeType: b.archivo.type || "application/pdf", base64 },
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Error en Apps Script");

      const ahora = new Date().toISOString();
      const nuevos = bloques.map((x, i) => (i === k ? { ...x, enviado: true, pdfUrl: data.ocPdfUrl || "", fechaEnvio: ahora } : x));
      setBloques(nuevos);

      const todasEnviadas = nuevos.every((x) => x.enviado);
      const envios = nuevos.filter((x) => x.enviado).map((x) => ({
        proveedor: x.clave,
        modulo: textoModulo(x.firmas),
        nro: x.nro,
        destinatarios: x.destinatarios,
        pdfUrl: x.pdfUrl || "",
        fecha: x.fechaEnvio || ahora,
      }));
      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
        ...(todasEnviadas ? { etapa: 9 } : {}),
        oc: {
          fecha: ahora,
          modo,
          envios,
          // se mantienen los campos de siempre para no romper lo ya guardado
          nro: envios.map((e) => e.nro).join(" / "),
          firmante,
          destinatarios: envios.map((e) => e.destinatarios).join(" / "),
          pdfUrl: envios[0]?.pdfUrl || "",
        },
      });
      alert(todasEnviadas
        ? "✅ Mail de adjudicación enviado con la OC Nº " + b.nro + ". ¡Expediente completo! 🎉"
        : "✅ Enviada la OC Nº " + b.nro + " a " + b.clave + ".\n\nTodavía queda por enviar: " +
          nuevos.filter((x) => !x.enviado).map((x) => x.clave).join(", "));
    } catch (e) {
      alert("❌ Error al enviar: " + e.message);
    }
    setEnviando("");
  };

  const chipOC = (activo) => ({
    display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
    borderRadius: 8, border: "1.5px solid " + (activo ? "#0891b2" : "#cbd5e1"),
    background: activo ? "#e0f2fe" : "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600,
  });

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #f59e0b" }}>
      <h3 style={{ color: "#075e75", marginBottom: 4 }}>🧾 Orden de compra y mail al adjudicado</h3>
      <div style={{ fontSize: 13, color: "#64748b" }}>
        La OC la emitís en el sistema del SIPROSA como siempre. Acá cargás el número, subís el PDF y el sistema se lo manda a{" "}
        <b>{firmas.join(" y ") || "el proveedor adjudicado"}</b> con el texto oficial, tu firma y los logos. La OC queda guardada también en el Drive del expediente.
      </div>

      {varias && (
        <>
          <label style={S.label}>El expediente se adjudicó a {firmas.length} firmas. ¿Cuántas órdenes de compra son?</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
            <label style={chipOC(modo === "porFirma")}>
              <input type="radio" name="modo-oc" checked={modo === "porFirma"} onChange={() => cambiarModo("porFirma")} />
              Una orden por firma ({firmas.length} órdenes, {firmas.length} PDF)
            </label>
            <label style={chipOC(modo === "una")}>
              <input type="radio" name="modo-oc" checked={modo === "una"} onChange={() => cambiarModo("una")} />
              Una sola orden para las {firmas.length} firmas
            </label>
          </div>
        </>
      )}

      <label style={S.label}>¿Quién envía {bloques.length > 1 ? "los mails" : "este mail"}? (la firma sale en el mail)</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {FIRMANTES.map((fi) => (
          <label key={fi} style={chipOC(firmante === fi)}>
            <input type="radio" name="firmante-oc" checked={firmante === fi} onChange={() => cambiarFirmante(fi)} />
            {fi}
          </label>
        ))}
      </div>

      {bloques.map((b, k) => (
        <div key={b.clave} style={{
          border: "1px solid " + (b.enviado ? "#86efac" : "#e2e8f0"), borderRadius: 10,
          padding: 12, marginTop: 14, background: b.enviado ? "#f0fdf4" : "#fff",
        }}>
          {bloques.length > 1 && (
            <div style={{ fontWeight: 800, color: "#075e75", marginBottom: 8 }}>
              {b.enviado ? "✅ " : "📄 "}Orden de compra para {b.clave}
              {modulosDe(b.firmas).length > 0 && (
                <span style={{ fontWeight: 600, color: "#64748b" }}> — {modulosDe(b.firmas).join(" y ")}</span>
              )}
            </div>
          )}

          {b.enviado ? (
            <div style={{ fontSize: 14, color: "#166534", fontWeight: 600 }}>
              Enviada la OC Nº {b.nro} a {b.destinatarios}
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10 }}>
                <div>
                  <label style={S.label}>N° de orden de compra</label>
                  <input style={S.input} value={b.nro} onChange={(e) => setB(k, "nro", e.target.value)} placeholder="18344" />
                </div>
                <div>
                  <label style={S.label}>Correo(s) del adjudicado — separados por coma</label>
                  <input style={S.input} value={b.destinatarios} onChange={(e) => setB(k, "destinatarios", e.target.value)} placeholder="correo@proveedor.com.ar" />
                </div>
              </div>

              <label style={S.label}>PDF de la orden de compra (obligatorio — va adjunto al mail)</label>
              <input type="file" accept="application/pdf" style={{ marginTop: 6 }} onChange={(e) => setB(k, "archivo", e.target.files[0])} />
              {b.archivo && <div style={{ fontSize: 13, color: "#334155", marginTop: 6 }}>📎 {b.archivo.name} ({(b.archivo.size / 1024 / 1024).toFixed(1)} MB)</div>}

              <label style={S.label}>Asunto</label>
              <input style={S.input} value={b.asunto} onChange={(e) => setB(k, "asunto", e.target.value)} />

              <label style={S.label}>Cuerpo del mail — lo que ves acá es lo que sale. Para NEGRITA encerrá la palabra entre asteriscos: *así*.</label>
              <textarea style={{ ...S.input, minHeight: 220, fontFamily: "inherit", fontSize: 14 }} value={b.cuerpo} onChange={(e) => setB(k, "cuerpo", e.target.value)} />

              <button style={{ ...S.btn, marginTop: 14, width: "100%", fontSize: 16, opacity: enviando ? 0.6 : 1 }}
                disabled={!!enviando} onClick={() => enviar(k)}>
                {enviando === b.clave
                  ? "⏳ Enviando mail y guardando en Drive..."
                  : "📨 ENVIAR ORDEN DE COMPRA A " + b.clave.toUpperCase()}
              </button>
            </>
          )}
        </div>
      ))}

      {bloques.length > 1 && !bloques.every((b) => b.enviado) && (
        <div style={{ fontSize: 13, color: "#b45309", marginTop: 10, fontWeight: 600 }}>
          El expediente se cierra cuando estén enviadas las {bloques.length} órdenes.
          {bloques.some((b) => b.enviado) && " Las que figuran en verde ya salieron y no se vuelven a enviar."}
        </div>
      )}
    </div>
  );
}

function Proveedores({ proveedores }) {
  const [nuevo, setNuevo] = useState({ nombre: "", emails: "" });
  const [editando, setEditando] = useState(null); // {id, nombre, emails}

  const cargarIniciales = async () => {
    for (const p of PROVEEDORES_INICIALES) {
      await addDoc(collection(db, COL_PROVEEDORES), p);
    }
  };

  const agregar = async () => {
    if (!nuevo.nombre || !nuevo.emails) { alert("Completá nombre y correo(s)."); return; }
    await addDoc(collection(db, COL_PROVEEDORES), { ...nuevo, activo: true });
    setNuevo({ nombre: "", emails: "" });
  };

  const guardarEdicion = async () => {
    await updateDoc(doc(db, COL_PROVEEDORES, editando.id), { nombre: editando.nombre, emails: editando.emails });
    setEditando(null);
  };

  return (
    <div>
      <div style={S.card}>
        <h3 style={{ color: "#075e75" }}>Proveedores</h3>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>
          Estos son los proveedores que reciben los pedidos de cotización. Podés agregar nuevos, editar correos o desactivar los que no correspondan (sin borrarlos).
        </div>

        {proveedores.length === 0 && (
          <button style={S.btn} onClick={cargarIniciales}>⬇️ Cargar los 6 proveedores habituales</button>
        )}

        {proveedores.map((p) => (
          <div key={p.id} style={{
            border: "1.5px solid #e2e8f0", borderRadius: 10, padding: 12, marginTop: 10,
            opacity: p.activo ? 1 : 0.5,
          }}>
            {editando?.id === p.id ? (
              <div>
                <input style={S.input} value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} />
                <input style={S.input} value={editando.emails} onChange={(e) => setEditando({ ...editando, emails: e.target.value })} placeholder="correo1@..., correo2@..." />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button style={S.btn} onClick={guardarEdicion}>Guardar</button>
                  <button style={S.btnSec} onClick={() => setEditando(null)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 800, color: "#075e75" }}>{p.nombre} {!p.activo && "· INACTIVO"}</div>
                  <div style={{ fontSize: 13, color: "#475569" }}>{p.emails}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={S.btnSec} onClick={() => setEditando({ id: p.id, nombre: p.nombre, emails: p.emails })}>✏️ Editar</button>
                  <button style={p.activo ? S.btnRojo : S.btn} onClick={() => updateDoc(doc(db, COL_PROVEEDORES, p.id), { activo: !p.activo })}>
                    {p.activo ? "Desactivar" : "Activar"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={S.card}>
        <h4 style={{ color: "#075e75" }}>➕ Agregar proveedor nuevo</h4>
        <label style={S.label}>Nombre de la empresa</label>
        <input style={S.input} value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="NUEVA EMPRESA SRL" />
        <label style={S.label}>Correo(s) — separados por coma si son varios</label>
        <input style={S.input} value={nuevo.emails} onChange={(e) => setNuevo({ ...nuevo, emails: e.target.value })} placeholder="contacto@empresa.com.ar, ventas@empresa.com.ar" />
        <button style={{ ...S.btn, marginTop: 14 }} onClick={agregar}>Agregar</button>
      </div>
    </div>
  );
}
