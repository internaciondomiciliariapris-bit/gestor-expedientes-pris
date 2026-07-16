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
`Estimados: Desde la Gerencia Administrativa del Programa Integrado de Salud, se solicita presupuesto para la provisión de un Módulo: ${exp.modulo} Domiciliaria por el período de ${exp.periodoMeses} (${numeroEnLetrasSimple(exp.periodoMeses)}) meses, destinado al siguiente paciente:

• Paciente: ${exp.paciente.toUpperCase()}
• DNI: ${exp.dni}
• Expediente: ${exp.nroExpediente}
• Edad: ${exp.edad} años
• Fecha de Nacimiento: ${formatearFechaCorta(exp.fechaNacimiento)}
• Domicilio: ${exp.domicilio}
• Teléfono: ${exp.telefono}
• Receta y Síntesis de Historia Clínica: Se adjunta en archivo.

Diagnóstico: ${exp.diagnostico}

El módulo a cotizar, conforme a lo autorizado por el Departamento de Auditoría Médica, debe contemplar los siguientes servicios mensuales:

• ${exp.detalleServicios}

Condiciones obligatorias de la presentación:
Detalle de costos: El presupuesto (y la facturación posterior, de corresponder) debe estar detallado por provisión, indicando claramente el precio unitario y el precio total de cada ítem. Debe enviarse en formato PDF y contener CUIT, condición frente al IVA, nombre y apellido del paciente, y dirección y teléfono del proveedor. Caso contrario, se desestima el presupuesto por no ajustarse a normativas administrativas.

Plazo de respuesta: Se otorgará un tiempo máximo de 5 (cinco) días hábiles a partir de la recepción del presente correo.

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
async function llamarYDescargar(payload, descargarDoc = true) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ clave: APPS_SCRIPT_CLAVE, ...payload }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Error desconocido en Apps Script");
  if (data.pdfBase64) descargarBase64(data.pdfBase64, data.nombreArchivo + ".pdf", "application/pdf");
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

const envolverHtml = (css, body) =>
  '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
  "@page { size: A4; margin: 0; } body { margin:0; padding:0; } " +
  ".pagina { page-break-after: always; } .pagina.ultima { page-break-after: auto; } " +
  css + "</style></head><body>" + body + "</body></html>";

/* ---------- NOTA DE AFECTACIÓN (Times New Roman 12, formato del Word original) ---------- */

function plantillaNota(d, logos) {
  const letras = numeroALetras(d.monto);
  const lineaModulo = /^m[oó]dulo/i.test((d.modulo || "").trim()) ? esc(d.modulo) : "Modulo de " + esc(d.modulo);
  const impHtml = esc(d.imputacion)
    .replace(/Subp:\s*322/, "<b>$&</b>")
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
    esc(d.modulo) + " correspondiente al paciente<b>; " + esc(d.paciente) + " </b>la cual solicita:</p>" +
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

/* ---------- RESOLUCIÓN INTERNA (Times New Roman 12, 2 páginas) ---------- */

function plantillaResolucion(d, logos) {
  const letras = numeroALetras(d.total);
  const pac = esc(d.paciente).toUpperCase();
  const mod = esc(d.modulo);
  const adj = esc(d.adjudicado).toUpperCase();
  const per = esc(d.periodoTexto || d.periodoMeses + " meses");
  const monto = formatoPesos(d.total);
  const q = "margin:0; text-align:justify; text-indent:105pt; line-height:1.18;";
  const css =
    ".hoja { font-family:'Times New Roman', Times, serif; font-size:12pt; color:#000; } " +
    ".hoja .pagina { padding: 26pt 79pt 30pt 85pt; } .hoja p { margin:0; } .hoja td { font-size:12pt; }";

  const pag1 =
    '<div class="pagina">' + encabezadoDoc(logos) +
    '<p style="text-align:right; margin-top:10pt;">San Miguel de Tucumán, ' + esc(d.fechaTexto) + "</p>" +
    '<p style="text-align:center; font-weight:bold; margin-top:14pt;">Resolución Interna: Nº ' + esc(d.nroResolucion) + "</p>" +
    '<p style="text-align:center; font-weight:bold; margin-top:14pt;">PROGRAMA INTEGRADO DE SALUD</p>' +
    '<p style="font-weight:bold; text-decoration:underline; margin-top:4pt;">VISTO:</p>' +
    '<p style="text-align:justify; text-indent:52pt; line-height:1.18;">El <b>Expediente N° ' + esc(d.nroExpediente) +
    "</b>, en el que se solicita " + esc(d.tipoTramite) + " de servicios de " + mod +
    ", para el paciente; <b>" + pac + "</b> según lo indicado a fs. " + esc(d.fsSolicitud) + ". Y,</p>" +
    '<p style="font-weight:bold; text-decoration:underline; margin-top:14pt;">CONSIDERANDO:</p>' +
    '<p style="' + q + '">Que se solicita ' + esc(d.tipoTramite) + " de servicios de " + mod +
    ", para el paciente; <b>" + pac + "</b>; por el <b>periodo de " + per + "</b>.</p>" +
    '<p style="' + q + '">Que a fs. ' + esc(d.fsPresupuesto) + " se adjunta presupuesto del proveedor, correspondiente al <b>periodo de " +
    per + "</b> (" + esc(d.periodoMeses) + " meses). --------------------------------------</p>" +
    '<p style="' + q + '">Que a fs. ' + esc(d.fsCuadro) + " se adjunta Cuadro Comparativo, con la Adjudicación al Proveedor <b>" + adj +
    "</b>, correspondiente a los periodos de <b>" + per + "</b>.</p>" +
    '<p style="' + q + '">Que a fs. ' + esc(d.fsDictamen) + " se adjunta dictamen de auditoría médica, autorizando la prestación.</p>" +
    '<p style="' + q + '">Que obra informe jurídico favorable a la contratación. ---------------</p>' +
    '<p style="' + q + '">Que por lo expuesto, no existen objeciones legales que formular para que la Gerencia Administrativa Contable del Programa Integrado de Salud, en virtud de razones de urgencia invocadas, contrate con la firma <b>' +
    adj + "</b>, la adquisición del servicio de " + mod +
    ", bajo la figura de Contratación Directa de conformidad a lo normado por la Res. N°388/SPS/-05.</p>" +
    '<p style="text-align:center; font-weight:bold; margin-top:14pt;">POR ELLO:</p>' +
    '<p style="text-align:center; font-weight:bold;">LA GERENCIA ADMINISTRATIVA CONTABLE</p>' +
    '<p style="text-align:center; font-weight:bold;">DEL PROGRAMA INTEGRADO DE SALUD.</p>' +
    '<p style="text-align:center; font-weight:bold; text-decoration:underline;">RESUELVE:</p>' +
    '<p style="text-align:justify; line-height:1.18; margin-top:14pt;"><b>ARTICULO 1º)</b> ADJUDICAR a la firma <b>' + adj +
    "</b>, la provisión del siguiente servicio:</p>" +
    '<table style="width:100%; border-collapse:collapse; margin-top:8pt;"><tr>' +
    '<td style="border:1pt solid #000; padding:2pt 4pt; width:52%;">SERVICIO</td>' +
    '<td style="border:1pt solid #000; padding:2pt 4pt; width:22%;">PRECIO POR MES</td>' +
    '<td style="border:1pt solid #000; padding:2pt 4pt; width:26%;">PRECIO TOTAL POR ' + esc(d.periodoMeses) + " MESES</td>" +
    "</tr><tr>" +
    '<td style="border:1pt solid #000; padding:6pt 4pt 14pt;">' + mod + "</td>" +
    '<td style="border:1pt solid #000; padding:6pt 4pt 14pt; text-align:center; font-weight:bold;">' + formatoPesos(d.mensual) + "</td>" +
    '<td style="border:1pt solid #000; padding:6pt 4pt 14pt; text-align:center; font-weight:bold;">' + monto + "</td>" +
    "</tr></table></div>";

  const pag2 =
    '<div class="pagina ultima">' + encabezadoDoc(logos) +
    '<p style="text-align:justify; line-height:1.18; margin-top:12pt;">Por un monto total por ' + esc(d.periodoMeses) +
    " meses <b>" + monto + "</b> (" + letras + "). Dicho servicio comprenderá a partir de la fecha de la orden de compra, comprendiendo desde los Meses de <b>" + per + "</b>.</p>" +
    '<p style="text-align:justify; line-height:1.18; margin-top:14pt;"><b>ARTICULO 2º)</b> Imputar dicha suma <b>' + monto +
    "</b> (" + letras + ") a " + esc(d.imputacion) + ", con cargo al <b>Presupuesto del año " + esc(d.anioPresupuesto) + "</b>.</p>" +
    '<p style="text-align:justify; line-height:1.18; margin-top:14pt;"><b>ARTICULO 3°)</b> Pase a Control Pertinente del Honorable Tribunal de Cuentas en el Si.Pro.Sa.-</p>' +
    '<p style="text-align:justify; line-height:1.18; margin-top:14pt;"><b>ARTICULO 4º)</b> Emitir la orden de compra respectiva.</p>' +
    '<p style="text-align:justify; line-height:1.18; margin-top:20pt;"><b>ARTICULO 5°)</b> Comunicar y archivar.-</p>' +
    '<p style="font-weight:bold; line-height:1.75; margin-top:120pt; margin-left:5pt;">Firmado digitalmente:<br>' +
    esc(d.directora) + "<br>Directora. Gral. Prog. Integrado de Salud<br>SI.PRO.SA</p>" +
    lineaAzulDoc(12) +
    '<p style="font-size:10pt; line-height:1.2; text-align:justify;">' + PIE_ANIO + "</p></div>";

  return {
    titulo: "RESOLUCION " + String(d.nroResolucion || "").replace(/\//g, "-") + " EXPTE " +
      d.nroExpediente.replace(/\//g, "-") + " " + d.paciente.toUpperCase(),
    css, body: pag1 + pag2, montoLetras: letras,
  };
}

/* ---------- Datos por defecto de cada documento (para generar y para revisar de nuevo) ---------- */

const IMPUTACION_NOTA_DEFECTO =
  "Jur: 67, U.O: 965, Fin/Fun: 314, Proy: 00, Subp: 00, Progr: 19, A/OB: 01, Part. Ppal.: 300, Subp: 322 – Fuente de financiamiento Nº 10 – Recursos Tesoro General de la Provincia – Presupuesto " + new Date().getFullYear();
const IMPUTACION_RESOLUCION_DEFECTO =
  "Jurisdicción 67 - Unid. Org. 965 - Recurso 10 - Finalidad/Función 314 - Programa 19 - Actividad 01 - Partida 300 - Subpartida 322";

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
  fechaTexto: fechaLargaHoy(),
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
  return {
    nroExpediente: exp.nroExpediente, paciente: exp.paciente,
    modulo: exp.modulo, periodoTexto: exp.periodoTexto || "", periodoMeses: exp.periodoMeses,
    adjudicado: exp.cuadro?.adjudicado || "", mensual: exp.cuadro?.mensual || 0, total,
    nroResolucion: extra.nroResolucion ?? r.nro ?? "",
    tipoTramite: extra.tipoTramite ?? r.tipoTramite ?? "inicio",
    fsSolicitud: extra.fsSolicitud ?? r.fojas?.solicitud ?? "",
    fsPresupuesto: extra.fsPresupuesto ?? r.fojas?.presupuesto ?? "",
    fsCuadro: extra.fsCuadro ?? r.fojas?.cuadro ?? "",
    fsDictamen: extra.fsDictamen ?? r.fojas?.dictamen ?? "",
    directora: extra.directora ?? r.directora ?? "Dra. Noelia Soledad Bottone",
    imputacion: extra.imputacion ?? r.imputacion ?? IMPUTACION_RESOLUCION_DEFECTO,
    anioPresupuesto: extra.anio ?? r.anio ?? String(new Date().getFullYear()),
    fechaTexto: fechaLargaHoy(),
  };
};

const payloadCuadro = (exp) => {
  const consultados = (exp.cotizacion?.proveedores || "").split(",").map((s) => s.trim()).filter(Boolean);
  const guardados = exp.presupuestos || {};
  const c = exp.cuadro || {};
  return {
    accion: "generarCuadro",
    nroExpediente: exp.nroExpediente, paciente: exp.paciente,
    modulo: exp.modulo, detalleServicios: exp.detalleServicios,
    periodoTexto: exp.periodoTexto, periodoMeses: exp.periodoMeses,
    cantTexto: c.cantTexto || "", cantNum: c.cantNum || "",
    textoAdjudicacion: c.textoAdjudicacion || "", textoConstancia: c.textoConstancia || "",
    proveedores: consultados.map((n) => ({
      nombre: n,
      estado: guardados[n]?.estado || "sin_respuesta",
      unitario: guardados[n]?.unitario || null,
      mensual: guardados[n]?.mensual || null,
    })),
    adjudicado: { nombre: c.adjudicado, unitario: c.unitario, mensual: c.mensual, total: c.total },
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

      {/* semáforo de etapas */}
      <div style={{ ...S.card, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {ETAPAS.map((nombre, i) => (
          <span key={i} style={S.chip(i === exp.etapa, i < exp.etapa)}>
            {i < exp.etapa ? "✓ " : ""}{nombre}
          </span>
        ))}
      </div>

      <PaseAuditoria exp={exp} />

      {exp.etapa === 0 && <EnvioCotizacion exp={exp} proveedores={proveedores} />}
      {exp.etapa >= 1 && exp.cotizacion && (
        <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
          <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Cotización enviada</div>
          <div style={{ fontSize: 14, color: "#334155" }}>
            <b>Fecha de envío:</b> {formatearFecha(exp.cotizacion.fecha)}{exp.cotizacion.manual && <span style={{ color: "#64748b" }}> (registrado manualmente — el mail salió por fuera del sistema)</span>}<br />
            {exp.cotizacion.firmante && (<><b>Enviado por:</b> {exp.cotizacion.firmante}<br /></>)}
            <b>Proveedores consultados:</b> {exp.cotizacion.proveedores}<br />
            <b>Plazo:</b>{" "}
            {(() => {
              const d = diasHabilesDesde(exp.cotizacion.fecha);
              return d > 5
                ? <span style={{ color: "#dc2626", fontWeight: 700 }}>⚠️ Vencido — pasaron {d} días hábiles</span>
                : <span style={{ color: "#f59e0b", fontWeight: 700 }}>Día hábil {d} de 5</span>;
            })()}
            {exp.cotizacion.carpetaUrl && (
              <><br /><a href={exp.cotizacion.carpetaUrl} target="_blank" rel="noreferrer" style={{ color: "#0891b2", fontWeight: 700 }}>📁 Ver carpeta del expediente en Drive</a></>
            )}
          </div>
        </div>
      )}
      {exp.etapa === 1 && <RegistroPresupuestos exp={exp} />}

      {exp.etapa >= 3 && exp.cuadro && (
        <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
          <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Cuadro comparativo generado — Adjudicado: {exp.cuadro.adjudicado}</div>
          <div style={{ fontSize: 14, color: "#334155" }}>
            <b>Fecha de adjudicación:</b> {formatearFecha(exp.cuadro.fecha)}<br />
            <b>Precio mensual:</b> {formatoPesos(exp.cuadro.mensual)} · <b>Total {exp.periodoMeses} meses:</b> {formatoPesos(exp.cuadro.total)}
          </div>
          <BotonRedescargar construirPayload={() => payloadCuadro(exp)} />
        </div>
      )}

      {exp.etapa === 3 && <GenerarNota exp={exp} />}

      {exp.etapa >= 4 && exp.nota && (
        <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
          <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Nota de afectación presupuestaria generada</div>
          <div style={{ fontSize: 14, color: "#334155" }}>
            <b>Importe total:</b> {formatoPesos(exp.nota.monto)} ({exp.nota.montoLetras})
          </div>
          <BotonRevisar construirPlantilla={(logos) => plantillaNota(datosNota(exp), logos)} />
        </div>
      )}

      {/* ============ FASE 3 ============ */}

      {exp.etapa >= 5 && exp.paseLetrada && (
        <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
          <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Pase a Asesoría Letrada generado</div>
          <div style={{ fontSize: 14, color: "#334155" }}>
            <b>Fecha:</b> {formatearFecha(exp.paseLetrada.fecha)}
          </div>
          <BotonRevisar construirPlantilla={(logos) => plantillaPase(datosPaseLetrada(exp), logos)} />
        </div>
      )}
      {exp.etapa === 4 && <PaseLetrada exp={exp} />}

      {exp.etapa >= 6 && exp.resolucion && (
        <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
          <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Resolución Interna Nº {exp.resolucion.nro} generada</div>
          <div style={{ fontSize: 14, color: "#334155" }}>
            <b>Fecha:</b> {formatearFecha(exp.resolucion.fecha)}<br />
            <b>Adjudicado:</b> {exp.resolucion.adjudicado} · <b>Monto total:</b> {formatoPesos(exp.resolucion.total)}
          </div>
          <BotonRevisar construirPlantilla={(logos) => plantillaResolucion(datosResolucion(exp), logos)} />
        </div>
      )}
      {exp.etapa === 5 && <GenerarResolucion exp={exp} />}

      {exp.etapa >= 7 && exp.paseTribunal && (
        <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
          <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Pase al Tribunal de Cuentas generado</div>
          <div style={{ fontSize: 14, color: "#334155" }}>
            <b>Fecha:</b> {formatearFecha(exp.paseTribunal.fecha)}
          </div>
          <BotonRevisar construirPlantilla={(logos) => plantillaPase(datosPaseTribunal(exp), logos)} />
        </div>
      )}
      {exp.etapa === 6 && <PaseTribunal exp={exp} />}

      {exp.etapa >= 8 && exp.oc && (
        <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
          <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Orden de Compra Nº {exp.oc.nro} enviada al adjudicado</div>
          <div style={{ fontSize: 14, color: "#334155" }}>
            <b>Fecha de envío:</b> {formatearFecha(exp.oc.fecha)}<br />
            {exp.oc.firmante && (<><b>Enviado por:</b> {exp.oc.firmante}<br /></>)}
            <b>Destinatarios:</b> {exp.oc.destinatarios}<br />
            {exp.oc.pdfUrl && <a href={exp.oc.pdfUrl} target="_blank" rel="noreferrer" style={{ color: "#0891b2", fontWeight: 700 }}>📄 Orden de compra en el Drive</a>}
          </div>
        </div>
      )}
      {exp.etapa === 7 && <OrdenCompraEnvio exp={exp} proveedores={proveedores} />}

      {exp.etapa >= 8 && (
        <div style={{ ...S.card, background: "#f0fdf4", border: "2px solid #16a34a", textAlign: "center" }}>
          <div style={{ fontSize: 22 }}>🎉</div>
          <div style={{ fontWeight: 800, color: "#166534", fontSize: 16 }}>Expediente completo</div>
          <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
            Las 8 etapas del circuito están cerradas. Cuando se acerque el fin del período, usá <b>🔄 Renovar período</b> para arrancar el trámite nuevo con los datos ya cargados.
          </div>
        </div>
      )}

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
        html: envolverHtml(plantilla.css, '<div class="hoja">' + body + "</div>"),
      };
      if (conWord) payload.htmlWord = envolverHtml(plantilla.css, '<div class="hoja">' + logosAUrl(body) + "</div>");
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
      <style>{plantilla.css + " .hoja .pagina { background:#fff; box-shadow:0 1px 6px rgba(0,0,0,0.3); margin:0 auto 14px; width:794px; min-height:1122px; box-sizing:border-box; }"}</style>
      <div style={{ overflowX: "auto", background: "#cbd5e1", padding: 12, borderRadius: 8 }}>
        <div
          className="hoja"
          ref={hojaRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          style={{ outline: "none", minWidth: 794 }}
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
          expData: {
            dni: exp.dni,
            edad: exp.edad,
            fechaNacimiento: formatearFechaCorta(exp.fechaNacimiento),
            domicilio: exp.domicilio,
            telefono: exp.telefono,
            diagnostico: exp.diagnostico,
            modulo: exp.modulo,
            detalleServicios: exp.detalleServicios,
            periodoMeses: exp.periodoMeses,
            periodoLetras: numeroEnLetrasSimple(Number(exp.periodoMeses)),
          },
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

      <label style={S.label}>Cuerpo del mail (podés editar los textos; las negritas, viñetas y centrados del formato oficial se aplican automáticamente al enviar)</label>
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
  const [datos, setDatos] = useState(() => {
    const d = {};
    consultados.forEach((n) => {
      d[n] = guardados[n] || { estado: "", unitario: "", mensual: "", pdfNombre: "" };
    });
    return d;
  });
  const [archivos, setArchivos] = useState({});
  const [ocupado, setOcupado] = useState(false);
  const [cantTexto, setCantTexto] = useState(exp.cuadro?.cantTexto || "31 dias");
  const [cantNum, setCantNum] = useState(exp.cuadro?.cantNum || "31");

  const setProv = (nombre, campo, valor) =>
    setDatos({ ...datos, [nombre]: { ...datos[nombre], [campo]: valor } });

  const guardarProveedor = async (nombre) => {
    const d = datos[nombre];
    if (!d.estado) { alert("Marcá el estado del presupuesto de " + nombre); return; }
    if (d.estado === "cotizo" && (!d.unitario || !d.mensual)) {
      alert("Cargá el precio unitario y el precio mensual de " + nombre); return;
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
            proveedor: nombre,
            adjunto: { nombre: archivo.name, mimeType: archivo.type || "application/pdf", base64 },
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Error al subir el PDF");
        pdfNombre = archivo.name;
      }
      const registro = {
        estado: d.estado,
        unitario: d.estado === "cotizo" ? Number(d.unitario) : null,
        mensual: d.estado === "cotizo" ? Number(d.mensual) : null,
        pdfNombre,
        fecha: new Date().toISOString(),
      };
      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), { ["presupuestos." + nombre]: registro });
      setDatos({ ...datos, [nombre]: { ...d, pdfNombre } });
      alert("✅ Guardado: " + nombre);
    } catch (e) {
      alert("❌ Error: " + e.message);
    }
    setOcupado(false);
  };

  const cotizantes = consultados.filter((n) => (guardados[n]?.estado) === "cotizo");
  const pendientes = consultados.filter((n) => !guardados[n]?.estado);

  const [previa, setPrevia] = useState(null);

  const abrirPrevia = () => {
    if (cotizantes.length === 0) { alert("Todavía no hay ningún proveedor con presupuesto cargado (Cotizó)."); return; }
    if (pendientes.length > 0 && !confirm(`Hay proveedores sin marcar: ${pendientes.join(", ")}.\n\nSi seguís, quedarán registrados como SIN RESPUESTA. ¿Continuar?`)) return;

    // ganador: menor precio mensual entre los que cotizaron
    let ganador = null;
    cotizantes.forEach((n) => {
      const p = guardados[n];
      if (!ganador || p.mensual < guardados[ganador].mensual) ganador = n;
    });
    const g = guardados[ganador];
    const total = g.mensual * Number(exp.periodoMeses || 6);
    const lista = consultados.map((n) => ({
      nombre: n,
      estado: guardados[n]?.estado || "sin_respuesta",
      unitario: guardados[n]?.unitario || null,
      mensual: guardados[n]?.mensual || null,
    }));
    const cotizaron = lista.filter((p) => p.estado === "cotizo").map((p) => p.nombre.toUpperCase());
    const negativas = lista.filter((p) => p.estado === "desestimo").map((p) => p.nombre.toUpperCase() + " (NEGATIVA)");
    setPrevia({
      ganador, g, total, lista,
      textoAdjudicacion:
        "CONFORME A LO DETALLADO EN EL CUADRO COMPARATIVO , SE ADJUDICA SERVICIO DE " +
        (exp.modulo || "").toUpperCase() + " A LA FIRMA : " + ganador.toUpperCase(),
      textoConstancia:
        "Se deja constancia que, habiendose solicitado cotizacion a " + lista.length +
        " proveedores del rubro, unicamente las firmas comerciales: " + cotizaron.concat(negativas).join("/") +
        " ; presentaron presupuestos dentro del plazo establecido. Los restantes proveedores convocados no remitieron cotizacion ni emitieron respuesta alguna al requerimiento efectuado a la fecha de adjudicacion.-",
    });
  };

  const confirmarCuadro = async (conExcel) => {
    setOcupado(true);
    try {
      await llamarYDescargar({
        accion: "generarCuadro",
        nroExpediente: exp.nroExpediente, paciente: exp.paciente,
        modulo: exp.modulo, detalleServicios: exp.detalleServicios,
        periodoTexto: exp.periodoTexto, periodoMeses: exp.periodoMeses,
        cantTexto, cantNum,
        textoAdjudicacion: previa.textoAdjudicacion, textoConstancia: previa.textoConstancia,
        proveedores: previa.lista,
        adjudicado: { nombre: previa.ganador, unitario: previa.g.unitario, mensual: previa.g.mensual, total: previa.total },
      }, conExcel);
      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
        etapa: 3,
        cuadro: {
          fecha: new Date().toISOString(),
          adjudicado: previa.ganador,
          unitario: previa.g.unitario, mensual: previa.g.mensual, total: previa.total,
          cantTexto, cantNum,
          textoAdjudicacion: previa.textoAdjudicacion, textoConstancia: previa.textoConstancia,
        },
      });
      alert("✅ Cuadro comparativo generado. Adjudicado: " + previa.ganador +
        "\n\nSe descargó el PDF apaisado (para el SIGEDIG)" + (conExcel ? " y el Excel editable." : "."));
      setPrevia(null);
    } catch (e) {
      alert("❌ Error al generar el cuadro: " + e.message);
    }
    setOcupado(false);
  };

  if (previa) {
    return (
      <div style={{ ...S.card, borderLeft: "5px solid #0891b2", background: "#f8fafc" }}>
        <div style={{ fontWeight: 800, color: "#075e75", marginBottom: 4 }}>👁️ Revisión del cuadro comparativo</div>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>
          Revisá los precios de la tabla y corregí los textos si hace falta. Cuando esté bien, generá el PDF (apaisado, formato Excel oficial).
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, background: "#fff" }}>
            <thead>
              <tr>
                <th style={{ border: "1px solid #334155", padding: 6, background: "#F2F2F2" }}>DETALLE SOLICITADO</th>
                {previa.lista.filter((p) => p.estado !== "sin_respuesta").map((p, i) => (
                  <th key={p.nombre} colSpan={2} style={{ border: "1px solid #334155", padding: 6, background: i % 2 ? "#E7E6E6" : "#F2F2F2" }}>{p.nombre.toUpperCase()}</th>
                ))}
              </tr>
              <tr>
                <th style={{ border: "1px solid #334155", padding: 6 }}>PRESTACION ({cantTexto || "-"} / {cantNum || "-"})</th>
                {previa.lista.filter((p) => p.estado !== "sin_respuesta").map((p) => (
                  <Fragment key={p.nombre}>
                    <th style={{ border: "1px solid #334155", padding: 6 }}>P. UNITARIO</th>
                    <th style={{ border: "1px solid #334155", padding: 6 }}>P. MENSUAL</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ border: "1px solid #334155", padding: 6 }}>{exp.modulo}</td>
                {previa.lista.filter((p) => p.estado !== "sin_respuesta").map((p) => (
                  <Fragment key={p.nombre}>
                    <td style={{ border: "1px solid #334155", padding: 6, textAlign: "center", fontWeight: 700 }}>
                      {p.estado === "cotizo" ? formatoPesos(p.unitario) : "NO COTIZA"}
                    </td>
                    <td style={{ border: "1px solid #334155", padding: 6, textAlign: "center", fontWeight: 700 }}>
                      {p.estado === "cotizo" ? formatoPesos(p.mensual) : ""}
                    </td>
                  </Fragment>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <label style={S.label}>Texto de adjudicación (recuadro gris del cuadro)</label>
        <textarea style={{ ...S.input, minHeight: 60 }} value={previa.textoAdjudicacion}
          onChange={(e) => setPrevia({ ...previa, textoAdjudicacion: e.target.value })} />

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
        A medida que respondan al mail, cargá acá cada proveedor: estado, precios y el PDF del presupuesto (queda guardado en el Drive del expediente). Cuando estén todos, generá el cuadro comparativo: se descarga a tu máquina en Excel (editable) y PDF apaisado (para el SIGEDIG), calcado del formato real.
      </div>

      {consultados.map((nombre) => {
        const d = datos[nombre] || {};
        const g = guardados[nombre];
        return (
          <div key={nombre} style={{
            border: "1.5px solid " + (g?.estado ? "#86efac" : "#e2e8f0"),
            borderRadius: 10, padding: 12, marginTop: 12,
            background: g?.estado ? "#f0fdf4" : "#fff",
          }}>
            <div style={{ fontWeight: 800, color: "#075e75", marginBottom: 6 }}>
              {nombre} {g?.estado === "cotizo" && `✅ Cotizó: ${formatoPesos(g.mensual)}/mes`}
              {g?.estado === "desestimo" && "🚫 Desestimó"}
              {g?.estado === "sin_respuesta" && "⏳ Sin respuesta"}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {[["cotizo", "💰 Cotizó"], ["desestimo", "🚫 Desestimó"], ["sin_respuesta", "⏳ No respondió"]].map(([v, label]) => (
                <label key={v} style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "6px 10px",
                  borderRadius: 8, border: "1.5px solid " + (d.estado === v ? "#0891b2" : "#cbd5e1"),
                  background: d.estado === v ? "#e0f2fe" : "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600,
                }}>
                  <input type="radio" name={"estado-" + nombre} checked={d.estado === v} onChange={() => setProv(nombre, "estado", v)} />
                  {label}
                </label>
              ))}
            </div>
            {d.estado === "cotizo" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
                <div>
                  <label style={{ ...S.label, marginTop: 4 }}>Precio unitario ($)</label>
                  <input type="number" style={S.input} value={d.unitario} onChange={(e) => setProv(nombre, "unitario", e.target.value)} placeholder="12250" />
                </div>
                <div>
                  <label style={{ ...S.label, marginTop: 4 }}>Precio mensual ($)</label>
                  <input type="number" style={S.input} value={d.mensual} onChange={(e) => setProv(nombre, "mensual", e.target.value)} placeholder="367500" />
                </div>
              </div>
            )}
            {(d.estado === "cotizo" || d.estado === "desestimo") && (
              <div style={{ marginTop: 8 }}>
                <label style={{ ...S.label, marginTop: 0 }}>
                  {d.estado === "cotizo" ? "PDF del presupuesto" : "PDF de la negativa (constancia de que no cotiza)"}
                  {d.pdfNombre && ` — guardado: ${d.pdfNombre}`}
                </label>
                <input type="file" accept="application/pdf" style={{ marginTop: 4 }}
                  onChange={(e) => setArchivos({ ...archivos, [nombre]: e.target.files[0] })} />
              </div>
            )}
            {d.estado && (
              <button style={{ ...S.btnSec, marginTop: 10 }} disabled={ocupado} onClick={() => guardarProveedor(nombre)}>
                💾 Guardar {nombre}
              </button>
            )}
          </div>
        );
      })}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 10, marginTop: 14 }}>
        <div>
          <label style={{ ...S.label, marginTop: 0 }}>Cantidad (columna "PRESTACION" del cuadro — ej: 31 dias, 15 set, 12 hs diarias)</label>
          <input style={S.input} value={cantTexto} onChange={(e) => setCantTexto(e.target.value)} placeholder="31 dias" />
        </div>
        <div>
          <label style={{ ...S.label, marginTop: 0 }}>Cant. de hs/ses.</label>
          <input style={S.input} value={cantNum} onChange={(e) => setCantNum(e.target.value)} placeholder="31" />
        </div>
      </div>

      <button style={{ ...S.btn, marginTop: 14, width: "100%", fontSize: 16, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={abrirPrevia}>
        {ocupado ? "⏳ Procesando..." : "👁️ GENERAR Y REVISAR EL CUADRO (adjudica al menor precio)"}
      </button>
    </div>
  );
}

/* ---------- Nota de afectación presupuestaria (Fase 2) ---------- */

function GenerarNota({ exp }) {
  const total = (exp.cuadro?.mensual || 0) * Number(exp.periodoMeses || 6);
  const [monto, setMonto] = useState(exp.nota?.monto ?? total);
  const [directora, setDirectora] = useState(exp.nota?.directora || "Dra. Noellia Bottone");
  const [imputacion, setImputacion] = useState(exp.nota?.imputacion || IMPUTACION_NOTA_DEFECTO);
  const [revisando, setRevisando] = useState(false);

  if (revisando) {
    return (
      <VistaPrevia
        construirPlantilla={(logos) => plantillaNota(datosNota(exp, { monto: Number(monto), directora, imputacion }), logos)}
        onCerrar={() => setRevisando(false)}
        onListo={async (data) => {
          await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
            etapa: Math.max(exp.etapa, 4),
            nota: {
              fecha: new Date().toISOString(),
              monto: Number(monto), montoLetras: data.montoLetras || "",
              directora, imputacion,
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

      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 10 }}>
        <div>
          <label style={S.label}>Importe total ({exp.periodoMeses} meses)</label>
          <input style={S.input} type="number" value={monto} onChange={(e) => setMonto(e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Directora del Programa</label>
          <input style={S.input} value={directora} onChange={(e) => setDirectora(e.target.value)} />
        </div>
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
  const [f, setF] = useState({
    nroResolucion: "",
    tipoTramite: "inicio",
    fsSolicitud: "02,04",
    fsPresupuesto: "",
    fsCuadro: "",
    fsDictamen: "",
    directora: "Dra. Noelia Soledad Bottone",
    anio: String(new Date().getFullYear()),
    imputacion: exp.resolucion?.imputacion || IMPUTACION_RESOLUCION_DEFECTO,
  });
  const [revisando, setRevisando] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  if (revisando) {
    return (
      <VistaPrevia
        construirPlantilla={(logos) => plantillaResolucion(datosResolucion(exp, {
          total, nroResolucion: f.nroResolucion, tipoTramite: f.tipoTramite,
          fsSolicitud: f.fsSolicitud, fsPresupuesto: f.fsPresupuesto,
          fsCuadro: f.fsCuadro, fsDictamen: f.fsDictamen,
          directora: f.directora, imputacion: f.imputacion, anio: f.anio,
        }), logos)}
        onCerrar={() => setRevisando(false)}
        onListo={async (data) => {
          await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
            etapa: Math.max(exp.etapa, 6),
            resolucion: {
              fecha: new Date().toISOString(),
              nro: f.nroResolucion, tipoTramite: f.tipoTramite,
              adjudicado: exp.cuadro?.adjudicado || "", total,
              montoLetras: data.montoLetras || "",
              fojas: { solicitud: f.fsSolicitud, presupuesto: f.fsPresupuesto, cuadro: f.fsCuadro, dictamen: f.fsDictamen },
              directora: f.directora, imputacion: f.imputacion, anio: f.anio,
            },
          });
        }}
      />
    );
  }

  const generar = () => {
    if (!f.nroResolucion) { alert("Cargá el N° de la resolución (ej: 3123/DGPRIS)."); return; }
    if (!f.fsPresupuesto || !f.fsCuadro || !f.fsDictamen) {
      if (!confirm("Faltan números de fojas (presupuesto, cuadro o dictamen). El documento va a salir con esos espacios vacíos — igual podés completarlos a mano en la vista previa. ¿Continuar?")) return;
    }
    setRevisando(true);
  };

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #f59e0b" }}>
      <h3 style={{ color: "#075e75", marginBottom: 4 }}>📜 Resolución Interna de contratación</h3>
      <div style={{ fontSize: 13, color: "#64748b" }}>
        El monto, las letras, el adjudicado y el período salen solos del expediente y se replican en todos los artículos. Vos cargás el N° y las fojas, la revisás en pantalla, corregís lo que haga falta y generás el PDF.
      </div>

      <div style={{ background: "#e0f2fe", borderRadius: 8, padding: 10, marginTop: 12, fontSize: 14, color: "#075e75", fontWeight: 700 }}>
        Adjudicado: {exp.cuadro?.adjudicado} · {formatoPesos(exp.cuadro?.mensual)}/mes · Total {exp.periodoMeses} meses: {formatoPesos(total)}
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

      <label style={S.label}>Tipo de trámite (así aparece en el texto: "se solicita ___ de servicios")</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {["inicio", "ampliación", "renovación"].map((t) => (
          <label key={t} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
            borderRadius: 8, border: "1.5px solid " + (f.tipoTramite === t ? "#0891b2" : "#cbd5e1"),
            background: f.tipoTramite === t ? "#e0f2fe" : "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600,
          }}>
            <input type="radio" name="tipoTramite" checked={f.tipoTramite === t} onChange={() => setF({ ...f, tipoTramite: t })} />
            {t}
          </label>
        ))}
      </div>

      <label style={{ ...S.label, marginTop: 16 }}>📑 Fojas del expediente (miralas en el expediente físico / SIGEDIG)</label>
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

      <label style={S.label}>Firma (Directora del Programa)</label>
      <input style={S.input} value={f.directora} onChange={set("directora")} />

      <label style={S.label}>Imputación presupuestaria (Artículo 2º)</label>
      <textarea style={{ ...S.input, minHeight: 70 }} value={f.imputacion} onChange={set("imputacion")} />

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

function generarCuerpoAdjudicacion(exp, nroOC, firmante) {
  return (
`Estimados:

