import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot,
} from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

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
    '<p style="margin-left:146pt; margin-top:12pt;">' + lineaModulo + "</p>" +
    '<p style="text-align:justify; text-indent:135pt; line-height:1.5; margin-top:14pt;">' +
    "Para los periodos de <b>" + esc(d.periodoTexto) + "</b>, por el importe total por " + esc(d.periodoMeses) +
    " meses de <b>" + esc(d.montoFormato) + "</b> (" + letras + ") a la " + impHtml + ".</p>" +
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
      "<br>Paciente: " + esc(d.paciente) + "<br>DNI: " + esc(d.dni) + "</p>" +
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
      porElloHtml(d.firmante) +
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
      art("Imputar a <b>Subpartida " + esc(d.subA) + "</b> la suma de <b>" + formatoPesos(totalSubA) + "</b> (" + letrasSubA +
        ") correspondiente al servicio de Internación Domiciliaria, para la firma <b>" + adj + "</b> (por " + meses + " meses).<br>" +
        "Imputar a <b>Subpartida " + esc(d.subB) + "</b> la suma de <b>" + formatoPesos(totalSubB) + "</b> (" + letrasSubB +
        ") correspondiente al Módulo de Alimentación domiciliaria, para la firma <b>" + adj + "</b> (por " + meses + " meses)" +
        "; a Jurisdicción 67 - Unid. Org. 965 - Recurso 10 - Finalidad/Función 314 - Programa 19 - Actividad 01 - Partida 300 - con cargo al <b>Presupuesto del año " + esc(d.anioPresupuesto) + "</b>.") +
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
      porElloHtml(d.firmante) +
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
    porElloHtml(d.firmante) +
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

const datosNota = (exp, extra = {}) => ({
  nroExpediente: exp.nroExpediente, paciente: exp.paciente, dni: exp.dni,
  modulo: exp.modulo, periodoTexto: exp.periodoTexto || exp.periodoMeses + " meses", periodoMeses: exp.periodoMeses,
  monto: extra.monto ?? exp.nota?.monto ?? (exp.cuadro?.mensual || 0) * Number(exp.periodoMeses || 6),
  montoFormato: formatoPesos(extra.monto ?? exp.nota?.monto ?? (exp.cuadro?.mensual || 0) * Number(exp.periodoMeses || 6)),
  directora: extra.directora ?? exp.nota?.directora ?? "Dra. Noellia Bottone",
  imputacion: extra.imputacion ?? exp.nota?.imputacion ?? IMPUTACION_NOTA_DEFECTO,
  fechaTexto: extra.fechaTexto ?? exp.nota?.fechaTexto ?? fechaLargaHoy(),
});