INICIO DE PRESTACIÓN expte ${exp.nroExpediente} ${exp.paciente.toUpperCase()}. ${(exp.modulo || "").toUpperCase()}. En la que se Adjudica a uds como Proveedores de la Prestación de Servicios.

Se solicita se nos informe vía mail:

• RECEPCIÓN DEL MAIL.
• FECHA DE INICIO EN LA QUE SE BRINDARÁ LA PRESTACIÓN.

ENVÍO Nº DE ORDEN ${nroOC || "____"}.-

--
Confirmar Recepción
Atte. ${firmante}

Internaciones Domiciliarias.
Oficina de Compras y Contrataciones.
Gerencia Administrativa.`
  );
}

function OrdenCompraEnvio({ exp, proveedores }) {
  const adjudicado = exp.cuadro?.adjudicado || "";
  const provAdj = proveedores.find((p) => p.nombre === adjudicado);
  const firmaInicial = (USUARIOS.find((u) => u.id === exp.responsable)?.firma) || FIRMANTES[0];

  const [nroOC, setNroOC] = useState("");
  const [destinatarios, setDestinatarios] = useState(provAdj?.emails || "");
  const [firmante, setFirmante] = useState(firmaInicial);
  const [asunto, setAsunto] = useState(
    `ENVIO ORDEN DE COMPRA ${(exp.modulo || "").toUpperCase()} ${exp.paciente.toUpperCase()}`
  );
  const [cuerpo, setCuerpo] = useState(generarCuerpoAdjudicacion(exp, "", firmaInicial));
  const [archivo, setArchivo] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const cambiarFirmante = (nuevo) => {
    setFirmante(nuevo);
    setCuerpo(generarCuerpoAdjudicacion(exp, nroOC, nuevo));
  };
  const cambiarNroOC = (v) => {
    setNroOC(v);
    setCuerpo(generarCuerpoAdjudicacion(exp, v, firmante));
  };

  const enviar = async () => {
    if (!nroOC) { alert("Cargá el N° de la orden de compra."); return; }
    if (!archivo) { alert("Adjuntá el PDF de la orden de compra (la que hiciste en el sistema del SIPROSA)."); return; }
    const listaDest = destinatarios.split(",").map((e) => e.trim()).filter(Boolean);
    if (listaDest.length === 0) { alert("Cargá al menos un correo de destino."); return; }
    if (!confirm(`Se enviará el mail de adjudicación con la OC Nº ${nroOC} adjunta a:\n\n${listaDest.map((d) => "• " + d).join("\n")}\n\n¿Confirmás el envío?`)) return;

    setEnviando(true);
    try {
      const base64 = await leerArchivoBase64(archivo);
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({
          accion: "enviarAdjudicacion", clave: APPS_SCRIPT_CLAVE,
          nroExpediente: exp.nroExpediente, paciente: exp.paciente,
          modulo: exp.modulo, nroOC, firmante,
          asunto, cuerpo, destinatarios: listaDest,
          adjunto: { nombre: archivo.name, mimeType: archivo.type || "application/pdf", base64 },
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Error en Apps Script");

      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
        etapa: 8,
        oc: {
          fecha: new Date().toISOString(),
          nro: nroOC, firmante,
          destinatarios: listaDest.join(", "),
          pdfUrl: data.ocPdfUrl || "",
        },
      });
      alert("✅ Mail de adjudicación enviado con la OC Nº " + nroOC + ". ¡Expediente completo! 🎉");
    } catch (e) {
      alert("❌ Error al enviar: " + e.message);
    }
    setEnviando(false);
  };

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #f59e0b" }}>
      <h3 style={{ color: "#075e75", marginBottom: 4 }}>🧾 Orden de compra y mail al adjudicado</h3>
      <div style={{ fontSize: 13, color: "#64748b" }}>
        La OC la emitís en el sistema del SIPROSA como siempre. Acá la subís en PDF, cargás el número, y el sistema se la manda a <b>{adjudicado || "el proveedor adjudicado"}</b> con el texto oficial, tu firma y los logos. La OC queda guardada también en el Drive del expediente.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10 }}>
        <div>
          <label style={S.label}>N° de orden de compra</label>
          <input style={S.input} value={nroOC} onChange={(e) => cambiarNroOC(e.target.value)} placeholder="18344" />
        </div>
        <div>
          <label style={S.label}>Correo(s) del adjudicado — separados por coma</label>
          <input style={S.input} value={destinatarios} onChange={(e) => setDestinatarios(e.target.value)} placeholder="correo@proveedor.com.ar" />
        </div>
      </div>

      <label style={S.label}>PDF de la orden de compra (obligatorio — va adjunto al mail)</label>
      <input type="file" accept="application/pdf" style={{ marginTop: 6 }} onChange={(e) => setArchivo(e.target.files[0])} />
      {archivo && <div style={{ fontSize: 13, color: "#334155", marginTop: 6 }}>📎 {archivo.name} ({(archivo.size / 1024 / 1024).toFixed(1)} MB)</div>}

      <label style={S.label}>¿Quién envía este mail? (la firma sale en el mail)</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {FIRMANTES.map((fi) => (
          <label key={fi} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
            borderRadius: 8, border: "1.5px solid " + (firmante === fi ? "#0891b2" : "#cbd5e1"),
            background: firmante === fi ? "#e0f2fe" : "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600,
          }}>
            <input type="radio" name="firmante-oc" checked={firmante === fi} onChange={() => cambiarFirmante(fi)} />
            {fi}
          </label>
        ))}
      </div>

      <label style={S.label}>Asunto</label>
      <input style={S.input} value={asunto} onChange={(e) => setAsunto(e.target.value)} />

      <label style={S.label}>Cuerpo del mail (podés editar los textos; las negritas y el formato oficial se aplican automáticamente al enviar)</label>
      <textarea style={{ ...S.input, minHeight: 220, fontFamily: "inherit", fontSize: 14 }} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} />

      <button style={{ ...S.btn, marginTop: 18, width: "100%", fontSize: 16, opacity: enviando ? 0.6 : 1 }} disabled={enviando} onClick={enviar}>
        {enviando ? "⏳ Enviando mail y guardando en Drive..." : "📨 ENVIAR ORDEN DE COMPRA AL ADJUDICADO"}
      </button>
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