const datosPaseAuditoria = (exp, extra = {}) => ({
  tipo: "auditoria",
  nroExpediente: exp.nroExpediente, paciente: exp.paciente, dni: exp.dni,
  destinataria: extra.destinataria ?? exp.paseAuditoria?.destinataria ?? "Farm. María Gabriela Policelli",
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
  const total = extra.total ?? r.total ?? (exp.cuadro?.mensual || 0) * Number(exp.periodoMeses || 6);
  const itemsTxt = (exp.itemsPrestacion || []).map((it) => it.nombre + (it.cantTexto ? " " + it.cantTexto : "")).join("; ");
  const nombresTxt = (exp.itemsPrestacion || []).map((it) => it.nombre).join("; ");
  return {
    nroExpediente: exp.nroExpediente, paciente: exp.paciente,
    modulo: exp.modulo, periodoTexto: exp.periodoTexto || "", periodoMeses: exp.periodoMeses,
    adjudicado: exp.cuadro?.adjudicado || "", mensual: exp.cuadro?.mensual || 0, total,
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
    mensualA: extra.mensualA ?? r.mensualA ?? "",
    subB: extra.subB ?? r.subB ?? "322",
    tituloB: extra.tituloB ?? r.tituloB ?? "",
    detalleB: extra.detalleB ?? r.detalleB ?? "",
    firmaB: extra.firmaB ?? r.firmaB ?? "",
    mensualB: extra.mensualB ?? r.mensualB ?? "",
    fechaTexto: fechaLargaHoy(),
  };
};

// Extrae prestaciones de un texto: toma solo las líneas tipo "Nombre: cantidad"
// (nombre corto), descartando encabezados y frases largas. Hs/Ses. queda vacío
// para carga manual (varía según el mes y lo autorizado por Auditoría Médica).
function extraerItemsDeTexto(texto) {
  const lineas = String(texto || "").split("\n")
    .map((l) => l.replace(/^[-•*\s]+/, "").replace(/\*/g, "").trim())
    .filter(Boolean);
  const items = [];
  lineas.forEach((l) => {
    // Formato 1: "Nombre: cantidad" (con dos puntos)
    const i = l.indexOf(":");
    if (i > 0 && i <= 45) {
      const nombre = l.slice(0, i).trim();
      const resto = l.slice(i + 1).trim().replace(/\.\s*$/, "");
      items.push({ nombre, cantTexto: resto, cantNum: "" });
      return;
    }
    // Formato 2: "Nombre 2 hs semanales" (sin dos puntos: corta donde empieza el primer número)
    const m = l.match(/\d/);
    if (m && m.index >= 3 && m.index <= 70) {
      const nombre = l.slice(0, m.index).replace(/[+\-–(\s]+$/, "").trim();
      const resto = l.slice(m.index).trim().replace(/\.\s*$/, "");
      if (nombre && /[a-záéíóúñ]/i.test(nombre)) {
        items.push({ nombre, cantTexto: resto, cantNum: "" });
      }
    }
    // Las líneas largas o sin cantidad (encabezados, frases) se descartan solas
  });
  return items;
}

/* ---------- MÓDULOS DEL CUADRO COMPARATIVO ----------
   Un ítem puede llevar un campo "modulo" (texto libre). Si ningún ítem lo tiene,
   o todos comparten el mismo, el cuadro se comporta exactamente como antes. */

function modulosDeItems(items) {
  const vistos = [];
  (items || []).forEach((it) => {
    const m = it && it.modulo ? String(it.modulo).trim() : "";
    if (!vistos.includes(m)) vistos.push(m);
  });
  return vistos.length ? vistos : [""];
}

function hayVariosModulos(items) { return modulosDeItems(items).length > 1; }

function itemsDelModulo(items, mod) {
  const salida = [];
  (items || []).forEach((it, i) => {
    const m = it && it.modulo ? String(it.modulo).trim() : "";
    if (m === mod) salida.push({ it, i });
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

export default function App() {
  const [logueado, setLogueado] = useState(localStorage.getItem("gexp_login") === "ok");
  const [usuario, setUsuario] = useState(localStorage.getItem("gexp_usuario") || "");
  const [vista, setVista] = useState("tablero"); // tablero | nuevo | detalle | proveedores
  const [expedientes, setExpedientes] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [expedienteSel, setExpedienteSel] = useState(null);

  const elegirUsuario = (id) => {
    localStorage.setItem("gexp_usuario", id);
    setUsuario(id);
  };

  useEffect(() => {
    signInAnonymously(auth).catch((e) => console.error("Auth:", e));
  }, []);

  useEffect(() => {
    if (!logueado) return;
    const u1 = onSnapshot(collection(db, COL_EXPEDIENTES), (snap) => {
      const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

  if (!logueado) return <Login onOk={() => { localStorage.setItem("gexp_login", "ok"); setLogueado(true); }} />;
  if (!usuario) return (
    <SeleccionUsuario
      onElegir={elegirUsuario}
      onVolver={() => { localStorage.removeItem("gexp_login"); setLogueado(false); }}
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
          <button style={S.btnRojo} onClick={() => { localStorage.removeItem("gexp_login"); localStorage.removeItem("gexp_usuario"); setUsuario(""); setLogueado(false); }}>Salir</button>
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

function SeleccionUsuario({ onElegir, onVolver }) {
  return (
    <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center" }}>
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

/* ---------- Tablero ---------- */

function Tablero({ expedientes, usuario, abrir }) {
  const [filtro, setFiltro] = useState("mios"); // mios | todos
  const lista = filtro === "mios"
    ? expedientes.filter((e) => (e.responsable || "") === usuario)
    : expedientes;

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
                <div style={{ fontSize: 12, marginTop: 4, fontWeight: 700, color: e.responsable ? "#0e7490" : "#94a3b8" }}>
                  👤 {e.responsable || "Sin responsable asignado"}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={S.chip(true, e.etapa > 0)}>
                  {e.etapa === 0 ? "⏳ Sin cotizar" : ETAPAS[e.etapa - 1] + " ✓"}
                </span>
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
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const edad = calcularEdad(f.fechaNacimiento);

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
        const data = { ...f, edad, etapa: 0, creado: new Date().toISOString() };
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
      <h3 style={{ color: "#075e75", marginBottom: 4 }}>{titulos[modo][0]}</h3>
      <div style={{ fontSize: 13, color: "#64748b" }}>{titulos[modo][1]}</div>

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

      <PaseAuditoria exp={exp} />

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
              <RevisarCuadro exp={exp} />
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

      {/* ---------- 4) Asesoría Letrada ---------- */}
      {abierta === 4 && (<>
        {exp.etapa === 4 && <PaseLetrada exp={exp} />}
        {exp.etapa >= 5 && exp.paseLetrada && (
          <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
            <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Pase a Asesoría Letrada generado</div>
            <div style={{ fontSize: 14, color: "#334155" }}>
              <b>Fecha:</b> {formatearFecha(exp.paseLetrada.fecha)}
            </div>
            <BotonRevisar construirPlantilla={(logos) => plantillaPase(datosPaseLetrada(exp), logos)} />
          </div>
        )}
        {exp.etapa < 4 && aviso("Todavía falta la nota de afectación presupuestaria.")}
      </>)}

      {/* ---------- 5) Resolución ---------- */}
      {abierta === 5 && (<>
        {exp.etapa === 5 && <GenerarResolucion exp={exp} />}
        {exp.etapa >= 6 && exp.resolucion && (
          <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
            <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Resolución Interna Nº {exp.resolucion.nro} generada</div>
            <div style={{ fontSize: 14, color: "#334155" }}>
              <b>Fecha:</b> {formatearFecha(exp.resolucion.fecha)}<br />
              <b>Adjudicado:</b> {exp.resolucion.adjudicado} · <b>Monto total:</b> {formatoPesos(exp.resolucion.total)}
            </div>
            <ReabrirGenerador etiqueta="✏️ Modificar y regenerar (firmante, subpartidas, fojas, N°)" render={() => <GenerarResolucion exp={exp} />} />
          </div>
        )}
        {exp.etapa < 5 && aviso("Todavía falta el pase a Asesoría Letrada.")}
      </>)}

      {/* ---------- 6) Tribunal de Cuentas ---------- */}
      {abierta === 6 && (<>
        {exp.etapa === 6 && <PaseTribunal exp={exp} />}
        {exp.etapa >= 7 && exp.paseTribunal && (
          <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
            <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Pase al Tribunal de Cuentas generado</div>
            <div style={{ fontSize: 14, color: "#334155" }}>
              <b>Fecha:</b> {formatearFecha(exp.paseTribunal.fecha)}
            </div>
            <BotonRevisar construirPlantilla={(logos) => plantillaPase(datosPaseTribunal(exp), logos)} />
          </div>
        )}
        {exp.etapa < 6 && aviso("Todavía falta la Resolución Interna.")}
      </>)}

      {/* ---------- 7) Orden de compra ---------- */}
      {abierta === 7 && (<>
        {exp.etapa === 7 && <OrdenCompraEnvio exp={exp} proveedores={proveedores} />}
        {exp.etapa >= 8 && exp.oc && (
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
        {exp.etapa >= 8 && (
          <div style={{ ...S.card, background: "#f0fdf4", border: "2px solid #16a34a", textAlign: "center" }}>
            <div style={{ fontSize: 22 }}>🎉</div>
            <div style={{ fontWeight: 800, color: "#166534", fontSize: 16 }}>Expediente completo</div>
            <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
              Las 8 etapas del circuito están cerradas. Cuando se acerque el fin del período, usá <b>🔄 Renovar período</b> para arrancar el trámite nuevo con los datos ya cargados.
            </div>
          </div>
        )}
        {exp.etapa < 7 && aviso("Todavía falta el pase al Tribunal de Cuentas.")}
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
function RevisarCuadro({ exp }) {
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [textos, setTextos] = useState(null);

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
        ((modulosDeItems(payload.items).length > 1 ? a.modulo : (exp.modulo || a.modulo)) || "").toUpperCase() +
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

  if (!abierto) {
    return (
      <button style={{ ...S.btnSec, marginTop: 10 }} onClick={abrir}>
        👁️ Revisar / descargar de nuevo (PDF o Excel)
      </button>
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
  const [abierto, setAbierto] = useState(false);
  const [destinataria, setDestinataria] = useState(exp.paseAuditoria?.destinataria || "Farm. María Gabriela Policelli");
  const [revisando, setRevisando] = useState(false);

  if (revisando) {
    return (
      <VistaPrevia
        construirPlantilla={(logos) => plantillaPase(datosPaseAuditoria(exp, { destinataria }), logos)}
        onCerrar={() => { setRevisando(false); setAbierto(false); }}
        onListo={async () => {
          await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
            paseAuditoria: { fecha: new Date().toISOString(), destinataria },
          });
        }}
      />
    );
  }

  return (
    <div style={{ ...S.card, borderLeft: exp.paseAuditoria ? "5px solid #16a34a" : "5px solid #94a3b8" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800, color: exp.paseAuditoria ? "#166534" : "#334155" }}>
          {exp.paseAuditoria ? "✅ Pase a Auditoría Médica generado" : "🩺 Pase a Auditoría Médica"}
        </div>
        <div style={{ flex: 1 }} />
        <button style={S.btnSec} onClick={() => setAbierto(!abierto)}>
          {abierto ? "▲ Ocultar" : exp.paseAuditoria ? "👁️ Revisar / regenerar" : "▼ Generar"}
        </button>
      </div>
      {exp.paseAuditoria && (
        <div style={{ fontSize: 13, color: "#334155", marginTop: 4 }}>
          <b>Fecha:</b> {formatearFecha(exp.paseAuditoria.fecha)} · <b>Dirigido a:</b> {exp.paseAuditoria.destinataria}
        </div>
      )}
      {abierto && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, color: "#64748b" }}>
            Nota dirigida al Departamento de Auditoría Médica solicitando intervención de competencia (para el dictamen). Con REF de expediente, paciente y DNI. Se revisa en pantalla y se genera el PDF.
          </div>
          <label style={S.label}>Jefa del Departamento (destinataria)</label>
          <input style={S.input} value={destinataria} onChange={(e) => setDestinataria(e.target.value)} />
          <button style={{ ...S.btn, marginTop: 14, width: "100%", fontSize: 15 }} onClick={() => setRevisando(true)}>
            👁️ GENERAR Y REVISAR EL PASE
          </button>
        </div>
      )}
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
  // Propone las prestaciones desde el detalle de servicios cargado para el mail
  const proponerItems = () => {
    const propuestos = extraerItemsDeTexto(exp.detalleServicios);
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
    ((variosModulos ? a.modulo : (exp.modulo || a.modulo)) || "").toUpperCase() +
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
    setPrevia({
      lista, adjs, forzados: {},
      textosAdjudicacion: adjs.filter((a) => a.proveedor).map(textoAdjudicacionDe),
      textoConstancia:
        "Se deja constancia que, habiendose solicitado cotizacion a " + lista.length +
        " proveedores del rubro, unicamente las firmas comerciales: " + cotizaron.concat(negativas).join("/") +
        " ; presentaron presupuestos dentro del plazo establecido. Los restantes proveedores convocados no remitieron cotizacion ni emitieron respuesta alguna al requerimiento efectuado a la fecha de adjudicacion.-",
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
              Poné un <b>módulo</b> solo si el expediente se puede adjudicar partido (por ejemplo internación a una firma y alimentación a otra).
              Si dejás la columna vacía en todos los ítems, el cuadro sale como siempre, con una sola firma adjudicada.
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
                          {[["item", "Por ítem"], ["modulo", "Por módulo"]].map(([v, t]) => (
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
                <input type="file" accept="application/pdf" style={{ marginTop: 4 }}
                  onChange={(e) => setArchivos({ ...archivos, [nombre]: e.target.files[0] })} />
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
  const [monto, setMonto] = useState(exp.nota?.monto ?? total);
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
            etapa: Math.max(exp.etapa, 5),
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
  const total = (exp.cuadro?.mensual || 0) * Number(exp.periodoMeses || 6);
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
    mensualA: r.mensualA || (sumar(itemsInternacion.length ? itemsInternacion : itemsAdjudicados) || ""),
    subB: r.subB || "322",
    firmaB: r.firmaB || firmaAli,
    tituloB: r.tituloB || "",
    detalleB: r.detalleB || detalleDeItems(itemsAlimentacion),
    mensualB: r.mensualB || (sumar(itemsAlimentacion) || ""),
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
            etapa: Math.max(exp.etapa, 6),
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
            etapa: Math.max(exp.etapa, 7),
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
        ...(todasEnviadas ? { etapa: 8 } : {}),
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
