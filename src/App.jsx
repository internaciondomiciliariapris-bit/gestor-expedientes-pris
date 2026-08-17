import React, { useState, useEffect, useMemo, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore, collection, doc, onSnapshot, setDoc, updateDoc,
  deleteDoc, writeBatch, query, getDocs
} from "firebase/firestore";

/* ============================================================
   CONSTANTES CRITICAS - NO MODIFICAR
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyCDFcb5B7swNnetMOxXhVNQWaDxa1LVRF4",
  authDomain: "visitas-siprosa.firebaseapp.com",
  projectId: "visitas-siprosa",
  storageBucket: "visitas-siprosa.firebasestorage.app",
  messagingSenderId: "957519453967",
  appId: "1:957519453967:web:e6c2bfac7a4da10fed287a"
};
const ADMIN_PASSWORD = "gerenciapris626";

const COL_PACIENTES = "fact_pacientes";
const COL_EXPEDIENTES = "fact_expedientes";
const COL_FACTURAS = "fact_facturas";
const COL_TRANSFERENCIAS = "fact_transferencias";

/* ============================================================
   CATALOGOS
   ============================================================ */
const USUARIOS = ["JORGE", "YAMILA", "JULIETA", "PAULA"];

const PIPELINE = [
  "SIN FACTURA",
  "RECIBIDA",
  "AUDITORIA",
  "ASESORIA LETRADA",
  "PARA FIRMA",
  "TRIBUNAL",
  "TESORERIA"
];
const ESPECIALES = [
  "OBSERVADA AUDITORIA",
  "OBSERVADA TRIBUNAL",
  "SIN SERVICIO",
  "FALLECIDO",
  "REFACTURACION",
  "SIN DEFINIR"
];
const TODOS_ESTADOS = [...PIPELINE, ...ESPECIALES];

// Etiquetas lindas para mostrar
const ETIQUETA_ESTADO = {
  "SIN FACTURA": "Sin factura",
  "RECIBIDA": "Recibida",
  "AUDITORIA": "Auditoría médica",
  "OBSERVADA AUDITORIA": "Observada (auditoría)",
  "ASESORIA LETRADA": "Asesoría letrada",
  "PARA FIRMA": "Resolución para firma",
  "TRIBUNAL": "Tribunal de cuentas",
  "OBSERVADA TRIBUNAL": "Observada (tribunal)",
  "TESORERIA": "Tesorería",
  "SIN SERVICIO": "Sin servicio",
  "FALLECIDO": "Fallecido",
  "REFACTURACION": "Refacturación",
  "SIN DEFINIR": "Sin definir"
};

// Avance del circuito. Las observadas vuelven al organismo que las observó.
const SIGUIENTE = {
  "SIN FACTURA": "RECIBIDA",
  "RECIBIDA": "AUDITORIA",
  "AUDITORIA": "ASESORIA LETRADA",
  "OBSERVADA AUDITORIA": "AUDITORIA",
  "ASESORIA LETRADA": "PARA FIRMA",
  "PARA FIRMA": "TRIBUNAL",
  "TRIBUNAL": "TESORERIA",
  "OBSERVADA TRIBUNAL": "TRIBUNAL",
  "TESORERIA": null
};

// Convierte estados viejos (de datos ya cargados) a los nuevos
const MAPA_ESTADO_VIEJO = {
  "FACTURA RECIBIDA": "RECIBIDA",
  "EN HTC": "TRIBUNAL",
  "APROBADO POR HTC": "TRIBUNAL",
  "OBSERVADO POR HTC": "OBSERVADA TRIBUNAL"
};
const normEstado = (e) => MAPA_ESTADO_VIEJO[e] || e || "SIN FACTURA";

const COLOR_ESTADO = {
  "SIN FACTURA": "#fee2e2",
  "RECIBIDA": "#fef3c7",
  "AUDITORIA": "#fed7aa",
  "OBSERVADA AUDITORIA": "#fdba74",
  "ASESORIA LETRADA": "#e9d5ff",
  "PARA FIRMA": "#dbeafe",
  "TRIBUNAL": "#c7d2fe",
  "OBSERVADA TRIBUNAL": "#a5b4fc",
  "TESORERIA": "#bbf7d0",
  "SIN SERVICIO": "#f3f4f6",
  "FALLECIDO": "#e5e7eb",
  "REFACTURACION": "#fef3c7",
  "SIN DEFINIR": "#ffffff"
};

const MODULOS = [
  "INTERNACION",
  "ALIMENTACION",
  "REHABILITACION",
  "TRASLADO",
  "ACOMPANANTE ESCOLAR"
];
const PROVEEDORES = [
  "SIAD", "QUIMUR", "NUTRIHOME", "OMNES", "CUIDARTE",
  "MEDICAL", "IACONNIANI", "HIDALGO", "ROMERO", "DYNAMIC", "VISALUD"
];
const TIPOS_EXPTE = ["INICIO", "RENOVACION", "AMPLIACION"];
const ESTADOS_EXPTE = [
  "EN TRAMITE", "EN HTC", "APROBADO", "OBSERVADO",
  "VENCIDO", "BAJA POR FALLECIMIENTO", "SIN DEFINIR"
];
const MESES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
];

/* ============================================================
   HELPERS
   ============================================================ */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const hoy = () => new Date().toISOString().slice(0, 10);

const plata = (n) =>
  n === null || n === undefined || n === "" || isNaN(n)
    ? "-"
    : "$" + Number(n).toLocaleString("es-AR", { maximumFractionDigits: 0 });

const mesesDesde = (periodo) => {
  if (!periodo) return 0;
  const [a, m] = periodo.split("-").map(Number);
  const n = new Date();
  return (n.getFullYear() - a) * 12 + (n.getMonth() + 1 - m);
};

const rank = (estado) => {
  const i = PIPELINE.indexOf(normEstado(estado));
  return i < 0 ? -1 : i;
};

const alertaAtraso = (f) => {
  const e = normEstado(f.estado);
  if (["TESORERIA", "FALLECIDO", "SIN SERVICIO"].includes(e)) return "";
  const m = mesesDesde(f.periodo);
  if (m >= 6) return "CRITICO";
  if (m >= 4) return "ATRASADO";
  return "";
};

// Feriados que NO se cuentan como días hábiles. Fechas fijas nacionales 2026 + Tucumán.
// Agregá acá los movibles (Carnaval, Semana Santa) y puentes turísticos cuando salgan.
const FERIADOS = new Set([
  "2026-01-01", "2026-03-24", "2026-04-02", "2026-05-01", "2026-05-25",
  "2026-06-20", "2026-07-09", "2026-08-17", "2026-09-24", "2026-12-08", "2026-12-25"
]);

const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Días hábiles entre dos fechas (AAAA-MM-DD), inclusive. hasta null = hasta hoy.
const diasHabiles = (desde, hasta) => {
  if (!desde) return null;
  const d = new Date(desde + "T00:00:00");
  const h = hasta ? new Date(hasta + "T00:00:00") : new Date();
  if (isNaN(d.getTime()) || h < d) return null;
  let n = 0;
  const cur = new Date(d);
  while (cur <= h) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6 && !FERIADOS.has(isoLocal(cur))) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
};

// Organismo donde está la factura según su estado
const ETAPA = (estado) => {
  const e = normEstado(estado);
  if (e === "AUDITORIA" || e === "OBSERVADA AUDITORIA") return "Auditoría médica";
  if (e === "ASESORIA LETRADA") return "Asesoría letrada";
  if (e === "PARA FIRMA") return "Resolución para firma";
  if (e === "TRIBUNAL" || e === "OBSERVADA TRIBUNAL") return "Tribunal de cuentas";
  if (e === "TESORERIA") return "Tesorería";
  if (e === "RECIBIDA") return "En el programa";
  return ETIQUETA_ESTADO[e] || e;
};

// Días hábiles en Auditoría Médica (desde que entró hasta que salió a asesoría, o hoy si sigue)
const diasEnAuditoria = (f) => {
  if (!f.fechaAuditoria) return null;
  const e = normEstado(f.estado);
  if (e === "AUDITORIA" || e === "OBSERVADA AUDITORIA") return diasHabiles(f.fechaAuditoria, null);
  if (f.fechaAsesoria) return diasHabiles(f.fechaAuditoria, f.fechaAsesoria);
  return null;
};

// Días hábiles en Asesoría Letrada
const diasEnAsesoria = (f) => {
  if (!f.fechaAsesoria) return null;
  const e = normEstado(f.estado);
  if (e === "ASESORIA LETRADA") return diasHabiles(f.fechaAsesoria, null);
  if (f.fechaTribunal) return diasHabiles(f.fechaAsesoria, f.fechaTribunal);
  return null;
};

// Días hábiles en Tribunal de Cuentas
const diasEnTribunal = (f) => {
  if (!f.fechaTribunal) return null;
  const e = normEstado(f.estado);
  if (e === "TRIBUNAL" || e === "OBSERVADA TRIBUNAL") return diasHabiles(f.fechaTribunal, null);
  if (f.fechaTesoreria) return diasHabiles(f.fechaTribunal, f.fechaTesoreria);
  return null;
};

// Lista de meses "AAAA-MM" entre desde y hasta, inclusive
const mesesEntre = (desde, hasta) => {
  if (!desde || !hasta) return [];
  const [ay, am] = desde.split("-").map(Number);
  const [by, bm] = hasta.split("-").map(Number);
  if (!ay || !am || !by || !bm) return [];
  const out = [];
  let y = ay, m = am, tope = 0;
  while ((y < by || (y === by && m <= bm)) && tope < 24) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
    tope++;
  }
  return out;
};

const nombreMes = (periodo) => {
  if (!periodo) return "-";
  const [y, m] = periodo.split("-");
  return `${MESES[Number(m) - 1] || m} ${y}`;
};

const normalizar = (s) =>
  (s || "").toString().trim().toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/* --- Helpers para importar el padrón de facturación desde Excel --- */

// Nombre canónico: "Gómez, Priscila Berenice" -> "GOMEZ PRISCILA BERENICE"
const normNombre = (s) =>
  (s || "").toString().replace(/,/g, " ").trim().toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const MESES_NUM = {
  ENERO: "01", FEBRERO: "02", MARZO: "03", ABRIL: "04", MAYO: "05", JUNIO: "06",
  JULIO: "07", AGOSTO: "08", SEPTIEMBRE: "09", SETIEMBRE: "09", OCTUBRE: "10",
  NOVIEMBRE: "11", DICIEMBRE: "12"
};

// "Julio 2026" -> "2026-07"   |   "2026-07" -> "2026-07"
const parsePeriodo = (s) => {
  const t = normalizar(s);
  let m = t.match(/(\d{4})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}`;
  m = t.match(/([A-Z]+)\s+(\d{4})/);
  if (m && MESES_NUM[m[1]]) return `${m[2]}-${MESES_NUM[m[1]]}`;
  return "";
};

// Texto libre del proveedor -> etiqueta del catálogo
const mapProveedor = (raw) => {
  const n = normalizar(raw);
  if (!n) return "";
  if (n.includes("NUTRI")) return "NUTRIHOME";
  if (n.includes("SIVKA") || n.includes("SIAD")) return "SIAD";
  if (n.includes("DYNAMIC")) return "DYNAMIC";
  if (n.includes("VISALUD")) return "VISALUD";
  if (n.includes("QUIMUR")) return "QUIMUR";
  if (n.includes("OMNES")) return "OMNES";
  if (n.includes("CUIDARTE")) return "CUIDARTE";
  if (n.includes("MEDICAL")) return "MEDICAL";
  if (n.includes("IACON")) return "IACONNIANI";
  if (n.includes("HIDALGO")) return "HIDALGO";
  if (n.includes("ROMERO")) return "ROMERO";
  return (raw || "").toString().trim();
};

// Limpia guiones/rayas que en el padrón significan "sin dato"
const limpiarDato = (v) => {
  const s = (v === null || v === undefined) ? "" : String(v).trim();
  return (s === "" || s === "—" || s === "-" || s === "–") ? "" : s;
};

// Convierte un monto de texto a número. Tolera "$4.154.900", "4154900", "4.154.900,00".
const parseMonto = (v) => {
  let s = limpiarDato(v);
  if (!s) return null;
  s = s.replace(/[^\d.,-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");   // formato AR: punto=miles, coma=decimal
  else if (/\.\d{3}(\.|$)/.test(s)) s = s.replace(/\./g, "");        // puntos como separador de miles
  const n = Number(s);
  return isNaN(n) ? null : n;
};

// Interpreta el estado escrito en el Excel a un estado válido del circuito
const estadoDesdeTexto = (txt) => {
  const t = normalizar(txt);
  if (!t) return "";
  for (const e of TODOS_ESTADOS) {
    if (normalizar(e) === t || normalizar(ETIQUETA_ESTADO[e]) === t) return e;
  }
  if (t.includes("RECIB")) return "RECIBIDA";
  if (t.includes("AUDITOR")) return "AUDITORIA";
  if (t.includes("ASESOR")) return "ASESORIA LETRADA";
  if (t.includes("FIRMA")) return "PARA FIRMA";
  if (t.includes("TRIBUNAL")) return "TRIBUNAL";
  if (t.includes("TESOR") || t.includes("PAGAD")) return "TESORERIA";
  return "";
};

// Carga el lector de Excel (SheetJS) desde CDN, sin agregar dependencias al proyecto
let _sheetjsPromise = null;
const cargarSheetJS = () => {
  if (typeof window !== "undefined" && window.XLSX) return Promise.resolve(window.XLSX);
  if (_sheetjsPromise) return _sheetjsPromise;
  _sheetjsPromise = new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    sc.onload = () => res(window.XLSX);
    sc.onerror = () => rej(new Error("No se pudo cargar el lector de Excel (revisá la conexión)."));
    document.head.appendChild(sc);
  });
  return _sheetjsPromise;
};

// Encuentra la columna cuyo encabezado contiene alguna de las palabras clave
const buscarCol = (headers, claves) =>
  headers.findIndex((h) => {
    const n = normalizar(h);
    return claves.some((k) => n.includes(k));
  });

// Convierte la matriz de filas del Excel en registros normalizados del padrón
const filasDesdeMatriz = (matriz) => {
  // busca la fila de encabezados (la que tiene "PACIENTE")
  let hIdx = matriz.findIndex((r) => (r || []).some((c) => normalizar(c).includes("PACIENTE")));
  if (hIdx < 0) hIdx = 0;
  const headers = matriz[hIdx] || [];
  const cProv = buscarCol(headers, ["PROVEEDOR"]);
  const cPac = buscarCol(headers, ["PACIENTE"]);
  const cFac = buscarCol(headers, ["FACTURA"]);
  const cOC = buscarCol(headers, ["ORDEN", "OC"]);
  const cMes = buscarCol(headers, ["MES", "PERIODO", "PRESTACIONAL"]);
  const cMonto = buscarCol(headers, ["MONTO", "VALOR", "IMPORTE"]);
  const cEstado = buscarCol(headers, ["ESTADO"]);
  const cObs = buscarCol(headers, ["OBSERV"]);
  const filas = [];
  for (let i = hIdx + 1; i < matriz.length; i++) {
    const r = matriz[i] || [];
    const paciente = cPac >= 0 ? limpiarDato(r[cPac]) : "";
    if (!paciente) continue;
    filas.push({
      proveedor: cProv >= 0 ? limpiarDato(r[cProv]) : "",
      paciente,
      nroFactura: cFac >= 0 ? limpiarDato(r[cFac]) : "",
      oc: cOC >= 0 ? limpiarDato(r[cOC]) : "",
      mes: cMes >= 0 ? limpiarDato(r[cMes]) : "",
      monto: cMonto >= 0 ? limpiarDato(r[cMonto]) : "",
      estado: cEstado >= 0 ? limpiarDato(r[cEstado]) : "",
      observaciones: cObs >= 0 ? limpiarDato(r[cObs]) : ""
    });
  }
  return filas;
};

/* ============================================================
   ESTILOS
   ============================================================ */
const S = {
  page: { fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", background: "#f8fafc", minHeight: "100vh", color: "#0f172a" },
  header: { background: "#1e3a5f", color: "#fff", padding: "12px 20px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" },
  nav: { display: "flex", gap: 4, padding: "0 12px", background: "#fff", borderBottom: "1px solid #e2e8f0", overflowX: "auto" },
  tab: (on) => ({
    padding: "11px 16px", border: "none", background: "none", cursor: "pointer",
    fontSize: 14, fontWeight: on ? 700 : 500, color: on ? "#1e3a5f" : "#64748b",
    borderBottom: on ? "3px solid #1e3a5f" : "3px solid transparent", whiteSpace: "nowrap"
  }),
  main: { padding: 16, maxWidth: 1600, margin: "0 auto" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, marginBottom: 16 },
  btn: { padding: "8px 14px", background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  btnAlt: { padding: "8px 14px", background: "#fff", color: "#1e3a5f", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  btnDanger: { padding: "8px 14px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  input: { padding: "7px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14, width: "100%", boxSizing: "border-box" },
  label: { fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 },
  th: { padding: "9px 8px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#fff", background: "#1e3a5f", textTransform: "uppercase", position: "sticky", top: 0, whiteSpace: "nowrap" },
  td: { padding: "7px 8px", fontSize: 13, borderBottom: "1px solid #f1f5f9" },
  chip: (bg) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 20, background: bg, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }),
  modalBg: { position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 },
  modal: { background: "#fff", borderRadius: 12, padding: 22, maxWidth: 620, width: "100%", maxHeight: "88vh", overflowY: "auto" }
};

/* ============================================================
   COMPONENTES CHICOS
   ============================================================ */
function Chip({ estado }) {
  const e = normEstado(estado);
  return <span style={S.chip(COLOR_ESTADO[e] || "#fff")}>{ETIQUETA_ESTADO[e] || e}</span>;
}

function NombrePac({ nombre, fallecidos }) {
  const f = fallecidos && fallecidos.has(normalizar(nombre));
  return (
    <span style={{ fontWeight: 600, color: f ? "#b91c1c" : "inherit" }}>
      {nombre}
      {f && (
        <span title="Paciente fallecido — factura a pagar"
          style={{ marginLeft: 6, fontSize: 10, color: "#fff", background: "#b91c1c", borderRadius: 4, padding: "1px 5px", fontWeight: 700, whiteSpace: "nowrap" }}>
          ✝ fallecido
        </span>
      )}
    </span>
  );
}

function Campo({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={S.label}>{label}</label>
      {children}
    </div>
  );
}

function Modal({ titulo, onCerrar, children, ancho }) {
  return (
    <div style={S.modalBg} onClick={onCerrar}>
      <div style={{ ...S.modal, maxWidth: ancho || 620 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{titulo}</h3>
          <button onClick={onCerrar} style={{ ...S.btnAlt, padding: "4px 10px" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Stat({ titulo, valor, color, sub }) {
  return (
    <div style={{ ...S.card, marginBottom: 0, borderLeft: `4px solid ${color || "#1e3a5f"}` }}>
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>{titulo}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{valor}</div>
      {sub && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* ============================================================
   LOGIN
   ============================================================ */
function Login({ onEntrar }) {
  const [usuario, setUsuario] = useState("");
  const [error, setError] = useState("");

  const entrar = () => {
    if (!usuario) return setError("Elegí un usuario");
    onEntrar({ usuario });
  };

  return (
    <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ ...S.card, maxWidth: 400, width: "100%" }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          <img src="https://gestor-expedientes-pris.vercel.app/logo-pris.png"
            alt="Programa Integrado de Salud" style={{ maxHeight: 40, maxWidth: "52%", objectFit: "contain" }} />
          <img src="https://gestor-expedientes-pris.vercel.app/logo-gobierno.png"
            alt="Ministerio de Salud Pública - Gobierno de Tucumán" style={{ maxHeight: 46, maxWidth: "46%", objectFit: "contain" }} />
        </div>
        <div style={{ borderBottom: "2px solid #5B9BD5", marginBottom: 16 }} />

        <h2 style={{ marginTop: 0, color: "#1e3a5f" }}>Facturación PRIS</h2>
        <p style={{ fontSize: 13, color: "#64748b", marginTop: -8 }}>Internación Domiciliaria</p>

        <Campo label="Usuario">
          <select style={S.input} value={usuario}
            onChange={(e) => { setUsuario(e.target.value); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") entrar(); }}>
            <option value="">-- Seleccionar --</option>
            {USUARIOS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Campo>

        {error && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{error}</div>}

        <button style={{ ...S.btn, width: "100%" }} onClick={entrar}>Entrar</button>

        <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 16, paddingTop: 14, textAlign: "center" }}>
          <button
            onClick={() => onEntrar({ jefatura: true })}
            style={{ background: "none", border: "none", color: "#1e3a5f", fontSize: 14, fontWeight: 700, cursor: "pointer", textDecoration: "underline", letterSpacing: 0.3 }}>
            RESUMEN
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   FORMULARIO DE FACTURA
   ============================================================ */
function FormFactura({ inicial, pacientes, expedientes, sesion, onGuardar, onCerrar }) {
  const [f, setF] = useState(() => inicial || {
    periodo: hoy().slice(0, 7),
    paciente: "", pacienteId: "", modulo: "INTERNACION",
    usuarioAsignado: sesion.usuario, expedienteId: "", proveedor: "",
    nroExpedienteFacturacion: "", nroResolucionPago: "",
    sige: "", nroFactura: "", oc: "", monto: "", estado: "SIN FACTURA",
    fechaAuditoria: null, fechaAsesoria: null, fechaTribunal: null,
    fechaTesoreria: null, observaciones: ""
  });

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const exptesDelPaciente = useMemo(
    () => expedientes.filter((e) => e.paciente === f.paciente),
    [expedientes, f.paciente]
  );

  const guardar = () => {
    if (!f.paciente) return alert("Falta el paciente");
    if (!f.periodo || !/^\d{4}-\d{2}$/.test(f.periodo)) return alert("Período inválido (AAAA-MM)");
    const p = pacientes.find((x) => x.nombre === f.paciente);
    const [anio, mes] = f.periodo.split("-").map(Number);
    onGuardar({
      ...f, anio, mes,
      pacienteId: p ? p.id : "",
      monto: f.monto === "" ? null : Number(f.monto)
    });
  };

  return (
    <Modal titulo={inicial ? "Editar factura" : "Nueva factura"} onCerrar={onCerrar}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Campo label="Período (AAAA-MM)">
          <input style={S.input} value={f.periodo} onChange={(e) => set("periodo", e.target.value)} placeholder="2026-07" />
        </Campo>
        <Campo label="Usuario responsable">
          <select style={S.input} value={f.usuarioAsignado} onChange={(e) => set("usuarioAsignado", e.target.value)}>
            <option value="">--</option>
            {USUARIOS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </Campo>
      </div>

      <Campo label="Paciente">
        <select style={S.input} value={f.paciente} onChange={(e) => { set("paciente", e.target.value); set("expedienteId", ""); }}>
          <option value="">-- Seleccionar --</option>
          {pacientes.map((p) => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
        </select>
      </Campo>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Campo label="Módulo">
          <select style={S.input} value={f.modulo} onChange={(e) => set("modulo", e.target.value)}>
            {MODULOS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Campo>
        <Campo label="Proveedor">
          <select style={S.input} value={f.proveedor} onChange={(e) => set("proveedor", e.target.value)}>
            <option value="">--</option>
            {PROVEEDORES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </Campo>
      </div>

      <Campo label="Expediente cabecera que la autoriza">
        <select style={S.input} value={f.expedienteId} onChange={(e) => set("expedienteId", e.target.value)}>
          <option value="">-- sin vincular --</option>
          {exptesDelPaciente.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nro || e.id} · {e.vigenciaDesde} a {e.vigenciaHasta}
            </option>
          ))}
        </select>
      </Campo>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Campo label="N° expte de facturación (mensual)">
          <input style={S.input} value={f.nroExpedienteFacturacion || ""} onChange={(e) => set("nroExpedienteFacturacion", e.target.value)} placeholder="se genera en auditoría" />
        </Campo>
        <Campo label="N° resolución de pago">
          <input style={S.input} value={f.nroResolucionPago || ""} onChange={(e) => set("nroResolucionPago", e.target.value)} />
        </Campo>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Campo label="Factura N°">
          <input style={S.input} value={f.nroFactura || ""} onChange={(e) => set("nroFactura", e.target.value)} />
        </Campo>
        <Campo label="OC">
          <input style={S.input} value={f.oc || ""} onChange={(e) => set("oc", e.target.value)} />
        </Campo>
        <Campo label="Nº Expte SIGE">
          <input style={S.input} value={f.sige || ""} onChange={(e) => set("sige", e.target.value)} />
        </Campo>
        <Campo label="Monto">
          <input type="number" style={S.input} value={f.monto ?? ""} onChange={(e) => set("monto", e.target.value)} />
        </Campo>
      </div>

      <Campo label="Estado">
        <select style={S.input} value={f.estado} onChange={(e) => set("estado", e.target.value)}>
          <optgroup label="Circuito">
            {PIPELINE.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
          </optgroup>
          <optgroup label="Especiales">
            {ESPECIALES.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
          </optgroup>
        </select>
      </Campo>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Campo label="Entró a Auditoría médica">
          <input type="date" style={S.input} value={f.fechaAuditoria || ""} onChange={(e) => set("fechaAuditoria", e.target.value || null)} />
        </Campo>
        <Campo label="Entró a Asesoría letrada">
          <input type="date" style={S.input} value={f.fechaAsesoria || ""} onChange={(e) => set("fechaAsesoria", e.target.value || null)} />
        </Campo>
        <Campo label="Entró a Tribunal de cuentas">
          <input type="date" style={S.input} value={f.fechaTribunal || ""} onChange={(e) => set("fechaTribunal", e.target.value || null)} />
        </Campo>
        <Campo label="Pagada en Tesorería">
          <input type="date" style={S.input} value={f.fechaTesoreria || ""} onChange={(e) => set("fechaTesoreria", e.target.value || null)} />
        </Campo>
      </div>

      <Campo label="Observaciones">
        <textarea style={{ ...S.input, minHeight: 60 }} value={f.observaciones || ""} onChange={(e) => set("observaciones", e.target.value)} />
      </Campo>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <button style={S.btnAlt} onClick={onCerrar}>Cancelar</button>
        <button style={S.btn} onClick={guardar}>Guardar</button>
      </div>
    </Modal>
  );
}

/* ============================================================
   VISTA FACTURACION
   ============================================================ */
function VistaFacturacion({ facturas, pacientes, expedientes, sesion, api, fallecidos }) {
  const [fUsuario, setFUsuario] = useState(sesion.usuario);
  const [fEstado, setFEstado] = useState("");
  const [fProveedor, setFProveedor] = useState("");
  const [fPeriodo, setFPeriodo] = useState("");
  const [busca, setBusca] = useState("");
  const [edit, setEdit] = useState(null);
  const [nueva, setNueva] = useState(false);

  const periodos = useMemo(
    () => [...new Set(facturas.map((f) => f.periodo))].sort().reverse(),
    [facturas]
  );

  const lista = useMemo(() => {
    return facturas
      .filter((f) => !fUsuario || f.usuarioAsignado === fUsuario)
      .filter((f) => !fEstado || normEstado(f.estado) === fEstado)
      .filter((f) => !fProveedor || f.proveedor === fProveedor)
      .filter((f) => !fPeriodo || f.periodo === fPeriodo)
      .filter((f) => !busca || normalizar(f.paciente).includes(normalizar(busca)))
      .sort((a, b) => (b.periodo || "").localeCompare(a.periodo || "") || a.paciente.localeCompare(b.paciente));
  }, [facturas, fUsuario, fEstado, fProveedor, fPeriodo, busca]);

  const total = lista.reduce((s, f) => s + (Number(f.monto) || 0), 0);

  const avanzar = (f) => {
    const sig = SIGUIENTE[normEstado(f.estado)];
    if (!sig) return alert("Esta factura ya está en Tesorería, es el último paso.");
    const cambios = { estado: sig };
    if (sig === "AUDITORIA" && !f.fechaAuditoria) cambios.fechaAuditoria = hoy();
    if (sig === "ASESORIA LETRADA" && !f.fechaAsesoria) cambios.fechaAsesoria = hoy();
    if (sig === "TRIBUNAL" && !f.fechaTribunal) cambios.fechaTribunal = hoy();
    if (sig === "TESORERIA" && !f.fechaTesoreria) cambios.fechaTesoreria = hoy();
    api.actualizarFactura(f.id, cambios, `avanzó a ${ETIQUETA_ESTADO[sig]}`);
  };

  const observar = (f) => {
    const e = normEstado(f.estado);
    if (e === "AUDITORIA")
      return api.actualizarFactura(f.id, { estado: "OBSERVADA AUDITORIA" }, "auditoría la devolvió observada");
    if (e === "TRIBUNAL")
      return api.actualizarFactura(f.id, { estado: "OBSERVADA TRIBUNAL" }, "el tribunal la devolvió observada");
    return alert("Solo se puede marcar observada cuando está en Auditoría o en Tribunal.");
  };

  return (
    <>
      <div style={{ ...S.card, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ minWidth: 150 }}>
          <label style={S.label}>Buscar paciente</label>
          <input style={S.input} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="nombre..." />
        </div>
        <div>
          <label style={S.label}>Estado</label>
          <select style={S.input} value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
            <option value="">Todos</option>
            {TODOS_ESTADOS.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Proveedor</label>
          <select style={S.input} value={fProveedor} onChange={(e) => setFProveedor(e.target.value)}>
            <option value="">Todos</option>
            {PROVEEDORES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Período</label>
          <select style={S.input} value={fPeriodo} onChange={(e) => setFPeriodo(e.target.value)}>
            <option value="">— Elegí un mes —</option>
            {periodos.map((p) => <option key={p} value={p}>{nombreMes(p)}</option>)}
          </select>
        </div>
        <button style={S.btn} onClick={() => setNueva(true)}>+ Nueva factura</button>
      </div>

      {(
          <div style={{ ...S.card, padding: 0, overflowX: "auto" }}>
            <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700, borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{fPeriodo ? nombreMes(fPeriodo) + " · " : ""}{lista.length} facturas · Total {plata(total)}</span>
              <button style={{ ...S.btnAlt, padding: "4px 10px", fontSize: 12 }} onClick={() => { setFPeriodo(""); setBusca(""); setFEstado(""); setFProveedor(""); }}>✕ Limpiar</button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={S.th}>Período</th>
              <th style={S.th}>Usuario</th>
              <th style={S.th}>Paciente</th>
              <th style={S.th}>Módulo</th>
              <th style={S.th}>Proveedor</th>
              <th style={S.th}>Factura N°</th>
              <th style={S.th}>OC</th>
              <th style={S.th}>Monto</th>
              <th style={S.th}>Estado</th>
              <th style={S.th}>Antig.</th>
              <th style={S.th}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((f) => {
              const al = alertaAtraso(f);
              return (
                <tr key={f.id} style={{ background: al === "CRITICO" ? "#fff1f2" : "#fff" }}>
                  <td style={S.td}>{f.periodo}</td>
                  <td style={S.td}>{f.usuarioAsignado || "-"}</td>
                  <td style={S.td}><NombrePac nombre={f.paciente} fallecidos={fallecidos} /></td>
                  <td style={S.td}>{f.modulo}</td>
                  <td style={S.td}>{f.proveedor || "-"}</td>
                  <td style={S.td}>{f.nroFactura || "-"}</td>
                  <td style={S.td}>{f.oc || "-"}</td>
                  <td style={{ ...S.td, textAlign: "right" }}>{plata(f.monto)}</td>
                  <td style={S.td}><Chip estado={f.estado} /></td>
                  <td style={{ ...S.td, textAlign: "center" }}>
                    {al ? (
                      <span style={S.chip(al === "CRITICO" ? "#fecaca" : "#fef3c7")}>
                        {mesesDesde(f.periodo)}m
                      </span>
                    ) : (
                      <span style={{ color: "#94a3b8" }}>{mesesDesde(f.periodo)}m</span>
                    )}
                  </td>
                  <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                    {SIGUIENTE[normEstado(f.estado)] && (
                      <button style={{ ...S.btnAlt, padding: "3px 8px", fontSize: 12, marginRight: 4 }}
                        onClick={() => avanzar(f)} title={`Pasar a ${ETIQUETA_ESTADO[SIGUIENTE[normEstado(f.estado)]]}`}>▶</button>
                    )}
                    {["AUDITORIA", "TRIBUNAL"].includes(normEstado(f.estado)) && (
                      <button style={{ ...S.btnAlt, padding: "3px 8px", fontSize: 12, marginRight: 4, color: "#c2410c" }}
                        onClick={() => observar(f)} title="La devolvieron observada">⚠</button>
                    )}
                    <button style={{ ...S.btnAlt, padding: "3px 8px", fontSize: 12 }}
                      onClick={() => setEdit(f)}>✎</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
          </div>
      )}

      {(nueva || edit) && (
        <FormFactura
          inicial={edit}
          pacientes={pacientes}
          expedientes={expedientes}
          sesion={sesion}
          onCerrar={() => { setNueva(false); setEdit(null); }}
          onGuardar={(d) => {
            if (edit) api.actualizarFactura(edit.id, d, "edición manual");
            else api.crearFactura(d);
            setNueva(false); setEdit(null);
          }}
        />
      )}
    </>
  );
}

/* ============================================================
   VISTA PACIENTES + TRANSFERENCIA
   ============================================================ */
function VistaPacientes({ pacientes, facturas, expedientes, sesion, api }) {
  const [sel, setSel] = useState([]);
  const [fUsuario, setFUsuario] = useState(sesion.usuario);
  const [busca, setBusca] = useState("");
  const [transf, setTransf] = useState(false);

  const lista = useMemo(() =>
    pacientes
      .filter((p) => !fUsuario || p.usuarioAsignado === fUsuario)
      .filter((p) => !busca || normalizar(p.nombre).includes(normalizar(busca)))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [pacientes, fUsuario, busca]
  );

  const toggle = (id) =>
    setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const conteo = (nombre) => {
    const fs = facturas.filter((f) => f.paciente === nombre);
    return {
      total: fs.length,
      abiertas: fs.filter((f) => f.estado !== "TESORERIA").length,
      exptes: expedientes.filter((e) => e.paciente === nombre).length
    };
  };

  return (
    <>
      <div style={{ ...S.card, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ minWidth: 180 }}>
          <label style={S.label}>Buscar</label>
          <input style={S.input} value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <button style={{ ...S.btn, background: sel.length ? "#1e3a5f" : "#94a3b8" }}
          disabled={!sel.length} onClick={() => setTransf(true)}>
          ⇄ Transferir {sel.length ? `(${sel.length})` : ""}
        </button>
        {sel.length > 0 && (
          <button style={S.btnAlt} onClick={() => setSel([])}>Limpiar selección</button>
        )}
      </div>

      <div style={{ ...S.card, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: 36 }}></th>
              <th style={S.th}>Paciente</th>
              <th style={S.th}>Usuario asignado</th>
              <th style={S.th}>Módulos</th>
              <th style={S.th}>Facturas</th>
              <th style={S.th}>Abiertas</th>
              <th style={S.th}>Exptes</th>
              <th style={S.th}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => {
              const c = conteo(p.nombre);
              return (
                <tr key={p.id} style={{ background: sel.includes(p.id) ? "#eff6ff" : "#fff" }}>
                  <td style={S.td}>
                    <input type="checkbox" checked={sel.includes(p.id)} onChange={() => toggle(p.id)} />
                  </td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{p.nombre}</td>
                  <td style={S.td}>
                    {p.usuarioAsignado
                      ? <span style={S.chip("#e0e7ff")}>{p.usuarioAsignado}</span>
                      : <span style={S.chip("#fee2e2")}>sin asignar</span>}
                  </td>
                  <td style={{ ...S.td, fontSize: 12 }}>{(p.modulos || []).join(", ")}</td>
                  <td style={{ ...S.td, textAlign: "center" }}>{c.total}</td>
                  <td style={{ ...S.td, textAlign: "center", fontWeight: 700, color: c.abiertas ? "#c2410c" : "#94a3b8" }}>{c.abiertas}</td>
                  <td style={{ ...S.td, textAlign: "center" }}>{c.exptes}</td>
                  <td style={S.td}>
                    <span style={S.chip(p.estado === "FALLECIDO" ? "#e5e7eb" : "#bbf7d0")}>{p.estado}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {transf && (
        <ModalTransferencia
          pacientesSel={pacientes.filter((p) => sel.includes(p.id))}
          facturas={facturas}
          expedientes={expedientes}
          sesion={sesion}
          api={api}
          onCerrar={() => { setTransf(false); setSel([]); }}
        />
      )}
    </>
  );
}

function ModalTransferencia({ pacientesSel, facturas, expedientes, sesion, api, onCerrar }) {
  const [destino, setDestino] = useState("");
  const [motivo, setMotivo] = useState("");
  const [procesando, setProcesando] = useState(false);

  const nombres = pacientesSel.map((p) => p.nombre);
  const facturasAbiertas = facturas.filter((f) => nombres.includes(f.paciente) && f.estado !== "TESORERIA");
  const facturasCerradas = facturas.filter((f) => nombres.includes(f.paciente) && f.estado === "TESORERIA");
  const exptesVigentes = expedientes.filter(
    (e) => nombres.includes(e.paciente) && e.vigenciaHasta && mesesDesde(e.vigenciaHasta) <= 0
  );

  const confirmar = async () => {
    if (!destino) return alert("Elegí el usuario destino");
    if (!motivo.trim()) return alert("Escribí el motivo de la transferencia");
    setProcesando(true);
    try {
      await api.transferir({
        pacientes: pacientesSel, destino, motivo: motivo.trim(),
        facturasAbiertas, exptesVigentes
      });
      onCerrar();
    } catch (e) {
      alert("Error al transferir: " + e.message);
    }
    setProcesando(false);
  };

  return (
    <Modal titulo="Transferir pacientes" onCerrar={onCerrar}>
      <div style={{ background: "#f8fafc", padding: 12, borderRadius: 8, marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
          PACIENTES A TRANSFERIR ({pacientesSel.length})
        </div>
        {pacientesSel.map((p) => (
          <div key={p.id} style={{ fontSize: 13, padding: "2px 0" }}>
            · {p.nombre} <span style={{ color: "#94a3b8" }}>({p.usuarioAsignado || "sin asignar"})</span>
          </div>
        ))}
      </div>

      <Campo label="Transferir a">
        <select style={S.input} value={destino} onChange={(e) => setDestino(e.target.value)}>
          <option value="">-- Seleccionar usuario --</option>
          {USUARIOS.map((u) => <option key={u}>{u}</option>)}
        </select>
      </Campo>

      <Campo label="Motivo">
        <input style={S.input} value={motivo} onChange={(e) => setMotivo(e.target.value)}
          placeholder="ej: redistribución de carga de trabajo" />
      </Campo>

      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Qué se va a mover</div>
        <div>✔ {pacientesSel.length} pacientes</div>
        <div>✔ {facturasAbiertas.length} facturas abiertas (antes de Tesorería)</div>
        <div>✔ {exptesVigentes.length} expedientes cabecera vigentes</div>
        <div style={{ marginTop: 6, color: "#64748b" }}>
          ✕ {facturasCerradas.length} facturas ya en Tesorería quedan con quien las tramitó
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button style={S.btnAlt} onClick={onCerrar} disabled={procesando}>Cancelar</button>
        <button style={S.btn} onClick={confirmar} disabled={procesando}>
          {procesando ? "Transfiriendo..." : "Confirmar transferencia"}
        </button>
      </div>
    </Modal>
  );
}

/* ============================================================
   VISTA EXPEDIENTES
   ============================================================ */
function VistaExpedientes({ expedientes, sesion, api }) {
  const [fUsuario, setFUsuario] = useState(sesion.usuario);
  const [soloVencer, setSoloVencer] = useState(false);

  const lista = useMemo(() =>
    expedientes
      .filter((e) => !fUsuario || e.usuarioAsignado === fUsuario)
      .filter((e) => !soloVencer || (e.vigenciaHasta && mesesDesde(e.vigenciaHasta) >= -1))
      .sort((a, b) => (a.vigenciaHasta || "").localeCompare(b.vigenciaHasta || "")),
    [expedientes, fUsuario, soloVencer]
  );

  const alerta = (e) => {
    if (!e.vigenciaHasta || e.estado === "BAJA POR FALLECIMIENTO") return null;
    const m = -mesesDesde(e.vigenciaHasta);
    if (m < 0) return { txt: "VENCIDO", bg: "#fecaca" };
    if (m <= 1) return { txt: "VENCE YA", bg: "#fef3c7" };
    return null;
  };

  return (
    <>
      <div style={{ ...S.card, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6, paddingBottom: 8 }}>
          <input type="checkbox" checked={soloVencer} onChange={(e) => setSoloVencer(e.target.checked)} />
          Solo los que vencen o vencieron
        </label>
      </div>

      <div style={{ ...S.card, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700, borderBottom: "1px solid #e2e8f0" }}>
          {lista.length} expedientes cabecera
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={S.th}>Nº Expte</th>
              <th style={S.th}>Paciente</th>
              <th style={S.th}>Usuario</th>
              <th style={S.th}>Tipo</th>
              <th style={S.th}>Prestaciones</th>
              <th style={S.th}>Vigencia</th>
              <th style={S.th}>Estado</th>
              <th style={S.th}>Proveedor</th>
              <th style={S.th}>Alerta</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((e) => {
              const a = alerta(e);
              return (
                <tr key={e.id}>
                  <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>{e.nro || "-"}</td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{e.paciente}</td>
                  <td style={S.td}>{e.usuarioAsignado || "-"}</td>
                  <td style={S.td}>{e.tipo}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{(e.prestaciones || []).join(" + ")}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{e.vigenciaDesde} → {e.vigenciaHasta}</td>
                  <td style={S.td}><span style={S.chip(e.estado === "APROBADO" ? "#bbf7d0" : "#f1f5f9")}>{e.estado}</span></td>
                  <td style={S.td}>{e.proveedorAdjudicado || "-"}</td>
                  <td style={S.td}>{a && <span style={S.chip(a.bg)}>{a.txt}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ============================================================
   VISTA RESUMEN
   ============================================================ */
function VistaResumen({ facturas, pacientes, expedientes, fallecidos }) {
  const [q, setQ] = useState("");
  const [fUser, setFUser] = useState("");
  const [fProv, setFProv] = useState("");
  const [fEst, setFEst] = useState("");
  const [fMes, setFMes] = useState("");
  const [pestana, setPestana] = useState("usuario"); // usuario | proveedor | detalle
  const anioActual = Number(hoy().slice(0, 4));
  const mesActual = hoy().slice(0, 7);

  const exptById = useMemo(() => {
    const m = {}; expedientes.forEach((e) => { m[e.id] = e; }); return m;
  }, [expedientes]);

  // Etapas del embudo que mostramos (agrupamos observadas con su etapa madre)
  const ETAPAS = [
    { key: "SIN FACTURA", label: "Sin factura", ests: ["SIN FACTURA"], color: "#fee2e2", fg: "#991b1b" },
    { key: "RECIBIDA", label: "Recibida", ests: ["RECIBIDA"], color: "#fef3c7", fg: "#854d0e" },
    { key: "AUDITORIA", label: "Auditoría", ests: ["AUDITORIA", "OBSERVADA AUDITORIA"], color: "#fed7aa", fg: "#9a3412" },
    { key: "ASESORIA LETRADA", label: "Asesoría", ests: ["ASESORIA LETRADA"], color: "#e9d5ff", fg: "#6b21a8" },
    { key: "PARA FIRMA", label: "Para firma", ests: ["PARA FIRMA"], color: "#dbeafe", fg: "#1e40af" },
    { key: "TRIBUNAL", label: "Tribunal", ests: ["TRIBUNAL", "OBSERVADA TRIBUNAL"], color: "#c7d2fe", fg: "#3730a3" },
    { key: "TESORERIA", label: "Tesorería", ests: ["TESORERIA"], color: "#bbf7d0", fg: "#166534" }
  ];
  const ESTS_PROCESO = ["RECIBIDA", "AUDITORIA", "OBSERVADA AUDITORIA", "ASESORIA LETRADA", "PARA FIRMA", "TRIBUNAL", "OBSERVADA TRIBUNAL"];

  // Facturas que pasan los filtros activos (excepto el propio buscador de texto, que se aplica aparte)
  const base = useMemo(() => facturas.filter((f) => {
    if (fUser && f.usuarioAsignado !== fUser) return false;
    if (fProv && f.proveedor !== fProv) return false;
    if (fMes && f.periodo !== fMes) return false;
    if (fEst) {
      const et = ETAPAS.find((x) => x.key === fEst);
      if (et && !et.ests.includes(normEstado(f.estado))) return false;
    }
    return true;
  }), [facturas, fUser, fProv, fMes, fEst]);

  // KPIs recalculados según filtros
  const kpi = useMemo(() => {
    const enProceso = base.filter((f) => ESTS_PROCESO.includes(normEstado(f.estado))).length;
    const enTes = base.filter((f) => normEstado(f.estado) === "TESORERIA");
    const sinFactura = base.filter((f) => normEstado(f.estado) === "SIN FACTURA").length;
    const montoTes = enTes.reduce((s, f) => s + (Number(f.monto) || 0), 0);
    const montoPend = base.filter((f) => normEstado(f.estado) !== "TESORERIA")
      .reduce((s, f) => s + (Number(f.monto) || 0), 0);
    return { enProceso, enTes: enTes.length, sinFactura, montoTes, montoPend, total: base.length };
  }, [base]);

  // Conteo por etapa del embudo (sobre la base filtrada, ignorando el filtro de estado)
  const baseSinEstado = useMemo(() => facturas.filter((f) => {
    if (fUser && f.usuarioAsignado !== fUser) return false;
    if (fProv && f.proveedor !== fProv) return false;
    if (fMes && f.periodo !== fMes) return false;
    return true;
  }), [facturas, fUser, fProv, fMes]);

  const conteoEtapa = useMemo(() => {
    const c = {};
    ETAPAS.forEach((et) => { c[et.key] = 0; });
    baseSinEstado.forEach((f) => {
      const e = normEstado(f.estado);
      const et = ETAPAS.find((x) => x.ests.includes(e));
      if (et) c[et.key]++;
    });
    return c;
  }, [baseSinEstado]);

  // Agrupado por usuario (respeta filtros de proveedor/mes/estado, ignora el de usuario)
  const baseParaUsuario = useMemo(() => facturas.filter((f) => {
    if (fProv && f.proveedor !== fProv) return false;
    if (fMes && f.periodo !== fMes) return false;
    if (fEst) {
      const et = ETAPAS.find((x) => x.key === fEst);
      if (et && !et.ests.includes(normEstado(f.estado))) return false;
    }
    return true;
  }), [facturas, fProv, fMes, fEst]);

  const porUsuario = useMemo(() => USUARIOS.map((u) => {
    const fs = baseParaUsuario.filter((f) => f.usuarioAsignado === u);
    const proc = fs.filter((f) => ESTS_PROCESO.includes(normEstado(f.estado))).length;
    const tes = fs.filter((f) => normEstado(f.estado) === "TESORERIA");
    return {
      usuario: u, total: fs.length, proceso: proc, tesoreria: tes.length,
      montoTes: tes.reduce((s, f) => s + (Number(f.monto) || 0), 0)
    };
  }).filter((r) => r.total > 0), [baseParaUsuario]);

  // Agrupado por proveedor (respeta filtros de usuario/mes/estado, ignora el de proveedor)
  const baseParaProv = useMemo(() => facturas.filter((f) => {
    if (fUser && f.usuarioAsignado !== fUser) return false;
    if (fMes && f.periodo !== fMes) return false;
    if (fEst) {
      const et = ETAPAS.find((x) => x.key === fEst);
      if (et && !et.ests.includes(normEstado(f.estado))) return false;
    }
    return true;
  }), [facturas, fUser, fMes, fEst]);

  const porProveedor = useMemo(() => PROVEEDORES.map((p) => {
    const fs = baseParaProv.filter((f) => f.proveedor === p);
    const proc = fs.filter((f) => ESTS_PROCESO.includes(normEstado(f.estado))).length;
    const tes = fs.filter((f) => normEstado(f.estado) === "TESORERIA").length;
    return {
      proveedor: p, total: fs.length, proceso: proc, tesoreria: tes,
      pendiente: fs.filter((f) => normEstado(f.estado) !== "TESORERIA").reduce((s, f) => s + (Number(f.monto) || 0), 0)
    };
  }).filter((r) => r.total > 0).sort((a, b) => b.pendiente - a.pendiente), [baseParaProv]);

  // Meses pendientes de facturar (según expedientes vigentes) — respeta filtro de usuario
  const pendientes = useMemo(() => {
    const out = [];
    expedientes.forEach((e) => {
      if (e.estado === "BAJA POR FALLECIMIENTO") return;
      if (fUser && (e.usuarioAsignado || "") !== fUser) return;
      if (!e.vigenciaDesde || !e.vigenciaHasta) return;
      mesesEntre(e.vigenciaDesde, e.vigenciaHasta).forEach((m) => {
        if (m > mesActual) return;
        if (fMes && m !== fMes) return;
        const hay = facturas.some((f) => f.paciente === e.paciente && f.periodo === m && normEstado(f.estado) !== "SIN FACTURA");
        if (!hay) out.push({ paciente: e.paciente, mes: m, cabecera: e.nro || e.id, usuario: e.usuarioAsignado || "-" });
      });
    });
    return out.sort((a, b) => (a.usuario || "").localeCompare(b.usuario) || (a.mes || "").localeCompare(b.mes));
  }, [facturas, expedientes, mesActual, fUser, fMes]);

  // Detalle de facturas (base filtrada + texto), para la pestaña Detalle y el buscador universal
  const detalle = useMemo(() => {
    const t = normalizar(q);
    return base.filter((f) => {
      if (!t) return true;
      const cab = exptById[f.expedienteId];
      return [f.paciente, f.oc, f.proveedor, f.periodo, nombreMes(f.periodo), f.nroFactura,
        f.nroExpedienteFacturacion, cab && cab.nro, f.usuarioAsignado]
        .some((x) => normalizar(x || "").includes(t));
    }).sort((a, b) => (b.periodo || "").localeCompare(a.periodo || "")).slice(0, 200);
  }, [base, q, exptById]);

  const hayFiltro = fUser || fProv || fEst || fMes || q;

  // Meses disponibles para el filtro
  const mesesDisponibles = useMemo(() => {
    const s = new Set();
    facturas.forEach((f) => { if (f.periodo) s.add(f.periodo); });
    return [...s].sort((a, b) => b.localeCompare(a));
  }, [facturas]);

  const limpiar = () => { setQ(""); setFUser(""); setFProv(""); setFEst(""); setFMes(""); };

  const selStyle = { ...S.input, width: "auto", minWidth: 130, fontSize: 13, padding: "7px 8px" };

  return (
    <>
      {/* Barra de filtros */}
      <div style={S.card}>
        <label style={S.label}>Consultar — buscá o combiná filtros</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <input style={{ ...S.input, flex: 1, minWidth: 200, fontSize: 15 }} value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Paciente · factura · OC · mes · proveedor" />
          <select style={selStyle} value={fUser} onChange={(e) => setFUser(e.target.value)}>
            <option value="">Usuario · todos</option>
            {USUARIOS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <select style={selStyle} value={fProv} onChange={(e) => setFProv(e.target.value)}>
            <option value="">Proveedor · todos</option>
            {PROVEEDORES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select style={selStyle} value={fEst} onChange={(e) => setFEst(e.target.value)}>
            <option value="">Estado · todos</option>
            {ETAPAS.map((et) => <option key={et.key} value={et.key}>{et.label}</option>)}
          </select>
          <select style={selStyle} value={fMes} onChange={(e) => setFMes(e.target.value)}>
            <option value="">Mes · todos</option>
            {mesesDisponibles.map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}
          </select>
          {hayFiltro && (
            <button style={{ ...S.btnAlt, padding: "7px 12px", fontSize: 13 }} onClick={limpiar}>✕ Limpiar</button>
          )}
        </div>
      </div>

      {/* KPIs dinámicos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, margin: "16px 0" }}>
        <Stat titulo="En proceso" valor={kpi.enProceso} color="#f59e0b" sub="expedientes en circuito" />
        <Stat titulo="En tesorería" valor={kpi.enTes} color="#16a34a" sub={`${plata(kpi.montoTes)} a cobrar`} />
        <Stat titulo="Falta cargar" valor={pendientes.length} color={pendientes.length ? "#dc2626" : "#16a34a"} sub="meses sin factura" />
        <Stat titulo="Pendiente de cobro" valor={plata(kpi.montoPend)} color="#c2410c" sub={`${kpi.total} facturas en la vista`} />
      </div>

      {/* Embudo del circuito */}
      <div style={S.card}>
        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 8 }}>
          Embudo del circuito · clic en una etapa para filtrar
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {ETAPAS.map((et) => {
            const on = fEst === et.key;
            return (
              <button key={et.key}
                onClick={() => { const v = fEst === et.key ? "" : et.key; setFEst(v); if (v) setPestana("detalle"); }}
                style={{
                  flex: 1, minWidth: 90, cursor: "pointer", borderRadius: 8, padding: "10px 6px",
                  background: et.color, color: et.fg,
                  border: on ? `2px solid ${et.fg}` : "1px solid rgba(0,0,0,.06)"
                }}>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{conteoEtapa[et.key] || 0}</div>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{et.label}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pestañas */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {[["usuario", "Por usuario"], ["proveedor", "Por proveedor"], ["detalle", `Detalle / pendientes`]].map(([k, l]) => {
          const on = pestana === k;
          return (
            <button key={k} onClick={() => setPestana(k)}
              style={{
                padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700,
                border: on ? "1px solid #1e3a5f" : "1px solid #cbd5e1",
                background: on ? "#1e3a5f" : "#fff", color: on ? "#fff" : "#334155"
              }}>{l}</button>
          );
        })}
      </div>

      {/* Panel según pestaña */}
      {pestana === "usuario" && (
        <div style={S.card}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Usuario", "Facturas", "En proceso", "Tesorería", "Monto tesorería"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {porUsuario.map((r) => (
                  <tr key={r.usuario} style={{ cursor: "pointer", background: fUser === r.usuario ? "#eff6ff" : "transparent" }}
                    onClick={() => { const v = fUser === r.usuario ? "" : r.usuario; setFUser(v); if (v) setPestana("detalle"); }}>
                    <td style={{ ...S.td, fontWeight: 700 }}>{r.usuario}</td>
                    <td style={{ ...S.td, textAlign: "center", fontWeight: 700 }}>{r.total}</td>
                    <td style={{ ...S.td, textAlign: "center", color: "#b45309" }}>{r.proceso}</td>
                    <td style={{ ...S.td, textAlign: "center", color: "#166534", fontWeight: 700 }}>{r.tesoreria}</td>
                    <td style={{ ...S.td, textAlign: "right" }}>{plata(r.montoTes)}</td>
                  </tr>
                ))}
                {porUsuario.length === 0 && <tr><td style={{ ...S.td, color: "#94a3b8" }} colSpan={5}>Sin resultados con los filtros actuales.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>Clic en una fila para filtrar todo por ese usuario.</div>
        </div>
      )}

      {pestana === "proveedor" && (
        <div style={S.card}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Proveedor", "Facturas", "En proceso", "Tesorería", "Pendiente de cobro"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {porProveedor.map((r) => (
                  <tr key={r.proveedor} style={{ cursor: "pointer", background: fProv === r.proveedor ? "#eff6ff" : "transparent" }}
                    onClick={() => { const v = fProv === r.proveedor ? "" : r.proveedor; setFProv(v); if (v) setPestana("detalle"); }}>
                    <td style={{ ...S.td, fontWeight: 700 }}>{r.proveedor}</td>
                    <td style={{ ...S.td, textAlign: "center" }}>{r.total}</td>
                    <td style={{ ...S.td, textAlign: "center", color: "#b45309" }}>{r.proceso}</td>
                    <td style={{ ...S.td, textAlign: "center", color: "#166534" }}>{r.tesoreria}</td>
                    <td style={{ ...S.td, textAlign: "right", fontWeight: 700, color: "#c2410c" }}>{plata(r.pendiente)}</td>
                  </tr>
                ))}
                {porProveedor.length === 0 && <tr><td style={{ ...S.td, color: "#94a3b8" }} colSpan={5}>Sin resultados con los filtros actuales.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>Clic en una fila para filtrar todo por ese proveedor.</div>
        </div>
      )}

      {pestana === "detalle" && (
        <>
          <div style={S.card}>
            <h3 style={{ marginTop: 0, fontSize: 16 }}>
              Facturas {hayFiltro ? "· filtradas" : ""} <span style={{ fontSize: 13, color: "#64748b", fontWeight: 500 }}>({detalle.length})</span>
            </h3>
            {hayFiltro && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {[
                  fUser && ["Usuario: " + fUser, () => setFUser("")],
                  fProv && ["Proveedor: " + fProv, () => setFProv("")],
                  fEst && ["Estado: " + (ETAPAS.find((x) => x.key === fEst)?.label || fEst), () => setFEst("")],
                  fMes && ["Mes: " + nombreMes(fMes), () => setFMes("")],
                  q && ['Texto: "' + q + '"', () => setQ("")]
                ].filter(Boolean).map(([txt, quitar], i) => (
                  <button key={i} onClick={quitar}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1e40af", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    {txt} <span style={{ fontWeight: 400 }}>✕</span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Paciente", "Período", "Proveedor", "Factura N°", "OC", "Monto", "Estado", "Usuario"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {detalle.map((f) => (
                    <tr key={f.id}>
                      <td style={S.td}><NombrePac nombre={f.paciente} fallecidos={fallecidos} /></td>
                      <td style={S.td}>{f.periodo}</td>
                      <td style={S.td}>{f.proveedor || "-"}</td>
                      <td style={S.td}>{f.nroFactura || "-"}</td>
                      <td style={S.td}>{f.oc || "-"}</td>
                      <td style={{ ...S.td, textAlign: "right" }}>{plata(f.monto)}</td>
                      <td style={S.td}><Chip estado={f.estado} /></td>
                      <td style={S.td}>{f.usuarioAsignado || "-"}</td>
                    </tr>
                  ))}
                  {detalle.length === 0 && <tr><td style={{ ...S.td, color: "#94a3b8" }} colSpan={8}>Sin resultados.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div style={S.card}>
            <h3 style={{ marginTop: 0, fontSize: 16, color: pendientes.length ? "#dc2626" : "#16a34a" }}>
              Meses pendientes de facturar {pendientes.length ? `· ${pendientes.length}` : ""}
            </h3>
            {pendientes.length === 0 ? (
              <div style={{ fontSize: 13, color: "#16a34a" }}>Al día: todos los meses de los expedientes vigentes tienen factura cargada.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Paciente", "Mes sin facturar", "Expte cabecera", "Usuario"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {pendientes.map((p, i) => (
                      <tr key={i} style={{ background: "#fff7ed" }}>
                        <td style={{ ...S.td, fontWeight: 600 }}>{p.paciente}</td>
                        <td style={{ ...S.td, color: "#c2410c", fontWeight: 600 }}>{nombreMes(p.mes)}</td>
                        <td style={S.td}>{p.cabecera}</td>
                        <td style={S.td}>{p.usuario}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}


/* ============================================================
   LECTURA DE PDF (mismo pipeline que el Gestor de Expedientes)
   PDF con texto  -> pdf.js (casi perfecto)
   Foto / escaneo -> OCR con Tesseract (puede tener errores; se revisa)
   Se cargan perezosamente desde CDN solo al usar el botón.
   ============================================================ */
async function cargarPdfJsFact() {
  const url = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs";
  const pdfjs = await import(/* @vite-ignore */ url);
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs";
  return pdfjs;
}

function reconstruirTextoFact(items) {
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

async function textoDePdfFact(file, onProgreso) {
  const pdfjs = await cargarPdfJsFact();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  let texto = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    if (onProgreso) onProgreso(`Leyendo texto pág. ${p}/${pdf.numPages}…`);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    texto += reconstruirTextoFact(content.items) + "\n";
  }
  return texto.trim();
}

async function ocrImagenFact(imagen) {
  const url = "https://cdn.jsdelivr.net/npm/tesseract.js@5/+esm";
  const mod = await import(/* @vite-ignore */ url);
  const recognize = mod.recognize || (mod.default && mod.default.recognize);
  const res = await recognize(imagen, "spa");
  return ((res && res.data && res.data.text) || "").trim();
}

// OCR de UNA página concreta del pdf.js (rasteriza y reconoce).
async function ocrPaginaFact(page) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return await ocrImagenFact(canvas.toDataURL("image/png"));
}

// Convierte un File a base64 (sin el prefijo data:).
function fileABase64Fact(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => { const s = String(fr.result || ""); res(s.slice(s.indexOf(",") + 1)); };
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

// OCR del PDF en el BACKEND (Google Drive OCR): mucho más rápido y preciso que el OCR
// local del navegador. Manda el PDF una sola vez y recibe el texto de todo el documento.
// Rasteriza una página del PDF a JPG comprimido y devuelve su base64 (liviano, para OCR).
async function paginaAJpegBase64Fact(page, escala = 1.6, calidad = 0.6) {
  const viewport = page.getViewport({ scale: escala });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  const dataUrl = canvas.toDataURL("image/jpeg", calidad);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/* Lee un PDF de forma HÍBRIDA y COMPLETA. Primero la capa de texto de todas las páginas
   (instantáneo). Las páginas escaneadas se rasterizan a JPG liviano y se mandan al OCR de
   Google EN TANDAS CHICAS (para no pasar el límite de tamaño del proxy → evita el 413).
   Si el backend falla, cae al OCR local del navegador como respaldo. */
async function textoCompletoPdfFact(file, onProgreso) {
  const pdfjs = await cargarPdfJsFact();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;

  const partes = [];      // texto por página (null = pendiente de OCR)
  const escaneadas = [];  // { indice, page }
  for (let p = 1; p <= pdf.numPages; p++) {
    if (onProgreso) onProgreso(`Leyendo texto pág. ${p}/${pdf.numPages}…`);
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const tp = reconstruirTextoFact(content.items);
    if (normalizar(tp).replace(/[^A-Z]/g, "").length < 25) {
      partes.push(null);
      escaneadas.push({ indice: partes.length - 1, page });
    } else {
      partes.push(tp);
    }
  }

  if (escaneadas.length) {
    if (onProgreso) onProgreso("Preparando páginas escaneadas…");
    const imagenes = [];
    for (const e of escaneadas) {
      imagenes.push({ base64: await paginaAJpegBase64Fact(e.page), mimeType: "image/jpeg" });
    }
    try {
      let idx = 0;
      const LOTE = 2; // 2 imágenes por request: liviano, sin 413
      for (let i = 0; i < imagenes.length; i += LOTE) {
        const tanda = imagenes.slice(i, i + LOTE);
        if (onProgreso) onProgreso(`Reconociendo en el servidor (OCR de Google) ${Math.min(i + LOTE, imagenes.length)}/${imagenes.length}…`);
        const res = await fetch("/api/puente", {
          method: "POST",
          body: JSON.stringify({ clave: "FACTURACIONPRIS2026", accion: "ocrPdf", imagenes: tanda }),
        });
        const data2 = await res.json();
        if (!data2.ok) throw new Error(data2.error || "OCR del servidor falló");
        const trozos = String(data2.texto || "").split("\n\n");
        for (let k = 0; k < tanda.length; k++) { partes[escaneadas[idx].indice] = trozos[k] || ""; idx++; }
      }
    } catch (e) {
      if (onProgreso) onProgreso("OCR del servidor no disponible, uso el del navegador (más lento)…");
      for (let j = 0; j < escaneadas.length; j++) {
        const e = escaneadas[j];
        if (onProgreso) onProgreso(`Reconociendo (OCR local) ${j + 1}/${escaneadas.length}…`);
        try { partes[e.indice] = await ocrPaginaFact(e.page); } catch (e2) { partes[e.indice] = ""; }
      }
    }
  }
  return partes.map((x) => x || "").join("\n\n").trim();
}

// Lee cualquier archivo (PDF de texto, escaneado o mixto, o imagen) y devuelve el texto.
async function leerTextoArchivo(file, onProgreso) {
  const esPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name);
  if (esPdf) return (await textoCompletoPdfFact(file, onProgreso)) || "";
  if (onProgreso) onProgreso("Reconociendo imagen…");
  return (await ocrImagenFact(file)) || "";
}

/* ============================================================
   EXTRACCION DE DATOS DE FACTURA / RECLAMO DESDE TEXTO
   ============================================================ */
// Convierte un importe de texto a número. Tolera formato argentino ("$4.154.900,50")
// y formato yanqui/anglo ("$ 9,126,736.57"), que es el que usan varios proveedores.
// Es aparte de parseMonto (que usa el importador de Excel) para no alterar aquel flujo.
function parseMontoReclamo(v) {
  let s = (v === null || v === undefined) ? "" : String(v).trim();
  s = s.replace(/[^\d.,]/g, "").replace(/[.,]$/, ""); // descarta separador final suelto ("...,00.-")
  if (!s) return null;
  const tienePunto = s.includes("."), tieneComa = s.includes(",");
  if (tienePunto && tieneComa) {
    // el último separador que aparece es el decimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", "."); // AR: 1.234.567,89
    else s = s.replace(/,/g, "");                                                            // US: 1,234,567.89
  } else if (tieneComa) {
    // solo coma: decimal si hay exactamente 2 dígitos después; si no, es separador de miles
    s = /,\d{2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (tienePunto) {
    // solo punto: si hay más de un punto o el bloque final tiene 3 dígitos, son miles
    const partes = s.split(".");
    if (partes.length > 2 || (partes.length === 2 && partes[1].length === 3)) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return isNaN(n) ? null : n;
}

// Normaliza un período escrito de varias formas a "AAAA-MM".
function periodoDesdeTexto(txt) {
  const t = (txt || "").toString();
  const meses = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
  let m = t.match(new RegExp("(" + meses + ")\\s*(?:de\\s*)?(20\\d{2})", "i"));
  if (m) return parsePeriodo(m[1] + " " + m[2]);
  m = t.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/);          // 2025-10
  if (m) return m[1] + "-" + String(m[2]).padStart(2, "0");
  m = t.match(/\b(0?[1-9]|1[0-2])[-/](20\d{2})\b/);          // 10-2025
  if (m) return m[2] + "-" + String(m[1]).padStart(2, "0");
  return "";
}

/* Extrae de un texto:
   - datos globales (proveedor, OC, paciente si los hubiera)
   - una lista de renglones factura: [{ periodo, nroFactura, monto }]
   Sirve tanto para una tabla de varias facturas (tipo OMNES) como para un
   reclamo de una sola factura. */
// ¿El texto parece un EXPEDIENTE de facturación (carátula + nota + factura + dictamen)?
// Se diferencia de un reclamo simple (tabla de varias facturas de un proveedor).
function esExpediente(t) {
  const tn = normalizar(t || "");
  return tn.includes("DICTAMEN DE AUDITORIA")
    || (tn.includes("CONTROL POSTERIOR") && tn.includes("ORDEN DE COMPRA"))
    || (/EXPEDIENTE\s*N[°ºª]\s*:/.test(tn) && tn.includes("PACIENTE:"));
}

// Extrae de un expediente los datos que necesita una factura del sistema.
// Devuelve la MISMA forma que extraerDatosFactura ({proveedor, oc, paciente, filas:[...]})
// con una sola fila enriquecida con expediente/resolución/módulo.
function extraerExpediente(tRaw) {
  const t = (tRaw || "").replace(/\uf020/g, " "); // normaliza el espacio especial de estos PDF
  const tn = normalizar(t);
  const meses = "ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE";
  const MN = { ENERO: "01", FEBRERO: "02", MARZO: "03", ABRIL: "04", MAYO: "05", JUNIO: "06", JULIO: "07", AGOSTO: "08", SEPTIEMBRE: "09", SETIEMBRE: "09", OCTUBRE: "10", NOVIEMBRE: "11", DICIEMBRE: "12" };

  // N° expediente de facturación (mensual): prioridad al que sigue a "EXPEDIENTE N°:";
  // si no, el primero con letra que NO sea de cabecera (/S/, /SS/).
  let expteFact = "";
  let mE = t.match(/EXPEDIENTE\s*N[°ºª]\s*:\s*(\d{2,5})\s*\/\s*(\d{2,4})\s*\/\s*([A-Z])\s*\/\s*(20\d{2})/i);
  if (mE) expteFact = `${mE[1]}/${mE[2]}/${mE[3].toUpperCase()}/${mE[4]}`;
  if (!expteFact) {
    for (const mm of t.matchAll(/\b(\d{2,5})\s*\/\s*(\d{2,4})\s*\/\s*([A-Z])\s*\/\s*(20\d{2})\b/g)) {
      if (!/^S+$/i.test(mm[3])) { expteFact = `${mm[1]}/${mm[2]}/${mm[3].toUpperCase()}/${mm[4]}`; break; }
    }
  }
  if (!expteFact) {
    const m2 = t.match(/EXPEDIENTE\s+(\d{2,5})\s*\/\s*(\d{2,4})\s*LETRA\s*([A-Z])\s*A[ñn]o\s*(20\d{2})/i);
    if (m2) expteFact = `${m2[1]}/${m2[2]}/${m2[3].toUpperCase()}/${m2[4]}`;
  }

  // Paciente: aparición más larga tras "PACIENTE:", cortando en DNI/DEPENDENCIA/DIAGNOSTICO
  let paciente = "";
  for (const mp of t.matchAll(/PACIENTE\s*:?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ ,]+?)(?=\s+DNI|\s+DEPENDENCIA|\s+DIAGN|\n|$)/gi)) {
    const cand = normalizar(mp[1]).replace(/,/g, " ").replace(/\s+/g, " ").trim();
    if (cand.split(" ").length >= 2 && cand.length > paciente.length) paciente = cand;
  }

  // Período
  let periodo = "";
  let mm = tn.match(new RegExp("-\\s*(" + meses + ")\\s*(20\\d{2})\\s*-"))
    || tn.match(new RegExp("MES DE (" + meses + ")\\s*(?:DEL A[NÑ]O)?\\s*(20\\d{2})"))
    || tn.match(new RegExp("DOMICILIARIA\\s+(" + meses + ")\\s*(20\\d{2})"))
    || tn.match(new RegExp("MES\\.?\\s*(" + meses + ")\\s*(20\\d{2})"));
  if (mm) periodo = `${mm[2]}-${MN[mm[1]]}`;

  // Proveedor (SIVKA => SIAD; NUTRI HOME => NUTRIHOME)
  let proveedor = "";
  if (tn.includes("SIVKA") || /\bSIAD\b/.test(tn)) proveedor = "SIAD";
  else if (tn.includes("NUTRI HOME") || tn.includes("NUTRIHOME")) proveedor = "NUTRIHOME";
  else { for (const p of PROVEEDORES) { if (tn.includes(normalizar(p))) { proveedor = p; break; } } }
  if (!proveedor) proveedor = mapProveedor(t);

  // N° de factura (AFIP), incluso partido en dos líneas
  let nroFactura = "";
  let mf = t.match(/\b(\d{4,5}-\d{8})\b/) || t.match(/\b(\d{2}-\d{8})\b/);
  if (mf) nroFactura = mf[1];
  if (!nroFactura) { const m2 = t.match(/(\d{4,5})-\s*\n?\s*(?:Factura[^\n]*\n)?\s*(\d{6,8})/); if (m2) nroFactura = `${m2[1]}-${m2[2]}`; }

  // OC
  let oc = "";
  const moc = t.match(/ORDEN\s*DE\s*COMPRA\s*(?:N[°ºª]?\s*:?\s*)?\s*(\d{4,6})\b/i);
  if (moc) oc = moc[1];

  // Resolución de pago
  let resolucion = "";
  const mr = t.match(/(\d{3,5})\s*\/\s*DGPRIS/i);
  if (mr) resolucion = `${mr[1]}/DGPRIS`;

  // Expte cabecera autorizante (/SS/ /S/)
  let expteCabecera = "";
  const mc = t.match(/Expediente\s*N[°ºª]?\s*(\d{3,5}\/\d{2,4}\/[A-Z]{1,3}\/20\d{2})/i);
  if (mc) expteCabecera = mc[1].toUpperCase();

  // Monto = importe de la FACTURA (fila "Factura" del control posterior; NO el total de la OC)
  let monto = null;
  const lineas = t.split(/\n+/);
  for (let i = 0; i < lineas.length; i++) {
    if (/^\s*Factura\b/i.test(lineas[i]) && !/nota de cr/i.test(lineas[i])) {
      const cand = (lineas[i] + " " + (lineas[i + 1] || "") + " " + (lineas[i + 2] || "")).match(/\$\s*([\d.,]+)/);
      if (cand) { monto = parseMontoReclamo(cand[1]); break; }
    }
  }

  // Módulo
  let modulo = "INTERNACION";
  if (tn.includes("ALIMENTACION ENTERAL") || tn.includes("SOPORTE NUTRICIONAL")) modulo = "ALIMENTACION";

  // Diagnóstico (para observaciones)
  let diagnostico = "";
  const mdx = t.match(/DIAGN[ÓO]STICO\s*:?\s*([^\n]+)/i);
  if (mdx) diagnostico = mdx[1].trim();

  const fila = { periodo, nroFactura, oc, monto, paciente, expteFact, resolucion, expteCabecera, modulo, diagnostico };
  return { proveedor, oc, paciente, esExpediente: true, filas: [fila] };
}

function extraerDatosFactura(texto) {
  const t = texto || "";
  // Si es un expediente de facturación, usamos el parser específico.
  if (esExpediente(t)) return extraerExpediente(t);
  const tn = normalizar(t);

  // Proveedor global
  let proveedor = "";
  for (const p of PROVEEDORES) { if (tn.includes(normalizar(p))) { proveedor = p; break; } }
  if (!proveedor) proveedor = mapProveedor(t);

  // OC global (si viene una sola para todo el reclamo)
  let oc = "";
  const mOC = t.match(/(?:ORDEN\s*DE\s*COMPRA|O\.?\s*C\.?)\s*(?:N[°º:.\s]*)?\s*(\d{3,6})/i);
  if (mOC) oc = mOC[1].trim();

  // Paciente global (reclamos de una factura suelen nombrarlo)
  let paciente = "";
  const mPac = t.match(/(?:PACIENTE|AFILIADO|BENEFICIARIO)\s*:?\s*([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]+){1,3})/);
  if (mPac) paciente = mPac[1].replace(/\s+/g, " ").trim();

  // Renglones: recorremos línea por línea buscando período + N° factura + importe.
  // Importe: exige separadores de miles o decimales (evita confundir "09-2025" con un monto).
  const filas = [];
  const vistos = new Set();
  const lineas = t.split(/\n+/);
  const reMonto = /(?:\$\s*)?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\$\s*\d+(?:[.,]\d{2})?/;
  const mesesRe = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
  // Período con año explícito en la línea
  const resPeriodoLinea = [
    /\b(0?[1-9]|1[0-2])[-/](20\d{2})\b/,
    /\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/,
    new RegExp("\\b(" + mesesRe + ")\\s*(?:de\\s*)?(20\\d{2})\\b", "i")
  ];
  // Mes por nombre SIN año (tomamos el año del documento). Ej: "ABRIL" en una tabla.
  const reMesSolo = new RegExp("\\b(" + mesesRe + ")\\b", "i");
  // Año de referencia del documento (de las fechas del mail, ej "12/5/2026"); fallback al año actual.
  const mAnio = t.match(/\b(20\d{2})\b/);
  const anioDoc = mAnio ? mAnio[1] : hoy().slice(0, 4);
  const numMes = { enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06", julio: "07", agosto: "08", septiembre: "09", setiembre: "09", octubre: "10", noviembre: "11", diciembre: "12" };
  // Factura como par con guión ("2-956", "0006-00000142", "1-568").
  const reFactura = /\b(\d{1,4}\s*-\s*\d{1,8})\b/;
  const esFechaEn = (str, idx) => /^\s*\/?\d/.test(str.slice(idx)); // evita tomar parte de una fecha

  for (const linRaw of lineas) {
    const lin = linRaw.trim();
    if (!lin) continue;
    const ln = normalizar(lin);
    if (/^per[ií]odo\b/i.test(ln) && /(importe|fc|factura|monto)/i.test(ln)) continue; // encabezado
    if (/^paciente\b/i.test(ln)) continue;                                            // encabezado de tabla ancha
    if (/^\$?\s*[\d.,]+\s*$/.test(lin)) continue;                                      // fila de total (solo un monto)

    // 1) Período. Prioridad: mes por NOMBRE (evita que una fecha dd/mm/aaaa se lea como período);
    //    si no hay nombre de mes, recién ahí probamos "MM-AAAA" / "AAAA-MM".
    let resto = lin, per = "", periodoTxt = "";
    const mMesNombre = lin.match(reMesSolo);
    if (mMesNombre) {
      // ¿trae año pegado? (ej "octubre 2025"); si no, usamos el año del documento
      const conAnio = lin.match(new RegExp("(" + mesesRe + ")\\s*(?:de\\s*)?(20\\d{2})", "i"));
      if (conAnio) { per = periodoDesdeTexto(conAnio[0]); periodoTxt = conAnio[0]; }
      else { per = anioDoc + "-" + numMes[mMesNombre[1].toLowerCase()]; periodoTxt = mMesNombre[0]; }
    } else {
      for (const re of [resPeriodoLinea[0], resPeriodoLinea[1]]) {
        const m = lin.match(re);
        if (m) { per = periodoDesdeTexto(m[0]); periodoTxt = m[0]; break; }
      }
    }
    if (periodoTxt) resto = lin.replace(periodoTxt, " ");

    // 2) Monto (sobre la línea completa; el regex exige formato de importe)
    const mMon = lin.match(reMonto);
    const monto = mMon ? parseMontoReclamo(mMon[0]) : null;

    // 3) Factura: par con guión; si no, número suelto tras "factura/FC"; si no, en tablas,
    //    el entero chico que aparece DESPUÉS del monto (col. "N° de factura").
    let mFac = resto.match(reFactura);
    let nro = mFac ? mFac[1].replace(/\s+/g, "") : "";
    let oc = "";
    if (!nro) {
      const mSuelta = resto.match(/(?:FACTURA|COMPROBANTE|FC|FAC\.?)\s*(?:N[°º:.\s]*)?\s*(\d{2,8})/i);
      if (mSuelta) nro = mSuelta[1];
    }
    if (monto && mMon) {
      const after = lin.slice((mMon.index || 0) + mMon[0].length);
      let before = lin.slice(0, mMon.index || 0);
      if (nro) before = before.replace(nro, " ").replace(nro.replace("-", " "), " "); // no confundir OC con la factura
      // OC / N° de orden: entero de 4-6 dígitos antes del monto, que NO sea un año (20xx/19xx)
      const candOc = (before.match(/\b\d{4,6}\b/g) || []).filter((n) => !/^(19|20)\d{2}$/.test(n) || n.length > 4);
      if (candOc.length) oc = candOc[candOc.length - 1];
      // Si no hubo factura, tomamos el primer entero 2-6 dígitos después del monto que no sea fecha
      if (!nro) {
        const mAfter = after.match(/\b(\d{2,6})\b/);
        if (mAfter && !/\d\s*[/-]\s*\d/.test(after.slice(0, (mAfter.index || 0) + 6))) nro = mAfter[1];
      }
    }

    // 4) Paciente del renglón (tablas anchas): texto en mayúsculas al inicio, antes del 1er número/servicio
    let pacLinea = "";
    const mPacL = lin.match(/^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'.\s]{4,40}?)(?=\s+(?:ENF|KINE|FONO|MED|ENFERMER|KINESIO|\d)|\s{2,})/);
    if (mPacL) pacLinea = mPacL[1].replace(/\s+/g, " ").trim();

    // Renglón válido: importe real + (factura o período)
    if (monto && monto > 100 && (nro || per)) {
      const clave = nro + "|" + per + "|" + monto;
      if (!vistos.has(clave)) {
        vistos.add(clave);
        filas.push({ periodo: per, nroFactura: nro, oc, monto, paciente: pacLinea });
      }
    }
  }

  // Fallback: si no encontré ninguna fila pero sí hay una factura + un período sueltos
  if (filas.length === 0) {
    const mFac = t.match(/(?:FACTURA|COMPROBANTE|COMP\.?|FAC\.?|N[°º]?\s*FC)\s*(?:N[°º:.\s]*)?\s*([\dA-Z]{1,4}\s*-?\s*\d{1,8})/i)
      || t.match(/\b(\d{1,4}\s*-\s*\d{1,8})\b/);
    const nro = mFac ? (mFac[1] || "").replace(/\s+/g, "") : "";
    const per = periodoDesdeTexto(t);
    const mMon = t.match(reMonto);
    if (nro || per || mMon) {
      filas.push({ periodo: per, nroFactura: nro, oc: "", monto: mMon ? parseMontoReclamo(mMon[0]) : null, paciente: "" });
    }
  }

  return { proveedor, oc, paciente, filas };
}

// Vincula un nombre leído del PDF con un paciente del padrón (por tokens compartidos).
function matchearPaciente(nombre, pacientes) {
  const dp = normalizar(nombre || "").split(/\s+/).filter((w) => w.length > 2);
  if (!dp.length) return null;
  let mejor = null, mejorScore = 0;
  for (const p of pacientes) {
    const np = normalizar(p.nombre || "");
    const score = dp.filter((w) => np.includes(w)).length;
    if (score > mejorScore) { mejorScore = score; mejor = p; }
  }
  return mejorScore >= 2 ? mejor : null; // exige al menos 2 tokens en común (apellido+nombre)
}

// Para un renglón (periodo/nroFactura/oc/paciente) busca las facturas cargadas que coinciden.
function matchearFila(fila, datos, facturas) {
  const nf = normalizar(fila.nroFactura).replace(/[^0-9A-Z]/g, "");
  const ocFila = fila.oc || datos.oc || "";
  const pacFila = fila.paciente || datos.paciente || "";
  const scored = facturas.map((f) => {
    let score = 0;
    const fnf = normalizar(f.nroFactura).replace(/[^0-9A-Z]/g, "");
    if (nf && fnf && (fnf === nf || fnf.endsWith(nf) || nf.endsWith(fnf))) score += 5;
    if (ocFila && f.oc && normalizar(f.oc).replace(/[^0-9]/g, "") === normalizar(ocFila).replace(/[^0-9]/g, "")) score += 3;
    if (fila.periodo && f.periodo === fila.periodo) score += 2;
    if (datos.proveedor && f.proveedor === datos.proveedor) score += 1;
    if (pacFila) {
      const dp = normalizar(pacFila).split(" ").filter((w) => w.length > 3);
      if (dp.length && dp.some((w) => normalizar(f.paciente).includes(w))) score += 2;
    }
    return { f, score };
  }).filter((x) => x.score >= 5)   // exige match fuerte de factura, o factura+algo
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.f);
  return scored;
}

/* ============================================================
   MÓDULO: ARMAR EXPEDIENTE DE FACTURACIÓN DE PROVEEDOR
   Circuito de 3 etapas (estilo Gestor): Nota a Auditoría Médica →
   Pase a Asesoría Letrada → Resolución de pago (Autorizar/Convalidar).
   Reutiliza leerTextoArchivo, parseMontoReclamo, normalizar, PROVEEDORES.
   ============================================================ */

const LOGO_PRIS_URL = "https://gestor-expedientes-pris.vercel.app/logo-pris.png";
const LOGO_GOB_URL = "https://gestor-expedientes-pris.vercel.app/logo-gobierno.png";

// Puente de Facturación (genera PDF/Word en el backend, igual que el Gestor).
const PUENTE_FACT_URL = "/api/puente";
const PUENTE_FACT_CLAVE = "FACTURACIONPRIS2026";

// Descarga un archivo base64 devuelto por el Apps Script.
function descargarBase64Fact(b64, nombre, mime) {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Llama al puente y descarga el PDF (y opcionalmente el Word) generados en el backend.
async function generarPorPuenteFact({ titulo, html, htmlWord }) {
  const res = await fetch(PUENTE_FACT_URL, {
    method: "POST",
    body: JSON.stringify({ clave: PUENTE_FACT_CLAVE, accion: "htmlAPdf", titulo, html, htmlWord }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Error en el puente");
  if (data.pdfBase64) descargarBase64Fact(data.pdfBase64, (data.nombreArchivo || titulo) + ".pdf", "application/pdf");
  if (data.docBase64) {
    await new Promise((r) => setTimeout(r, 500));
    descargarBase64Fact(data.docBase64, (data.nombreArchivo || titulo) + (data.docExt || ".doc"), data.docMime || "application/msword");
  }
  return data;
}
const LEYENDA_ANIO = "\u201C2026 A\u00f1o de la Memoria por: Golpe de Estado C\u00edvico Militar de 1976, Cierre Masivo de los Ingenios en 1966 y Cierre de los Talleres Ferroviarios de Taf\u00ed Viejo en 1980\u201D";
const MESES_NOMBRE_MOD = ["", "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const MESES_NUM_MOD = { ENERO: "01", FEBRERO: "02", MARZO: "03", ABRIL: "04", MAYO: "05", JUNIO: "06", JULIO: "07", AGOSTO: "08", SEPTIEMBRE: "09", SETIEMBRE: "09", OCTUBRE: "10", NOVIEMBRE: "11", DICIEMBRE: "12" };

const FIRMANTES_FACT = [
  { id: "castillo", nombre: "C.P.N Mariela Agustina Castillo", cargo: "Gerente Administrativo" },
  { id: "juarez", nombre: "C.P.N. Luc\u00eda Ju\u00e1rez", cargo: "Directora" },
  { id: "bottone", nombre: "Dra. Noelia Bottone", cargo: "Directora" },
];

function fmtPesosFact(n) {
  return "$ " + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ---------- Proveedor (SIVKA => SIAD, NUTRI HOME => NUTRIHOME) ---------- */
function detectarProveedorFact(tn) {
  if (tn.includes("SIVKA") || /\bSIAD\b/.test(tn)) return "SIAD";
  if (tn.includes("NUTRI HOME") || tn.includes("NUTRIHOME")) return "NUTRIHOME";
  for (const p of PROVEEDORES) { if (tn.includes(normalizar(p))) return p; }
  return "";
}

/* ---------- Importes tolerantes a OCR ----------
   Acepta importes con o sin separador de miles (el OCR a veces lo pierde):
   "598.231,30", "598231,30", "$ §98231,30" (limpia símbolos raros pegados al número).
   Exige coma decimal de 2 dígitos para tratarlo como plata (no como DNI/cantidad). */
function _importesEnTexto(t) {
  const out = [];
  // captura opcional $ o basura, dígitos con posibles puntos de miles, coma y 2 decimales
  for (const m of t.matchAll(/(\d{1,3}(?:\.\d{3})+|\d{4,9}),(\d{2,4})\b/g)) {
    const idx = m.index || 0;
    const antes = normalizar(t.slice(Math.max(0, idx - 14), idx));
    if (/DNI|CUIT|CUIL|CAE|CBU|CTA|CUENTA|MOVIMIENTO|VERIFICAC/.test(antes)) continue;
    const dec = m[2].slice(0, 2); // toma solo 2 decimales aunque el OCR ponga 4 (888.231,3000)
    const v = parseMontoReclamo(m[1] + "," + dec);
    if (v != null && v >= 1000) out.push({ val: v, idx });
  }
  return out;
}
function mayorImporteFact(t) {
  const imps = _importesEnTexto(t);
  let max = null;
  for (const x of imps) if (max == null || x.val > max) max = x.val;
  return max;
}

/* ---------- Suma de subtotales de ítems de la factura ---------- */
function sumaItemsFacturaFact(t) {
  const lineas = t.split(/\n+/);
  let suma = 0, n = 0;
  for (const l of lineas) {
    const ln = normalizar(l);
    if (/(SERVICIO|ENFERMER|MEDICO|BOMBA|ALQUILER|VISITA|ALIMENTAC|KINESIO|FONOAUD)/.test(ln)) {
      const imps = _importesEnTexto(l);
      if (imps.length) { suma += imps[imps.length - 1].val; n++; }
    }
  }
  return n ? { suma: Math.round(suma * 100) / 100, n } : null;
}

/* ---------- Candidatos de total (subtotal / importe total / base imponible / suma) ----------
   Busca importes en la MISMA línea o la siguiente a un rótulo de total, tolerando basura
   OCR entre el rótulo y el número. Cruza las fuentes para elegir el más confiable. */
function totalesCandidatosFact(t) {
  const lineas = t.split(/\n+/);
  const cerca = (a, b) => a != null && b != null && Math.abs(a - b) <= 2;
  let subtotal = null, importeTotal = null, baseImp = null, totalGen = null;
  for (let i = 0; i < lineas.length; i++) {
    const ln = normalizar(lineas[i]);
    const zona = lineas[i] + " " + (lineas[i + 1] || "");
    const imps = _importesEnTexto(zona);
    if (!imps.length) continue;
    const primero = imps[0].val;
    if (/SUBTOTAL/.test(ln)) subtotal = primero;
    else if (/IMPORTE\s*TOTAL/.test(ln)) importeTotal = primero;
    else if (/BASE\s*IMPONIBLE/.test(ln)) baseImp = imps[0].val;
    else if (/\bTOTAL\b/.test(ln)) totalGen = primero; // "Total:" de la OC
  }
  const si = sumaItemsFacturaFact(t);
  const sumaItems = si ? si.suma : null;
  const fuentes = [subtotal, importeTotal, baseImp, totalGen, sumaItems].filter((x) => x != null);
  let elegido = null;
  const coincideCon = (v) => fuentes.filter((x) => cerca(x, v)).length >= 2;
  for (const v of [subtotal, importeTotal, baseImp, totalGen, sumaItems]) {
    if (v != null && coincideCon(v)) { elegido = v; break; }
  }
  if (elegido == null) elegido = subtotal != null ? subtotal : (importeTotal != null ? importeTotal : (baseImp != null ? baseImp : (totalGen != null ? totalGen : (sumaItems != null ? sumaItems : mayorImporteFact(t)))));
  return { elegido, subtotal, importeTotal, baseImp, totalGen, sumaItems, items: si ? si.n : 0 };
}

/* ---------- Inferir prestaciones (frase estilo nota) ---------- */
function inferirPrestacionesFact(t) {
  const tn = normalizar(t);
  const partes = [];
  if (/BOMBA/.test(tn) && /(ALIMENTAC|INFUSION|ENTERAL)/.test(tn)) partes.push("Servicio de Alquiler de Bomba de Alimentaci\u00f3n");
  else if (/ALIMENTAC/.test(tn)) partes.push("Servicio de Alimentaci\u00f3n");
  if (/ENFERMER/.test(tn)) partes.push("Servicio de Enfermer\u00eda");
  if (/(VISITA\s*M[\u00c9E]DICA|SERVICIO\s*M[\u00c9E]DICO|\bMEDICO\b)/.test(tn)) partes.push("Visita m\u00e9dica");
  if (/KINESIO/.test(tn)) partes.push("Kinesiolog\u00eda");
  if (/FONOAUD/.test(tn)) partes.push("Fonoaudiolog\u00eda");
  if (!partes.length) return "";
  if (partes.length === 1) return partes[0];
  return partes.slice(0, -1).join("; ") + " y " + partes[partes.length - 1];
}

/* ---------- Extraer datos de la FACTURA del proveedor ---------- */
function extraerFacturaProveedorFact(texto) {
  const t = (texto || "").replace(/\uf020/g, " ");
  const tn = normalizar(t);
  const proveedor = detectarProveedorFact(tn);

  let nroFactura = "";
  let m = t.match(/Comp\.?\s*Nro?\.?\s*:?\s*(\d{6,8})/i);
  if (m) nroFactura = m[1];
  if (!nroFactura) { const m2 = t.match(/\b(\d{4,5}-\d{6,8})\b/); if (m2) nroFactura = m2[1]; }
  const pv = t.match(/Punto\s*de\s*Venta\s*:?\s*0*(\d{1,5})/i);
  if (pv && nroFactura && !nroFactura.includes("-")) {
    const pvNum = pv[1].slice(-4).padStart(4, "0");
    nroFactura = pvNum + "-" + nroFactura.replace(/\D/g, "").slice(-8).padStart(8, "0");
  }

  let periodo = "";
  const mp = t.match(/Desde\s*:?\s*(\d{1,2})\/(\d{1,2})\/(20\d{2})/i);
  if (mp) periodo = `${mp[3]}-${mp[2].padStart(2, "0")}`;
  if (!periodo) {
    const mm = tn.match(/\b(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s*(?:DE\s*)?(20\d{2})/);
    if (mm) periodo = `${mm[2]}-${MESES_NUM_MOD[mm[1]]}`;
  }

  let fechaEmision = "";
  const me = t.match(/Emisi[o\u00f3]n\s*:?\s*(\d{1,2}\/\d{1,2}\/20\d{2})/i);
  if (me) fechaEmision = me[1];

  const cand = totalesCandidatosFact(t);
  const total = cand.elegido;

  let cuit = "";
  const mc = t.match(/CUIT\s*:?\s*(\d{11})/i);
  if (mc) cuit = mc[1];

  let paciente = "", dni = "";
  const mpac = t.match(/paciente\s+([A-Za-z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]+(?:\s+[A-Za-z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]+){1,3})\s+DNI\s*:?\s*([\d.]+)/i);
  if (mpac) { paciente = mpac[1].replace(/\s+/g, " ").trim(); dni = mpac[2].replace(/\./g, ""); }

  const prestaciones = inferirPrestacionesFact(t);
  return { tipo: "factura", proveedor, nroFactura, periodo, fechaEmision, total, cuit, paciente, dni, prestaciones, _cand: cand };
}

/* ---------- Extraer datos de la ORDEN DE COMPRA ---------- */
function extraerOrdenCompraFact(texto) {
  const t = (texto || "").replace(/\uf020/g, " ");
  const tn = normalizar(t);
  const proveedor = detectarProveedorFact(tn);

  // Nº de OC. En el escaneo suele venir "ORDEN DE COMPRA" y en un renglón aparte
  // "N°/Nro/No: 17794" (a veces con basura de OCR delante). Ampliamos la ventana y
  // aceptamos "N", "No", "Nro", "N°". También probamos "Orden De Compra: 17794" que
  // aparece en la hoja de sellos. Evita CUIT (11), expediente y años sueltos.
  let oc = "";
  const i = tn.indexOf("ORDEN DE COMPRA");
  const desdeOC = i >= 0 ? t.slice(i, i + 260) : t;
  let m = desdeOC.match(/N[roº°\.]*\s*:?\s*(\d{4,6})\b/i);
  if (!m) m = t.match(/Orden\s*De\s*Compra\s*:?\s*(\d{4,6})\b/i); // hoja de sellos
  if (!m && i >= 0) {
    // primer número de 4-6 dígitos tras el rótulo que NO sea año ni parte de un CUIT/expte
    for (const mm of desdeOC.matchAll(/\b(\d{4,6})\b/g)) {
      const num = mm[1];
      if (/^20\d{2}$/.test(num)) continue;               // año
      const ctx = desdeOC.slice(Math.max(0, (mm.index || 0) - 3), (mm.index || 0) + num.length + 2);
      if (/[\/]/.test(ctx)) continue;                     // parte de expediente
      oc = num; break;
    }
  }
  if (!oc && m) oc = m[1];

  // Expediente cabecera. Está en la "Observación" de la OC: "EXPTE 1993/415/G/2025".
  // Buscamos primero dentro de la Observación (donde siempre está), tolerando ruido de
  // OCR alrededor de las barras (espacios, comas, guiones). Después, respaldos globales.
  let expteCabecera = "";
  const sep = "[\\s.,\\-\\/]+"; // el OCR mete cualquier cosa entre los tramos
  const patronExpte = new RegExp("(\\d{2,5})" + sep + "(\\d{2,4})" + sep + "([A-Z]{1,3})" + sep + "(20\\d{2})", "i");
  // 1) dentro de la Observación (la fuente confiable)
  const mObs = t.match(/OBSERVACI[O\u00d3]N\s*:?\s*([\s\S]{0,200})/i);
  if (mObs) {
    const mc0 = mObs[1].match(patronExpte);
    if (mc0) expteCabecera = `${mc0[1]}/${mc0[2]}/${mc0[3].toUpperCase()}/${mc0[4]}`;
  }
  // 2) tras la palabra EXPTE/EXPEDIENTE en cualquier lado
  if (!expteCabecera) {
    const mc = t.match(new RegExp("(?:EXPTE|EXPEDIENTE)\\s*N?[\u00b0\u00ba\u00aa]?\\s*:?\\s*" + patronExpte.source, "i"));
    if (mc) expteCabecera = `${mc[1]}/${mc[2]}/${mc[3].toUpperCase()}/${mc[4]}`;
  }
  // 3) cualquier patrón NNNN/NNN/L/AAAA en el texto
  if (!expteCabecera) {
    const mc = t.match(patronExpte);
    if (mc) expteCabecera = `${mc[1]}/${mc[2]}/${mc[3].toUpperCase()}/${mc[4]}`;
  }
  // 4) formato con la letra al final: "1993/415/2025/G" (como en el Tribunal)
  if (!expteCabecera) {
    const mc2 = t.match(new RegExp("(\\d{3,5})" + sep + "(\\d{2,4})" + sep + "(20\\d{2})" + sep + "([A-Z]{1,3})"));
    if (mc2) expteCabecera = `${mc2[1]}/${mc2[2]}/${mc2[4].toUpperCase()}/${mc2[3]}`;
  }

  let paciente = "";
  const mpac = t.match(/PACIENTE\s*:?\s*([A-Za-z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1 ,]+?)(?=\s+(?:SOLICITA|DNI|DEPENDENCIA|DIAGN|INTERNACION|SERVICIO)|\n|$)/i);
  if (mpac) {
    let cand = mpac[1].replace(/,/g, " ").replace(/\s+/g, " ").trim();
    paciente = cand.split(" ").slice(0, 4).join(" ");
  }

  // Total de la OC: hay que tomarlo de la ZONA de la orden de compra, no de la factura
  // (pueden diferir: la factura puede ser menor que la OC). Buscamos el "Total:" o el
  // renglón "Son pesos: ... pesos con" dentro del bloque de la OC.
  let total = null;
  if (i >= 0) {
    const zonaOC = t.slice(i, i + 1400);
    // 1) "Total: $ 3.062.000,3000" (el importe grande tras la palabra Total)
    const mTot = zonaOC.match(/TOTAL\s*:?\s*\$?\s*([\d.\s]{6,}[,.]?\d{0,4})/i);
    if (mTot) {
      let crudo = mTot[1].replace(/\s/g, "");
      // La OC del sistema pone 4 decimales ("598.231,3000" = $598.231,30). Recortamos a
      // 2 decimales para no perder los centavos ni arrastrar los ceros de más.
      crudo = crudo.replace(/(,\d{2})\d{1,2}\b/, "$1");
      const n = parseMontoReclamo(crudo);
      if (n && n > 1000) total = n;
    }
    // 2) respaldo: candidatos dentro de la zona OC
    if (total == null) {
      const cand = totalesCandidatosFact(zonaOC);
      total = cand.elegido;
    }
  }
  if (total == null) {
    const cand = totalesCandidatosFact(t);
    total = cand.elegido;
  }
  const prestaciones = inferirPrestacionesFact(t);
  return { tipo: "oc", proveedor, oc, expteCabecera, total, paciente, prestaciones };
}

/* ---------- Veredicto (factura ≤ OC, factura = sistema, OC ≥ sistema) ---------- */
/* ---------- Extraer datos del paciente del PRESUPUESTO (opcional) ----------
   El presupuesto del proveedor, cuando viene, suele traer nombre/DNI/domicilio del
   paciente más claros que la factura. Se usa como fuente adicional de respaldo. */
function extraerPresupuestoFact(texto) {
  const t = (texto || "").replace(/\uf020/g, " ");
  const tn = normalizar(t);
  const hayPresupuesto = /PRESUPUESTO|PROFORMA|COTIZACI[O\u00d3]N/.test(tn);
  let paciente = "", dni = "", domicilio = "";
  // Paciente: tras "PACIENTE:" o "Sr./Sra.", cortando en palabras clave
  const mpac = t.match(/(?:PACIENTE|AFILIADO|BENEFICIARIO|Sr\.?|Sra\.?)\s*:?\s*([A-Za-z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1 ,]+?)(?=\s+(?:DNI|D\.N\.I|DOMICILIO|DIAGN|OBRA|OS|SOLICITA|EDAD)|\n|$)/i);
  if (mpac) paciente = mpac[1].replace(/,/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ");
  const mdni = t.match(/(?:DNI|D\.N\.I\.?)\s*:?\s*([\d.]{7,12})/i);
  if (mdni) dni = mdni[1].replace(/\./g, "");
  const mdom = t.match(/(?:DOMICILIO|DIRECCI[O\u00d3]N)\s*(?:PARTICULAR|DEL PACIENTE)?\s*:?\s*([^\n]{5,70})/i);
  if (mdom && !/COMERCIAL|MAIPU|PISO|DPTO/i.test(mdom[1])) domicilio = mdom[1].trim();
  return { hayPresupuesto, paciente, dni, domicilio };
}

/* ---------- Detectar PLANILLAS de prestaciones y compararlas con la factura ----------
   Realista con lo que el OCR puede: las planillas son manuscritas, así que NO se
   "leen" las firmas ni se cuentan días con exactitud. Lo que sí se hace:
   - detectar que la planilla existe (encabezados SIAD / "control de asistencia" / remito),
   - identificar qué disciplinas aparecen (enfermería, especialista, remito de materiales),
   - dejar el conteo fino y la validación de firmas al control manual del usuario. */
function detectarPlanillasFact(texto) {
  const tn = normalizar(texto || "");
  const planillas = [];
  if (/CONTROL DE ASISTENCIA/.test(tn) && /ENFERMER/.test(tn)) planillas.push("Enfermería (asistencia diaria)");
  if (/CONTROL DE ASISTENCIA/.test(tn) && /ESPECIALISTA/.test(tn)) planillas.push("Especialista (asistencia diaria)");
  if (/REMITO DE ENTREGA/.test(tn) || /REMITO/.test(tn)) planillas.push("Remito de entrega de materiales");
  if (/CONTROL DE ASISTENCIA/.test(tn) && /(KINESIO|MOTORA|RESPIRATORIA)/.test(tn)) planillas.push("Kinesiología (asistencia diaria)");
  if (/CONTROL DE ASISTENCIA/.test(tn) && /FONOAUD/.test(tn)) planillas.push("Fonoaudiología (asistencia diaria)");
  const hayFirma = /(FIRMA\s*(Y\s*SELLO|FAMILIAR|ESPECIALISTA)|SELLO)/.test(tn);
  return { hay: planillas.length > 0, planillas, hayIndicioFirma: hayFirma };
}

/* ---------- Conteo ESTIMADO de días marcados en una planilla manuscrita ----------
   ⚠️ Las planillas son manuscritas: este conteo es APROXIMADO y poco confiable (el OCR
   no lee bien la escritura a mano). Cuenta cuántos renglones de día parecen tener una
   fecha cargada (patrón dd/mm o dd-mm). Sirve como pista, NUNCA como dato firme; el
   usuario siempre debe verificar a ojo. */
function contarDiasPlanillaFact(texto) {
  // Busca el bloque de la planilla de enfermería (la que se factura por día)
  const tn = normalizar(texto || "");
  const iEnf = tn.indexOf("CONTROL DE ASISTENCIA");
  const zona = iEnf >= 0 ? texto.slice(iEnf, iEnf + 1500) : texto;
  // fechas tipo "01/6/26", "04/06/26", "8/06/26" (día/mes con o sin año corto)
  const fechas = zona.match(/\b\d{1,2}\s*[\/\-]\s*\d{1,2}(?:\s*[\/\-]\s*\d{2,4})?\b/g) || [];
  // filtramos las que parecen día de mes (día 1-31, mes 1-12)
  let n = 0;
  const vistos = {};
  for (const f of fechas) {
    const m = f.match(/(\d{1,2})\s*[\/\-]\s*(\d{1,2})/);
    if (!m) continue;
    const d = parseInt(m[1], 10), mes = parseInt(m[2], 10);
    if (d >= 1 && d <= 31 && mes >= 1 && mes <= 12) {
      const clave = d + "-" + mes;
      if (!vistos[clave]) { vistos[clave] = 1; n++; }
    }
  }
  return n; // 0 si no pudo contar
}

/* ---------- Cantidades facturadas por disciplina (para cruzar con planillas) ---------- */
function cantidadesFacturadasFact(texto) {
  const lineas = (texto || "").split(/\n+/);
  const res = {};
  for (const l of lineas) {
    const ln = normalizar(l);
    const disc = /ENFERMER/.test(ln) ? "Enfermería" : /FONOAUD/.test(ln) ? "Fonoaudiología"
      : /KINESIO/.test(ln) ? "Kinesiología" : /(VISITA MEDICA|MEDICO)/.test(ln) ? "Médico"
      : /(BOMBA|ALIMENTAC|INFUSION)/.test(ln) ? "Alimentación" : null;
    if (!disc) continue;
    const mc = l.match(/(\d{1,3})(?:,\d{2})?\s*unidad/i) || l.match(/^\s*\d+\s+[^\d]*?(\d{1,3})\b/);
    if (mc && res[disc] == null) res[disc] = parseInt(mc[1], 10);
  }
  return res;
}

/* ---------- Cruce cantidad facturada (enfermería) vs días contados en la planilla ----------
   OJO con las UNIDADES: enfermería suele facturarse por HORAS (ej. 360 = 12h × 30 días),
   no por días. Por eso:
   - Si lo facturado parece "días" (≤ 31), comparamos directo contra los días contados.
   - Si parece "horas" (> 31), NO comparamos número contra número (sería erróneo); solo
     informamos los días contados como referencia y avisamos que la unidad es horas.
   El conteo de planilla es MANUSCRITO y aproximado: nunca bloquea, solo orienta. */
function cruzarPlanillaVsFacturaFact(texto, cantFacturadas) {
  const facturado = cantFacturadas && cantFacturadas["Enfermería"] != null ? cantFacturadas["Enfermería"] : null;
  const contado = contarDiasPlanillaFact(texto);
  if (facturado == null || !contado) return null;
  const esHoras = facturado > 31; // más de 31 no pueden ser días de un mes → son horas
  if (esHoras) {
    return { hay: true, unidad: "horas", facturado, contado, comparable: false };
  }
  return { hay: true, unidad: "dias", facturado, contado, comparable: true, coincide: Math.abs(facturado - contado) === 0 };
}

/* ---------- Veredicto ampliado ---------- */
function calcularVeredictoFact({ facturaPdf, ocPdf, facturaSistema, planillas, planillasOkManual, cruce }) {
  const checks = [];
  const fPdf = facturaPdf && facturaPdf.total != null ? facturaPdf.total : null;
  const oPdf = ocPdf && ocPdf.total != null ? ocPdf.total : null;
  const fSis = facturaSistema && facturaSistema.monto != null ? facturaSistema.monto : null;
  const cerca = (a, b, tol = 1) => a != null && b != null && Math.abs(a - b) <= tol;

  if (fPdf != null && oPdf != null) {
    if (fPdf <= oPdf + 1) {
      checks.push({ ok: true, regla: "Factura \u2264 Orden de Compra", detalle: cerca(fPdf, oPdf) ? "Coinciden exactamente." : `Factura menor a la OC (posible prestaci\u00f3n parcial): ${fmtPesosFact(fPdf)} de ${fmtPesosFact(oPdf)}.`, parcial: !cerca(fPdf, oPdf) });
    } else {
      checks.push({ ok: false, regla: "Factura \u2264 Orden de Compra", detalle: `La factura (${fmtPesosFact(fPdf)}) SUPERA la OC (${fmtPesosFact(oPdf)}). No puede ser mayor.` });
    }
  } else checks.push({ ok: null, regla: "Factura \u2264 Orden de Compra", detalle: "Falta el total de la factura o de la OC (completalos arriba)." });

  if (fPdf != null && fSis != null) {
    checks.push(cerca(fPdf, fSis)
      ? { ok: true, regla: "Factura PDF = sistema", detalle: "El monto del PDF coincide con la factura del sistema." }
      : { ok: false, regla: "Factura PDF = sistema", detalle: `No coincide: PDF ${fmtPesosFact(fPdf)} vs sistema ${fmtPesosFact(fSis)}.` });
  } else checks.push({ ok: null, regla: "Factura PDF = sistema", detalle: "No hay factura del sistema vinculada para comparar." });

  if (oPdf != null && fSis != null) {
    checks.push(oPdf + 1 >= fSis
      ? { ok: true, regla: "OC PDF \u2265 factura sistema", detalle: "La OC del PDF cubre el monto del sistema." }
      : { ok: false, regla: "OC PDF \u2265 factura sistema", detalle: `La OC (${fmtPesosFact(oPdf)}) es menor al monto del sistema (${fmtPesosFact(fSis)}).` });
  } else checks.push({ ok: null, regla: "OC PDF \u2265 factura sistema", detalle: "Falta dato para comparar OC contra el sistema." });

  // Planillas de prestaciones: detección + confirmación manual del usuario.
  if (planillas && planillas.hay) {
    checks.push({ ok: true, regla: "Planillas presentes", detalle: `Detecté: ${planillas.planillas.join(", ")}.` + (planillas.hayIndicioFirma ? " Se ven campos de firma/sello." : "") });
  } else {
    checks.push({ ok: null, regla: "Planillas presentes", detalle: "No detecté planillas de prestaciones en el PDF (verificá que estén incluidas)." });
  }
  // La validación fina (firmadas y acordes a la factura) la confirma el usuario.
  checks.push(planillasOkManual
    ? { ok: true, regla: "Planillas firmadas y acordes", detalle: "Confirmado manualmente." }
    : { ok: false, regla: "Planillas firmadas y acordes", detalle: "Falta tu confirmación: verificá que las planillas estén firmadas y sean acordes a la factura." });

  // Cruce ESTIMADO: días de planilla vs cantidad facturada (enfermería).
  // Si la unidad facturada son horas, no es comparable número a número: solo informa.
  if (cruce && cruce.hay) {
    if (!cruce.comparable) {
      checks.push({ ok: null, regla: "Planilla (enfermería)", detalle: `Se facturaron ${cruce.facturado} (horas) y conté ~${cruce.contado} días en la planilla (estimado). Verificá a ojo que los días trabajados × horas por día coincidan con lo facturado.` });
    } else if (cruce.coincide) {
      checks.push({ ok: true, regla: "Planilla vs factura (enfermería)", detalle: `Coinciden: ${cruce.facturado} facturadas y ~${cruce.contado} en la planilla (conteo estimado).` });
    } else {
      checks.push({ ok: null, regla: "Planilla vs factura (enfermería)", detalle: `⚠️ ALERTA: se facturaron ${cruce.facturado} pero conté ~${cruce.contado} días en la planilla (estimado). Verificá a ojo; si realmente no coinciden, pedí la nota de justificación del proveedor.` });
    }
  }

  const hayError = checks.some((c) => c.ok === false);
  const todoOk = checks.every((c) => c.ok === true);
  return { veredicto: hayError ? "error" : todoOk ? "ok" : "revisar", checks };
}

/* ---------- Número a letras (pesos) ---------- */
function _centenasALetrasFact(n) {
  const u = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
    "once", "doce", "trece", "catorce", "quince", "diecis\u00e9is", "diecisiete", "dieciocho", "diecinueve", "veinte",
    "veintiuno", "veintid\u00f3s", "veintitr\u00e9s", "veinticuatro", "veinticinco", "veintis\u00e9is", "veintisiete", "veintiocho", "veintinueve"];
  const d = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
  const c = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
  if (n === 0) return "";
  if (n === 100) return "cien";
  let out = "";
  const cen = Math.floor(n / 100), resto = n % 100;
  if (cen) out += c[cen] + (resto ? " " : "");
  if (resto < 30) out += u[resto];
  else { const dec = Math.floor(resto / 10), un = resto % 10; out += d[dec] + (un ? " y " + u[un] : ""); }
  return out.trim();
}
function _enteroALetrasFact(n) {
  n = Math.floor(n);
  if (n === 0) return "cero";
  if (n < 0) return "menos " + _enteroALetrasFact(-n);
  const millones = Math.floor(n / 1000000);
  const miles = Math.floor((n % 1000000) / 1000);
  const resto = n % 1000;
  const partes = [];
  if (millones) partes.push(millones === 1 ? "un mill\u00f3n" : _centenasALetrasFact(millones).replace(/uno$/, "un") + " millones");
  if (miles) partes.push(miles === 1 ? "mil" : _centenasALetrasFact(miles).replace(/uno$/, "un") + " mil");
  if (resto) partes.push(_centenasALetrasFact(resto));
  return partes.join(" ").replace(/\s+/g, " ").trim();
}
function montoALetrasPesosFact(monto) {
  const num = Math.round(Number(monto || 0) * 100) / 100;
  const entero = Math.floor(num);
  const cent = Math.round((num - entero) * 100);
  let letras = _enteroALetrasFact(entero).replace(/\buno$/, "un");
  const cc = String(cent).padStart(2, "0");
  const cap = letras.charAt(0).toUpperCase() + letras.slice(1);
  return `${cap} pesos con ${cc}/100`;
}

/* ---------- Helpers de fecha / formato para las notas ---------- */
function periodoALargoFact(periodo) {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo || "");
  if (!m) return { mes: "", anio: "" };
  return { mes: MESES_NOMBRE_MOD[parseInt(m[2], 10)] || "", anio: m[1] };
}
function fechaLargaFact(d) {
  d = d || new Date();
  const mes = MESES_NOMBRE_MOD[d.getMonth() + 1];
  const mesCap = mes.charAt(0) + mes.slice(1).toLowerCase();
  return `${d.getDate()} de ${mesCap} de ${d.getFullYear()}`;
}
function dniConPuntosFact(dni) {
  const s = String(dni || "").replace(/\D/g, "");
  return s ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "";
}

/* ---------- Formato de documentos calcado del Gestor de Expedientes ----------
   Encabezado con tabla de logos, línea azul, Times New Roman 12pt, pie con la leyenda
   del año. Las plantillas devuelven { titulo, css, body } y se muestran en una vista
   previa EDITABLE antes de generar PDF/Word (igual que en el Gestor). */
const AZUL_FACT = "#5B9BD5";
const PIE_ANIO_FACT = "\u201C2026 A\u00f1o de la Memoria por: Golpe de Estado C\u00edvico Militar de 1976, Cierre Masivo de los Ingenios en 1966 y Cierre de los Talleres Ferroviarios de Taf\u00ed Viejo en 1980\u201D";

function escFact(t) {
  return String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function encabezadoDocFact() {
  return (
    '<table style="width:100%; border-collapse:collapse; margin-bottom:4pt;"><tr>' +
    '<td style="vertical-align:middle; border:none; padding:0;"><img src="' + LOGO_PRIS_URL + '" style="height:34pt;"></td>' +
    '<td style="vertical-align:middle; text-align:right; border:none; padding:0;"><img src="' + LOGO_GOB_URL + '" style="height:44pt;"></td>' +
    "</tr></table>" +
    '<div style="border-bottom:2.2pt solid ' + AZUL_FACT + '; margin-bottom:6pt;"></div>'
  );
}
const lineaAzulDocFact = (m) => '<div style="border-bottom:2.2pt solid ' + AZUL_FACT + '; margin-top:' + m + 'pt; margin-bottom:6pt;"></div>';
const envolverHtmlFact = (css, body) =>
  '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
  "@page { size: A4; margin: 0; } body { margin:0; padding:0; } .pagina { page-break-after: always; } .pagina.ultima { page-break-after: auto; } " +
  css + "</style></head><body>" + body + "</body></html>";

const firmaBloqueFact = (f) => {
  const fir = FIRMANTES_FACT.find((x) => x.id === f) || FIRMANTES_FACT[0];
  return '<p style="margin-left:5pt; margin-top:34pt; line-height:1.5; font-weight:bold;">Firmado digitalmente:<br>' +
    escFact(fir.nombre) + "<br>" + escFact(fir.cargo) + "<br>Direcci\u00f3n Gral. Prog. Integrado de Salud<br>SI.PRO.SA</p>";
};

/* ---------- 1) NOTA DE PASE A AUDITORÍA MÉDICA ---------- */
function plantillaNotaAuditoria(d) {
  const { mes, anio } = periodoALargoFact(d.periodo);
  const presta = (d.prestaciones && d.prestaciones.trim()) ? d.prestaciones.trim()
    : "Servicio de Alquiler de Bomba de Alimentaci\u00f3n; Servicio de Enfermer\u00eda y Visita m\u00e9dica";
  const expte = (d.expteCabecera && d.expteCabecera.trim()) ? escFact(d.expteCabecera.trim()) : "________________";
  const css =
    ".hoja { font-family:'Times New Roman', Times, serif; font-size:12pt; color:#000; } " +
    ".hoja .pagina { padding: 26pt 79pt 30pt 80pt; } .hoja p { margin:0; }";
  const body =
    '<div class="pagina ultima">' +
    encabezadoDocFact() +
    '<p style="margin-left:176pt; margin-top:14pt;">San Miguel de Tucum\u00e1n, ' + escFact(d.fechaLarga) + "</p>" +
    '<p style="margin-left:5pt; margin-top:22pt; line-height:1.5; font-weight:bold;">A la Jefa del Departamento<br>De Auditoria M\u00e9dica<br>Farm. Mar\u00eda Gabriela Policelli<br><span style="border-bottom:1.5pt solid #000;">Presente</span></p>' +
    '<p style="text-align:justify; text-indent:135pt; margin-left:5pt; line-height:1.5; margin-top:16pt;">' +
    "Me dirijo a Usted a fin de solicitar intervenci\u00f3n de competencia referente a las prestaciones brindadas al paciente; <b>" +
    escFact(d.paciente) + " DNI: " + dniConPuntosFact(d.dni) + "</b>, por el mes de <b>" + mes + " del a\u00f1o " + anio + "</b>. " +
    "Dicha prestaci\u00f3n corresponde a " + escFact(presta) + " que fue solicitada mediante en Expediente N\u00ba <b>" + expte + "</b>. " +
    "Una vez autorizado por el Departamento de Auditoria Medica, se realizar\u00e1 la convalidaci\u00f3n de las prestaciones del mes de <b>" +
    mes + " del a\u00f1o " + anio + "</b> y se proceder\u00e1 al control de ley correspondiente del Honorable Tribunal de Cuentas.</p>" +
    '<p style="margin-left:145pt; margin-top:22pt;">Sin otro particular, saludo a Ud. atentamente.</p>' +
    firmaBloqueFact(d.firmante) +
    lineaAzulDocFact(12) +
    '<p style="font-size:10pt; line-height:1.2; text-align:justify;">' + PIE_ANIO_FACT + "</p>" +
    "</div>";
  return { titulo: "PASE AUDITORIA " + (d.paciente || "").toUpperCase().replace(/\s+/g, "_") + "_" + mes + "_" + anio, css, body };
}

/* ---------- 2) PASE A ASESORÍA LETRADA ---------- */
function plantillaPaseAsesoria(d) {
  const css =
    ".hoja { font-family:'Times New Roman', Times, serif; font-size:12pt; color:#000; } " +
    ".hoja .pagina { padding: 26pt 79pt 30pt 80pt; } .hoja p { margin:0; }";
  const body =
    '<div class="pagina ultima">' +
    encabezadoDocFact() +
    '<p style="margin-left:176pt; margin-top:14pt;">San Miguel de Tucum\u00e1n, ' + escFact(d.fechaMesAnio) + "</p>" +
    '<p style="margin-left:5pt; margin-top:22pt; line-height:1.5;">A Asesor\u00eda Letrada<br>Presente<br>S/D</p>' +
    '<p style="text-align:justify; text-indent:135pt; margin-left:5pt; line-height:1.5; margin-top:20pt;">' +
    "Elevo documentaci\u00f3n para su intervenci\u00f3n de competencia; dicho gasto ser\u00e1 imputado con cargo al presupuesto " + escFact(d.anio) + ".</p>" +
    '<p style="text-align:justify; text-indent:135pt; margin-left:5pt; line-height:1.5; margin-top:6pt;">Cumplido vuelva para prosecuci\u00f3n de tr\u00e1mite.</p>' +
    '<p style="margin-left:145pt; margin-top:22pt;">Sin otro particular, saludo a Ud. atte.-</p>' +
    firmaBloqueFact(d.firmante) +
    lineaAzulDocFact(12) +
    '<p style="font-size:10pt; line-height:1.2; text-align:justify;">' + PIE_ANIO_FACT + "</p>" +
    "</div>";
  return { titulo: "PASE ASESORIA LETRADA " + escFact(d.fechaMesAnio).replace(/\s+/g, "_"), css, body };
}

/* ---------- 3) RESOLUCIÓN DE PAGO (Autorizar / Convalidar) ---------- */
function plantillaResolucionPago(d) {
  const verbo = (d.accion || "AUTORIZAR").toUpperCase() === "CONVALIDAR" ? "Convalidar" : "Autorizar";
  const { mes, anio } = periodoALargoFact(d.periodo);
  const letras = montoALetrasPesosFact(d.importe);
  const modTexto = d.moduloTexto || "Internaci\u00f3n Domiciliaria";
  const prestaVisto = (d.prestacionesVisto && d.prestacionesVisto.trim()) ? d.prestacionesVisto.trim() : (modTexto + " para el paciente");
  const expte = (d.expteCabecera && d.expteCabecera.trim()) ? escFact(d.expteCabecera.trim()) : "________________";
  const imp = fmtPesosFact(d.importe);
  const css =
    ".hoja { font-family:'Times New Roman', Times, serif; font-size:12pt; color:#000; } " +
    ".hoja .pagina { padding: 26pt 70pt 30pt 70pt; } .hoja p { margin:0 0 6pt 0; } " +
    ".hoja table.det { border-collapse:collapse; width:100%; margin:8pt 0; } " +
    ".hoja table.det td, .hoja table.det th { border:1pt solid #000; padding:4pt 7pt; text-align:left; font-size:11pt; }";
  const body =
    '<div class="pagina ultima">' +
    encabezadoDocFact() +
    '<p style="text-align:right; margin-top:10pt;">San Miguel de Tucum\u00e1n, ' + escFact(d.fechaLarga) + "</p>" +
    '<p style="text-align:center; font-weight:bold; margin-top:12pt;">Resoluci\u00f3n Interna: N\u00ba ' + escFact(d.nroResolucion || "____") + "/DGPRIS</p>" +
    '<p style="text-align:center; font-weight:bold;">PROGRAMA INTEGRADO DE SALUD</p>' +
    '<p style="text-align:justify; margin-top:10pt;"><b><span style="text-decoration:underline;">VISTO:</span></b> El Expediente N\u00b0 <b>' + expte + "</b>, en el que se solicit\u00f3 las prestaciones brindadas de Internaci\u00f3n Domiciliaria, en la cual incluye " + escFact(prestaVisto) + " <b>" + escFact(d.paciente) + "</b> Y,</p>" +
    '<p style="text-align:justify;"><b><span style="text-decoration:underline;">CONSIDERANDO:</span></b></p>' +
    '<p style="text-align:justify; text-indent:70pt;">Que se solicit\u00f3 las prestaciones brindadas de Internaci\u00f3n Domiciliaria, en la cual incluye ' + escFact(modTexto) + " para el paciente <b>" + escFact(d.paciente) + "</b>. -</p>" +
    '<p style="text-align:justify; text-indent:70pt;">Que a fs ' + escFact(d.fs_auditoria || "03") + " obra Informe de Auditor\u00eda M\u00e9dica, autorizando las prestaciones de internaci\u00f3n domiciliaria.</p>" +
    '<p style="text-align:justify; text-indent:70pt;">Que a fs ' + escFact(d.fs_tribunal || "06") + " se adjunta intervenci\u00f3n Honorable Tribunal de Cuenta</p>" +
    '<p style="text-align:justify; text-indent:70pt;">Que a fs. ' + escFact(d.fs_factura || "07") + " se adjunta <b>Factura N\u00ba " + escFact(d.nroFactura) + "</b> del proveedor adjudicado, Siad (SIVKA), correspondiente al mes de " + mes + " " + anio + ".</p>" +
    '<p style="text-align:justify; text-indent:70pt;">Que a fs. ' + escFact(d.fs_oc || "08") + " se adjunta <b>Orden de Compra N\u00ba " + escFact(d.oc) + "</b>.</p>" +
    '<p style="text-align:justify; text-indent:70pt;">Que a fs. ' + escFact(d.fs_control || "13") + " se adjunta Control de Asistencia Diaria / remito, correspondiente al mes de <b>" + mes + " " + anio + ".</b></p>" +
    '<p style="text-align:justify; text-indent:70pt;">Que obra informe jur\u00eddico favorable a la contrataci\u00f3n.</p>' +
    '<p style="text-align:justify; text-indent:70pt;">Que, por lo expuesto, no existen objeciones legales que formular para que la Gerencia Administrativa Contable del Programa Integrado de Salud, en virtud de razones de urgencia invocadas, contrate con la firma <b>SIAD (SIVKA)</b>., la adquisici\u00f3n del servicio de Internaci\u00f3n Domiciliaria, bajo la figura de Contrataci\u00f3n Directa de conformidad a lo normado por la Res. N\u00b0388/SPS/-05.</p>' +
    '<p style="text-align:center; font-weight:bold; margin-top:8pt;">POR ELLO:<br>LA GERENCIA ADMINISTRATIVA CONTAB.LE<br>DEL PROGRAMA INTEGRADO DE SALUD.<br><span style="text-decoration:underline;">RESUELVE:</span></p>' +
    '<p style="text-align:justify;"><b>ARTICULO 1\u00ba)</b> ' + verbo + " los Gastos de Contrataci\u00f3n Directa de conformidad a lo normado por la Res. N\u00b0 388/SPS-05, a la firma Siad <b>(SIVKA)</b>. por un monto total <b>" + imp + " (" + letras + ")</b> seg\u00fan el siguiente detalle:</p>" +
    '<table class="det"><tr><th>EXPEDIENTE</th><th>PACIENTE</th><th>FACTURAS</th><th>IMPORTES</th></tr>' +
    "<tr><td>" + expte + "</td><td>" + escFact((d.paciente || "").toUpperCase()) + "</td><td>" + escFact(d.nroFactura) + "</td><td>" + imp + "</td></tr></table>" +
    '<p style="text-align:justify;"><b>ARTICULO 2\u00ba) Aprobar</b> el pago de la <b>Factura N\u00ba ' + escFact(d.nroFactura) + "</b> por un monto de total <b>" + imp + " (" + letras + ")</b> al proveedor Siad <b>(SIVKA)</b> por el servicio de " + escFact(modTexto) + ", correspondiente al mes de " + mes + " " + anio + ".</p>" +
    '<p style="text-align:justify;"><b>ARTICULO 3\u00ba)</b> Que dicha erogaci\u00f3n ser\u00e1 afrontada con el fondo de funcionamiento provisto por la Tesorer\u00eda General del Si.Pro.Sa. con cargo al presupuesto del a\u00f1o ' + anio + ".</p>" +
    '<p style="text-align:justify;"><b>ARTICULO 4\u00b0)</b> Imputar la suma total <b>' + imp + " (" + letras + ")</b> a Jurisdicci\u00f3n 67-Unid. Org. 965- Recurso 10 - Finalidad/Funci\u00f3n 314 Programa 19- Actividad 01 \u2013 Partida 300- <b>Subpartida " + escFact(d.subpartida) + "</b> con cargo al presupuesto del a\u00f1o " + anio + ".</p>" +
    '<p style="text-align:justify;"><b>ARTICULO 5\u00ba)</b> Pase a control pertinente del Honorable Tribunal de Cuentas en el Si.Pro.Sa.</p>' +
    '<p style="text-align:justify;"><b>ARTICULO 6\u00b0)</b> Comunicar y archivar. -</p>' +
    firmaBloqueFact(d.firmante) +
    lineaAzulDocFact(12) +
    '<p style="font-size:10pt; line-height:1.2; text-align:justify;">' + PIE_ANIO_FACT + "</p>" +
    "</div>";
  return { titulo: "RESOLUCION PAGO " + escFact(d.nroResolucion || "") + " " + (d.paciente || "").toUpperCase().replace(/\s+/g, "_"), css, body };
}

/* ---------- Generar PDF/Word desde una plantilla, vía el puente (backend) ----------
   Igual que el Gestor: el HTML se manda al Apps Script que devuelve el PDF (y el Word)
   ya generados. Si el backend fallara, cae al método de impresión del navegador. */
async function generarDocFact(plantilla, bodyEditado, { conWord }) {
  const cuerpo = '<div class="hoja">' + (bodyEditado != null ? bodyEditado : plantilla.body) + "</div>";
  const html = envolverHtmlFact(plantilla.css, cuerpo);
  const htmlWord = conWord ? envolverHtmlFact(plantilla.css, cuerpo) : undefined;
  await generarPorPuenteFact({ titulo: plantilla.titulo || "documento", html, htmlWord });
}
// Respaldo: impresión del navegador (por si el puente no está disponible).
function imprimirNavegadorFact(plantilla, bodyEditado) {
  const html = envolverHtmlFact(plantilla.css, '<div class="hoja">' + (bodyEditado != null ? bodyEditado : plantilla.body) + "</div>");
  const w = window.open("", "_blank");
  if (!w) { alert("Habilit\u00e1 las ventanas emergentes para generar el PDF."); return; }
  w.document.open(); w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 500);
}

/* ---------- Vista previa EDITABLE (calcada del Gestor) ----------
   Muestra la hoja tal como saldrá, editable in-situ; el usuario corrige lo que haga
   falta y recién ahí genera PDF o Word. */
function VistaPreviaFact({ plantilla, onCerrar }) {
  const hojaRef = React.useRef(null);
  const [ocupado, setOcupado] = React.useState(false);
  const [err, setErr] = React.useState("");
  if (!plantilla) return null;
  const bodyActual = () => (hojaRef.current ? hojaRef.current.innerHTML : plantilla.body);

  const generar = async (conWord) => {
    setOcupado(true); setErr("");
    try {
      await generarDocFact(plantilla, bodyActual(), { conWord });
      alert("\u2705 PDF generado y descargado." + (conWord ? "\n\ud83d\udcc4 Tambi\u00e9n se descarg\u00f3 el Word." : ""));
    } catch (e) {
      setErr("No pude generar por el servidor (" + (e && e.message ? e.message : "error") + "). Uso la impresi\u00f3n del navegador como respaldo.");
      imprimirNavegadorFact(plantilla, bodyActual());
    }
    setOcupado(false);
  };

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #0891b2", background: "#f8fafc" }}>
      <div style={{ fontWeight: 800, color: "#075e75", marginBottom: 4 }}>👁️ Revisión del documento</div>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>
        Así va a salir. <b>Si hay algo para corregir, hacé clic sobre el texto y editalo directamente acá</b> — nombres, fechas, fojas, expediente, montos. Cuando esté bien, generá el PDF o el Word.
      </div>
      <style>{plantilla.css + " .hoja .pagina{background:#fff;box-shadow:0 1px 6px rgba(0,0,0,0.3);margin:0 auto 14px;width:794px;min-height:1122px;box-sizing:border-box;}"}</style>
      <div style={{ overflowX: "auto", background: "#cbd5e1", padding: 12, borderRadius: 8 }}>
        <div className="hoja" ref={hojaRef} contentEditable suppressContentEditableWarning spellCheck={false}
          style={{ outline: "none", minWidth: 794 }} dangerouslySetInnerHTML={{ __html: plantilla.body }} />
      </div>
      {err && <div style={{ fontSize: 12, color: "#b45309", marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button style={{ ...S.btn, background: "#16a34a", flex: 2, minWidth: 220, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => generar(false)}>
          {ocupado ? "⏳ Generando..." : "✅ Generar PDF"}
        </button>
        <button style={{ ...S.btnAlt, flex: 1, minWidth: 130, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={() => generar(true)}>
          {ocupado ? "⏳..." : "📄 PDF + Word"}
        </button>
        {onCerrar && <button style={{ ...S.btnAlt, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={onCerrar}>✖ Cerrar</button>}
      </div>
    </div>
  );
}

/* ============================================================
   VISTA: ARMAR EXPEDIENTE DE FACTURACIÓN (componente React)
   ============================================================ */
function VistaArmarExpediente({ facturas, pacientes, expedientes, sesion, api, fallecidos }) {
  const [leyendo, setLeyendo] = React.useState(false);
  const [fac, setFac] = React.useState({ proveedor: "", nroFactura: "", periodo: "", total: "", paciente: "", dni: "", prestaciones: "" });
  const [oc, setOc] = React.useState({ oc: "", expteCabecera: "", total: "", prestaciones: "" });
  const [facturaSisId, setFacturaSisId] = React.useState("");
  const [etapa, setEtapa] = React.useState(1);
  const [firmante, setFirmante] = React.useState("castillo");
  const [reso, setReso] = React.useState({ accion: "AUTORIZAR", nroResolucion: "", subpartida: "342", fs_auditoria: "03", fs_tribunal: "06", fs_factura: "07", fs_oc: "08", fs_control: "13/20", prestacionesVisto: "", moduloTexto: "Internaci\u00f3n Domiciliaria" });
  const [aviso, setAviso] = React.useState("");
  const [textoCrudo, setTextoCrudo] = React.useState("");
  const [verTexto, setVerTexto] = React.useState(false);
  const [planillas, setPlanillas] = React.useState({ hay: false, planillas: [], hayIndicioFirma: false });
  const [presupuesto, setPresupuesto] = React.useState({ hayPresupuesto: false, paciente: "", dni: "", domicilio: "" });
  const [cantFacturadas, setCantFacturadas] = React.useState({});
  const [cruce, setCruce] = React.useState(null);
  const [planillasOkManual, setPlanillasOkManual] = React.useState(false);
  const [preview, setPreview] = React.useState(null);

  const facturaSistema = React.useMemo(
    () => (facturas || []).find((f) => f.id === facturaSisId) || null,
    [facturas, facturaSisId]
  );

  const sugeridas = React.useMemo(() => {
    const pac = normalizar(fac.paciente || oc.paciente || "");
    const per = fac.periodo || "";
    return (facturas || []).filter((f) => {
      const okPac = pac ? normalizar(f.paciente || "").includes(pac.split(" ")[0]) : true;
      const okPer = per ? f.periodo === per : true;
      return okPac && okPer;
    }).slice(0, 8);
  }, [facturas, fac.paciente, fac.periodo, oc.paciente]);

  async function onSubirPdf(file) {
    if (!file) return;
    setLeyendo(true); setAviso("Leyendo documento…");
    try {
      const texto = await leerTextoArchivo(file, (msg) => setAviso(msg));
      setTextoCrudo(texto || "");
      const f = extraerFacturaProveedorFact(texto);
      const o = extraerOrdenCompraFact(texto);
      const pre = extraerPresupuestoFact(texto);
      const pla = detectarPlanillasFact(texto);
      const cant = cantidadesFacturadasFact(texto);
      const cru = cruzarPlanillaVsFacturaFact(texto, cant);
      setPresupuesto(pre);
      setPlanillas(pla);
      setCantFacturadas(cant);
      setCruce(cru);
      setPlanillasOkManual(false);
      setFac((p) => ({
        proveedor: f.proveedor || p.proveedor,
        nroFactura: f.nroFactura || p.nroFactura,
        periodo: f.periodo || p.periodo,
        total: f.total != null ? String(f.total) : p.total,
        paciente: f.paciente || o.paciente || pre.paciente || p.paciente,
        dni: f.dni || pre.dni || p.dni,
        prestaciones: f.prestaciones || o.prestaciones || p.prestaciones,
      }));
      setOc((p) => ({
        oc: o.oc || p.oc,
        expteCabecera: o.expteCabecera || p.expteCabecera,
        total: o.total != null ? String(o.total) : p.total,
        prestaciones: o.prestaciones || p.prestaciones,
      }));
      const esAlim = /ALIMENTAC/.test(normalizar(f.prestaciones || o.prestaciones || ""));
      setReso((p) => ({ ...p, subpartida: esAlim ? "322" : "342", moduloTexto: esAlim ? "Alimentaci\u00f3n domiciliaria" : "Internaci\u00f3n Domiciliaria", prestacionesVisto: f.prestaciones || o.prestaciones || p.prestacionesVisto }));
      if (!f.total && !o.total) setAviso("No pude leer los totales autom\u00e1ticamente (PDF escaneado). Cargalos a mano.");
      else setAviso("Le\u00ed el PDF. Revis\u00e1 y corregí los datos si hace falta (los escaneos pueden tener errores de OCR).");
    } catch (e) {
      setAviso("No pude leer el PDF: " + (e && e.message ? e.message : "error"));
    }
    setLeyendo(false);
  }

  const facTotal = fac.total !== "" ? parseMontoReclamo(fac.total) : null;
  const ocTotal = oc.total !== "" ? parseMontoReclamo(oc.total) : null;
  const veredicto = calcularVeredictoFact({
    facturaPdf: { total: facTotal },
    ocPdf: { total: ocTotal },
    facturaSistema: facturaSistema ? { monto: Number(facturaSistema.monto) || null } : null,
    planillas,
    planillasOkManual,
    cruce,
  });

  const datosNota = () => ({
    paciente: fac.paciente, dni: fac.dni, periodo: fac.periodo,
    expteCabecera: oc.expteCabecera, prestaciones: fac.prestaciones,
    fechaLarga: fechaLargaFact(new Date()), firmante,
  });
  const datosAsesoria = () => {
    const { anio } = periodoALargoFact(fac.periodo);
    const now = new Date();
    const mesCap = MESES_NOMBRE_MOD[now.getMonth() + 1].charAt(0) + MESES_NOMBRE_MOD[now.getMonth() + 1].slice(1).toLowerCase();
    return { fechaMesAnio: `${mesCap} ${now.getFullYear()}`, anio: anio || String(now.getFullYear()), firmante };
  };
  const datosReso = () => ({
    accion: reso.accion, nroResolucion: reso.nroResolucion,
    expteCabecera: oc.expteCabecera, paciente: fac.paciente, periodo: fac.periodo,
    nroFactura: fac.nroFactura, oc: oc.oc, importe: facTotal || ocTotal || 0,
    subpartida: reso.subpartida, moduloTexto: reso.moduloTexto, prestacionesVisto: reso.prestacionesVisto,
    fs_auditoria: reso.fs_auditoria, fs_tribunal: reso.fs_tribunal, fs_factura: reso.fs_factura,
    fs_oc: reso.fs_oc, fs_control: reso.fs_control, fechaLarga: fechaLargaFact(new Date()), firmante,
  });

  function revisarAuditoria() {
    setPreview({ plantilla: plantillaNotaAuditoria(datosNota()), tipo: "auditoria" });
    if (facturaSistema && veredicto.veredicto !== "error" && api && api.actualizarFactura) {
      api.actualizarFactura(facturaSistema.id, { estado: "AUDITORIA", fechaAuditoria: hoy() }, "expediente armado y pase a Auditoría");
      setAviso("Factura pasada a AUDITOR\u00cdA. Revis\u00e1 y generá la nota abajo.");
    }
  }
  function revisarAsesoria() { setPreview({ plantilla: plantillaPaseAsesoria(datosAsesoria()), tipo: "asesoria" }); }
  function revisarResolucion() { setPreview({ plantilla: plantillaResolucionPago(datosReso()), tipo: "resolucion" }); }

  // Cierre del circuito: crea una factura NUEVA en el sistema con los datos del expediente
  // ya armado, y la deja directamente en estado TESORERIA (ya autorizada y para pago).
  const [registrando, setRegistrando] = React.useState(false);
  const [registrado, setRegistrado] = React.useState(false);
  async function registrarEnTesoreria() {
    if (!api || !api.crearFactura) { alert("No puedo crear la factura (falta conexión)."); return; }
    if (!fac.paciente || !(facTotal || ocTotal)) { alert("Faltan datos mínimos (paciente y monto)."); return; }
    setRegistrando(true);
    try {
      const esAlim = reso.subpartida === "322";
      await api.crearFactura({
        periodo: fac.periodo || hoy().slice(0, 7),
        paciente: fac.paciente,
        pacienteId: "",
        modulo: esAlim ? "ALIMENTACION" : "INTERNACION",
        usuarioAsignado: sesion?.usuario || "",
        expedienteId: "",
        proveedor: fac.proveedor || "SIAD",
        nroExpedienteFacturacion: oc.expteCabecera || "",
        nroResolucionPago: reso.nroResolucion || "",
        sige: "",
        nroFactura: fac.nroFactura || "",
        oc: oc.oc || "",
        monto: String(facTotal || ocTotal || ""),
        estado: "TESORERIA",
        fechaTesoreria: hoy(),
      });
      setRegistrado(true);
      setAviso("✅ Facturación registrada en el sistema y puesta en TESORERÍA.");
    } catch (e) {
      alert("No pude registrar: " + (e && e.message ? e.message : "error"));
    }
    setRegistrando(false);
  }

  const colFor = (ok) => ok === true ? "#16a34a" : ok === false ? "#dc2626" : "#94a3b8";
  const inputRow = (label, val, on, ph) => (
    <div>
      <label style={S.label}>{label}</label>
      <input style={S.input} value={val} onChange={(e) => on(e.target.value)} placeholder={ph || ""} />
    </div>
  );

  return (
    <div>
      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>📁 Armar expediente de facturación</div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {[[1, "1 · Auditoría"], [2, "2 · Asesoría"], [3, "3 · Resolución"]].map(([n, l]) => (
              <span key={n} style={{ ...S.chip(etapa === n ? "#1e3a5f" : "#e2e8f0"), color: etapa === n ? "#fff" : "#475569", cursor: "pointer" }} onClick={() => setEtapa(n)}>{l}</span>
            ))}
          </div>
        </div>
        <p style={{ fontSize: 13, color: "#64748b", marginTop: 6 }}>
          Subí el PDF del proveedor (factura + orden de compra + planillas). El sistema lee los datos, los podés corregir, te da el veredicto y genera los documentos.
        </p>
        <label style={{ ...S.btn, display: "inline-block", cursor: "pointer" }}>
          {leyendo ? "Leyendo PDF…" : "📎 Subir PDF del expediente"}
          <input type="file" accept="application/pdf,image/*" style={{ display: "none" }}
            onChange={(e) => onSubirPdf(e.target.files && e.target.files[0])} disabled={leyendo} />
        </label>
        {aviso && <div style={{ marginTop: 8, fontSize: 13, color: "#b45309" }}>{aviso}</div>}
        {textoCrudo && (
          <div style={{ marginTop: 8 }}>
            <button style={{ ...S.btnAlt, fontSize: 12, padding: "4px 10px" }} onClick={() => setVerTexto((v) => !v)}>
              {verTexto ? "▲ Ocultar texto leído" : "▼ Ver texto que leyó el OCR (para diagnóstico)"}
            </button>
            {verTexto && (
              <div style={{ marginTop: 6 }}>
                <button style={{ ...S.btnAlt, fontSize: 12, padding: "4px 10px", marginBottom: 6 }}
                  onClick={() => { navigator.clipboard && navigator.clipboard.writeText(textoCrudo); alert("Texto copiado. Pegalo para diagnóstico."); }}>
                  📋 Copiar todo el texto
                </button>
                <textarea readOnly value={textoCrudo} style={{ width: "100%", height: 220, fontSize: 11, fontFamily: "monospace", padding: 8, border: "1px solid #cbd5e1", borderRadius: 6 }} />
              </div>
            )}
          </div>
        )}
      </div>

      <div style={S.card}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>Datos leídos (confirmá o corregí)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
          {inputRow("Proveedor", fac.proveedor, (v) => setFac({ ...fac, proveedor: v }))}
          {inputRow("Paciente", fac.paciente, (v) => setFac({ ...fac, paciente: v }))}
          {inputRow("DNI", fac.dni, (v) => setFac({ ...fac, dni: v }))}
          {inputRow("Período (AAAA-MM)", fac.periodo, (v) => setFac({ ...fac, periodo: v }), "2026-05")}
          {inputRow("N° Factura", fac.nroFactura, (v) => setFac({ ...fac, nroFactura: v }))}
          {inputRow("Total factura", fac.total, (v) => setFac({ ...fac, total: v }))}
          {inputRow("N° Orden de Compra", oc.oc, (v) => setOc({ ...oc, oc: v }))}
          {inputRow("Total OC", oc.total, (v) => setOc({ ...oc, total: v }))}
          {inputRow("Expediente cabecera", oc.expteCabecera, (v) => setOc({ ...oc, expteCabecera: v }), "Ej: 0000/000/X/0000 (si no se leyó, cargalo a mano)")}
          {inputRow("Prestaciones", fac.prestaciones, (v) => setFac({ ...fac, prestaciones: v }))}
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={S.label}>Factura del sistema a vincular (para cotejar el monto)</label>
          <select style={S.input} value={facturaSisId} onChange={(e) => setFacturaSisId(e.target.value)}>
            <option value="">— sin vincular —</option>
            {sugeridas.map((f) => (
              <option key={f.id} value={f.id}>{f.paciente} · {f.periodo} · {fmtPesosFact(f.monto)} · {f.proveedor}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ ...S.card, borderColor: veredicto.veredicto === "ok" ? "#16a34a" : veredicto.veredicto === "error" ? "#dc2626" : "#f59e0b", borderWidth: 2 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>
          {veredicto.veredicto === "ok" ? "✅ Listo para mandar a Auditoría Médica" : veredicto.veredicto === "error" ? "⛔ Hay un problema, revisá antes de avanzar" : "🟡 Faltan datos o requiere revisión"}
        </div>
        {veredicto.checks.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, padding: "3px 0" }}>
            <span style={{ color: colFor(c.ok), fontWeight: 800 }}>{c.ok === true ? "✓" : c.ok === false ? "✗" : "·"}</span>
            <span><b>{c.regla}:</b> {c.detalle}</span>
          </div>
        ))}
      </div>

      <div style={S.card}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>📋 Documentación detectada</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4 }}>PLANILLAS DE PRESTACIONES</div>
            {planillas.hay ? (
              <ul style={{ margin: "4px 0", paddingLeft: 18, fontSize: 13 }}>
                {planillas.planillas.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            ) : <div style={{ fontSize: 13, color: "#b45309" }}>No detecté planillas en el PDF.</div>}
            {planillas.hay && <div style={{ fontSize: 12, color: "#64748b" }}>{planillas.hayIndicioFirma ? "Se ven campos de firma/sello." : "No detecté campos de firma (revisá a ojo)."}</div>}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4 }}>PRESUPUESTO DEL PROVEEDOR</div>
            {presupuesto.hayPresupuesto ? (
              <div style={{ fontSize: 13 }}>
                {presupuesto.paciente && <div>Paciente: {presupuesto.paciente}</div>}
                {presupuesto.dni && <div>DNI: {presupuesto.dni}</div>}
                {presupuesto.domicilio && <div>Domicilio: {presupuesto.domicilio}</div>}
                {!presupuesto.paciente && !presupuesto.dni && <div style={{ color: "#64748b" }}>Detectado, sin datos claros del paciente.</div>}
              </div>
            ) : <div style={{ fontSize: 13, color: "#64748b" }}>No vino presupuesto (opcional).</div>}
          </div>
        </div>
        {Object.keys(cantFacturadas).length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4 }}>CANTIDADES FACTURADAS (contrastá contra los días firmados de la planilla)</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13 }}>
              {Object.entries(cantFacturadas).map(([d, c]) => (
                <span key={d} style={S.chip("#eff6ff")}>{d}: <b>{c}</b></span>
              ))}
            </div>
          </div>
        )}
        {cruce && cruce.hay && (
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, fontSize: 13,
            background: (cruce.comparable && cruce.coincide) ? "#f0fdf4" : "#fffbeb",
            border: "1px solid " + ((cruce.comparable && cruce.coincide) ? "#86efac" : "#fcd34d") }}>
            {!cruce.comparable
              ? <span>ℹ️ Enfermería facturada: <b>{cruce.facturado}</b> (horas). Conté <b>~{cruce.contado}</b> días en la planilla (<i>estimado</i>). Verificá que <b>días × horas por día</b> den lo facturado.</span>
              : cruce.coincide
                ? <span>✓ Enfermería: se facturaron <b>{cruce.facturado}</b> y conté <b>~{cruce.contado}</b> días en la planilla (conteo <i>estimado</i>).</span>
                : <span>⚠️ <b>Alerta:</b> se facturaron <b>{cruce.facturado}</b> de enfermería pero conté <b>~{cruce.contado}</b> días en la planilla (conteo <i>estimado</i>, manuscrito). Verificá a ojo; si de verdad no coinciden, pedí la nota de justificación del proveedor.</span>}
            <div style={{ fontSize: 11, color: "#92400e", marginTop: 3 }}>El conteo de la planilla es aproximado porque es manuscrita. No lo tomes como definitivo.</div>
          </div>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={planillasOkManual} onChange={(e) => setPlanillasOkManual(e.target.checked)} style={{ width: 18, height: 18 }} />
          <span>Verifiqué que las planillas están <b>firmadas</b> y son <b>acordes a la factura</b>.</span>
        </label>
      </div>

      <div style={S.card}>
        <label style={S.label}>Autoridad firmante</label>
        <select style={{ ...S.input, maxWidth: 380 }} value={firmante} onChange={(e) => setFirmante(e.target.value)}>
          {FIRMANTES_FACT.map((f) => <option key={f.id} value={f.id}>{f.nombre} — {f.cargo}</option>)}
        </select>
      </div>

      {etapa === 1 && (
        <div style={S.card}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>1 · Nota de pase a Auditoría Médica</div>
          <p style={{ fontSize: 13, color: "#64748b" }}>Se abre la vista previa editable. Si el veredicto no da error y hay factura vinculada, avanza a AUDITORÍA. Después revisás la nota y generás PDF o Word.</p>
          <button style={{ ...S.btn, opacity: veredicto.veredicto === "error" ? 0.6 : 1 }} onClick={revisarAuditoria} disabled={veredicto.veredicto === "error"}>
            👁️ Revisar nota + pasar a Auditoría
          </button>
        </div>
      )}

      {etapa === 2 && (
        <div style={S.card}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>2 · Pase a Asesoría Letrada</div>
          <p style={{ fontSize: 13, color: "#64748b" }}>Texto fijo; cambia solo la fecha (mes/año actual).</p>
          <button style={S.btn} onClick={revisarAsesoria}>👁️ Revisar pase a Asesoría</button>
        </div>
      )}

      {etapa === 3 && (
        <div style={S.card}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>3 · Resolución de pago</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            <div>
              <label style={S.label}>Acción</label>
              <select style={S.input} value={reso.accion} onChange={(e) => setReso({ ...reso, accion: e.target.value })}>
                <option value="AUTORIZAR">Autorizar</option>
                <option value="CONVALIDAR">Convalidar</option>
              </select>
            </div>
            {inputRow("N° Resolución", reso.nroResolucion, (v) => setReso({ ...reso, nroResolucion: v }), "3346")}
            <div>
              <label style={S.label}>Subpartida</label>
              <select style={S.input} value={reso.subpartida} onChange={(e) => setReso({ ...reso, subpartida: e.target.value })}>
                <option value="342">342 (Internación)</option>
                <option value="322">322 (Alimentación)</option>
              </select>
            </div>
            {inputRow("fs. Auditoría", reso.fs_auditoria, (v) => setReso({ ...reso, fs_auditoria: v }))}
            {inputRow("fs. Tribunal", reso.fs_tribunal, (v) => setReso({ ...reso, fs_tribunal: v }))}
            {inputRow("fs. Factura", reso.fs_factura, (v) => setReso({ ...reso, fs_factura: v }))}
            {inputRow("fs. OC", reso.fs_oc, (v) => setReso({ ...reso, fs_oc: v }))}
            {inputRow("fs. Control/Remito", reso.fs_control, (v) => setReso({ ...reso, fs_control: v }))}
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: "#475569" }}>
            Importe: <b>{fmtPesosFact(facTotal || ocTotal || 0)}</b> — {montoALetrasPesosFact(facTotal || ocTotal || 0)}
          </div>
          <button style={{ ...S.btn, marginTop: 10 }} onClick={revisarResolucion}>👁️ Revisar resolución de pago</button>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px dashed #cbd5e1" }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>✔️ Cierre: registrar en el sistema (Tesorería)</div>
            <p style={{ fontSize: 13, color: "#64748b", marginTop: 0 }}>
              Cuando la resolución esté firmada y autorizada, incorporá esta facturación a tu registro. Se crea una factura nueva con estos datos y queda en <b>TESORERÍA</b> (para pago).
            </p>
            {registrado ? (
              <div style={{ fontSize: 14, color: "#16a34a", fontWeight: 700 }}>✅ Registrada en TESORERÍA. Ya la ves en la solapa Facturación.</div>
            ) : (
              <button style={{ ...S.btn, background: "#0f766e", opacity: registrando ? 0.6 : 1 }} disabled={registrando} onClick={registrarEnTesoreria}>
                {registrando ? "Registrando…" : "➕ Registrar facturación en Tesorería"}
              </button>
            )}
          </div>
        </div>
      )}

      {preview && (
        <VistaPreviaFact plantilla={preview.plantilla} onCerrar={() => {
          setPreview(null);
          if (preview.tipo === "auditoria") setEtapa(2);
          else if (preview.tipo === "asesoria") setEtapa(3);
        }} />
      )}
    </div>
  );
}

/* ============================================================
   VISTA RECLAMOS (leer PDF del proveedor y ubicar la factura)
   ============================================================ */
function VistaReclamos({ facturas, pacientes, expedientes, sesion, api, fallecidos }) {
  const [leyendo, setLeyendo] = useState(false);
  const [texto, setTexto] = useState("");
  const [datos, setDatos] = useState(null);
  const [nombreArch, setNombreArch] = useState("");
  const [prefill, setPrefill] = useState(null); // inicial para FormFactura
  const inputRef = React.useRef(null);

  const procesar = async (file) => {
    if (!file) return;
    setLeyendo(true); setDatos(null); setTexto(""); setNombreArch(file.name);
    try {
      const txt = await leerTextoArchivo(file);
      if (!txt || txt.length < 10) {
        alert("No pude leer texto del archivo. Probá con otro PDF o cargá el reclamo a mano.");
        return;
      }
      setTexto(txt);
      setDatos(extraerDatosFactura(txt));
    } catch (e) {
      alert("No pude leer el archivo (" + (e.message || e) + "). Puede ser un PDF protegido; probá descargarlo de nuevo.");
    } finally {
      setLeyendo(false);
    }
  };

  const analizarTextoPegado = () => {
    if (!texto || texto.length < 10) return alert("Pegá primero el texto del mail o reclamo.");
    setDatos(extraerDatosFactura(texto));
  };

  // Para cada fila detectada, resolvemos si ya está cargada y en qué estado.
  const filasResueltas = useMemo(() => {
    if (!datos) return [];
    return (datos.filas || []).map((fila) => ({
      fila,
      matches: matchearFila(fila, datos, facturas)
    }));
  }, [datos, facturas]);

  const abrirPrecarga = (fila) => {
    const pacBuscado = fila.paciente || datos.paciente || "";
    const p = matchearPaciente(pacBuscado, pacientes);
    setPrefill({
      periodo: fila.periodo || hoy().slice(0, 7),
      paciente: p ? p.nombre : (pacBuscado || ""),
      pacienteId: p ? p.id : "",
      modulo: fila.modulo || "INTERNACION",
      usuarioAsignado: (p && p.usuarioAsignado) || sesion.usuario,
      expedienteId: "",
      proveedor: datos.proveedor || fila.proveedor || "",
      nroExpedienteFacturacion: fila.expteFact || "",
      nroResolucionPago: fila.resolucion || "",
      sige: "", nroFactura: fila.nroFactura || "", oc: fila.oc || datos.oc || "",
      monto: fila.monto != null ? fila.monto : "",
      estado: "RECIBIDA",
      fechaAuditoria: null, fechaAsesoria: null, fechaTribunal: null,
      fechaTesoreria: null,
      observaciones: [
        fila.expteCabecera ? "Expte cabecera: " + fila.expteCabecera : "",
        fila.diagnostico ? "Dx: " + fila.diagnostico : "",
        "Alta desde lectura de PDF — VERIFICAR números contra el original."
      ].filter(Boolean).join(" · ")
    });
  };

  const nEncontradas = filasResueltas.filter((r) => r.matches.length).length;
  const nFaltan = filasResueltas.length - nEncontradas;

  return (
    <>
      <div style={S.card}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Leer reclamo del proveedor</h3>
        <p style={{ fontSize: 13, color: "#64748b", marginTop: -4 }}>
          Subí el PDF del mail (o una foto). Si el PDF tiene texto lo leo casi perfecto; si es un escaneo uso OCR
          y puede salir con algún error, así que <b>siempre verificá los números contra el original</b> antes de guardar.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input ref={inputRef} type="file" accept=".pdf,image/*"
            onChange={(e) => procesar(e.target.files[0])} style={{ display: "none" }} />
          <button style={S.btn} disabled={leyendo}
            onClick={() => inputRef.current && inputRef.current.click()}>
            {leyendo ? "Leyendo..." : "📄 Subir PDF / imagen"}
          </button>
          {nombreArch && <span style={{ fontSize: 13, color: "#475569" }}>{nombreArch}</span>}
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={S.label}>...o pegá el texto del mail acá</label>
          <textarea style={{ ...S.input, minHeight: 70, fontFamily: "inherit" }} value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Pegá el cuerpo del mail: período, N° de factura e importe de cada renglón..." />
          <button style={{ ...S.btnAlt, marginTop: 8 }} onClick={analizarTextoPegado}>🔎 Analizar texto</button>
        </div>
      </div>

      {datos && (
        <div style={S.card}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "baseline" }}>
            <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 16 }}>
              Reclamo leído <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>— verificá contra el original</span>
            </h3>
            {datos.proveedor && <span style={S.chip("#dbeafe")}>Proveedor: {datos.proveedor}</span>}
            {datos.paciente && <span style={S.chip("#e0e7ff")}>Paciente: {datos.paciente}</span>}
            {datos.oc && <span style={S.chip("#e0e7ff")}>OC: {datos.oc}</span>}
          </div>
          <div style={{ fontSize: 13, color: "#475569", margin: "6px 0 12px" }}>
            {filasResueltas.length} factura(s) detectada(s) · <b style={{ color: "#166534" }}>{nEncontradas} ya en el sistema</b>
            {nFaltan ? <> · <b style={{ color: "#c2410c" }}>{nFaltan} sin cargar</b></> : null}
          </div>

          {filasResueltas.length === 0 ? (
            <div style={{ fontSize: 13, color: "#94a3b8" }}>No pude detectar facturas en el texto. Revisá el PDF o cargá a mano.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{[...(datos.esExpediente ? ["Expte fact."] : []), "Paciente", "Período", "Factura N°", "OC", "Importe", "¿Está?", "Estado / dónde está", "Usuario", ""].map((h, hi) => <th key={hi} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {filasResueltas.map((r, i) => {
                    const f = r.matches[0];
                    return (
                      <tr key={i} style={{ background: f ? "transparent" : "#fff7ed" }}>
                        {datos.esExpediente && <td style={{ ...S.td, fontWeight: 600 }}>{r.fila.expteFact || "-"}</td>}
                        <td style={S.td}>{f ? <NombrePac nombre={f.paciente} fallecidos={fallecidos} /> : (r.fila.paciente || "-")}</td>
                        <td style={S.td}>{r.fila.periodo ? nombreMes(r.fila.periodo) : "-"}</td>
                        <td style={{ ...S.td, fontWeight: 600 }}>{r.fila.nroFactura || "-"}</td>
                        <td style={S.td}>{r.fila.oc || (f && f.oc) || "-"}</td>
                        <td style={{ ...S.td, textAlign: "right" }}>{r.fila.monto != null ? plata(r.fila.monto) : "-"}</td>
                        <td style={S.td}>
                          {f
                            ? <span style={S.chip("#bbf7d0")}>✓ en sistema</span>
                            : <span style={S.chip("#fed7aa")}>✕ sin cargar</span>}
                        </td>
                        <td style={S.td}>
                          {f ? <><Chip estado={f.estado} /> <span style={{ fontSize: 12, color: "#64748b" }}>· {ETAPA(f.estado)}</span></> : "-"}
                        </td>
                        <td style={S.td}>{f ? (f.usuarioAsignado || "-") : "-"}</td>
                        <td style={S.td}>
                          {!f && <button style={{ ...S.btn, padding: "4px 10px", fontSize: 12 }} onClick={() => abrirPrecarga(r.fila)}>➕ Cargar</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                Las que ya están muestran su estado real y quién las tiene. Las que faltan las cargás con “➕ Cargar” (se abre el alta pre-llenada para que confirmes).
              </div>
            </div>
          )}
        </div>
      )}

      {prefill && (
        <FormFactura
          inicial={prefill}
          pacientes={pacientes}
          expedientes={expedientes}
          sesion={sesion}
          onCerrar={() => setPrefill(null)}
          onGuardar={(d) => { api.crearFactura(d); setPrefill(null); alert("✅ Factura cargada. Recordá verificar los números contra el original."); }}
        />
      )}
    </>
  );
}

/* ============================================================
   VISTA TRANSFERENCIAS (historial)
   ============================================================ */
function VistaTransferencias({ transferencias }) {
  const lista = [...transferencias].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  return (
    <div style={{ ...S.card, padding: 0, overflowX: "auto" }}>
      <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700, borderBottom: "1px solid #e2e8f0" }}>
        {lista.length} transferencias registradas
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Fecha", "Paciente", "De", "A", "Motivo", "Facturas movidas", "Exptes", "Hecho por"].map((h) =>
              <th key={h} style={S.th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {lista.map((t) => (
            <tr key={t.id}>
              <td style={S.td}>{t.fecha}</td>
              <td style={{ ...S.td, fontWeight: 600 }}>{t.paciente}</td>
              <td style={S.td}>{t.usuarioAnterior || "-"}</td>
              <td style={S.td}><span style={S.chip("#e0e7ff")}>{t.usuarioNuevo}</span></td>
              <td style={{ ...S.td, fontSize: 12 }}>{t.motivo}</td>
              <td style={{ ...S.td, textAlign: "center" }}>{t.facturasMovidas ?? 0}</td>
              <td style={{ ...S.td, textAlign: "center" }}>{t.exptesMovidos ?? 0}</td>
              <td style={S.td}>{t.hechoPor}</td>
            </tr>
          ))}
          {!lista.length && (
            <tr><td colSpan={8} style={{ ...S.td, textAlign: "center", color: "#94a3b8", padding: 24 }}>
              Todavía no se registraron transferencias
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ============================================================
   VISTA ADMIN
   ============================================================ */
function VistaAdmin({ api, pacientes, expedientes, facturas }) {
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [log, setLog] = useState("");
  const [textoAsig, setTextoAsig] = useState("");
  const [cargandoAsig, setCargandoAsig] = useState(false);
  const [logAsig, setLogAsig] = useState("");

  const reasignar = async () => {
    let filas;
    try { filas = JSON.parse(textoAsig); }
    catch { return alert("El JSON no es válido"); }
    if (!Array.isArray(filas) || !filas.length) return alert("Se espera una lista [{nombre, usuario}]");
    if (!window.confirm(`Se van a revisar ${filas.length} asignaciones y actualizar solo las que cambien. ¿Continuar?`)) return;
    setCargandoAsig(true); setLogAsig("");
    try {
      const r = await api.reasignarPacientes(filas, (m) => setLogAsig(m));
      let msg = `Listo. ${r.actualizados} paciente(s) actualizados.`;
      if (r.sinMatch.length) msg += ` Sin coincidencia (${r.sinMatch.length}): ` + r.sinMatch.join(", ");
      setLogAsig(msg);
    } catch (e) {
      setLogAsig("Error: " + e.message);
    }
    setCargandoAsig(false);
  };

  const importar = async () => {
    let data;
    try { data = JSON.parse(texto); }
    catch { return alert("El JSON no es válido"); }
    if (!data.pacientes || !data.facturas) return alert("Falta 'pacientes' o 'facturas' en el JSON");
    if (!window.confirm(
      `Se van a cargar ${data.pacientes.length} pacientes, ${(data.expedientes || []).length} expedientes y ${data.facturas.length} facturas.\n\n` +
      "Los documentos con el mismo ID se sobrescriben. ¿Continuar?"
    )) return;
    setCargando(true);
    try {
      const n = await api.importarSeed(data, (m) => setLog(m));
      setLog(`Listo. Se escribieron ${n} documentos.`);
    } catch (e) {
      setLog("Error: " + e.message);
    }
    setCargando(false);
  };

  return (
    <div style={S.card}>
      <h3 style={{ marginTop: 0 }}>Administración</h3>
      <div style={{ fontSize: 14, marginBottom: 16, color: "#475569" }}>
        En base de datos hoy: <b>{pacientes.length}</b> pacientes · <b>{expedientes.length}</b> expedientes · <b>{facturas.length}</b> facturas
      </div>

      <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13, color: "#9a3412" }}>
        ⚠️ <b>Restaurar copia de seguridad (avanzado).</b> Esto es para reponer toda la base de una copia completa en formato técnico (JSON). Para el trabajo de todos los días —cargar padrones y expedientes— usá la solapa <b>Importar</b>, no esto.
      </div>

      <Campo label="Restaurar copia de seguridad — pegar el contenido JSON completo">
        <textarea style={{ ...S.input, minHeight: 160, fontFamily: "monospace", fontSize: 11 }}
          value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder='{"pacientes":[...],"expedientes":[...],"facturas":[...]}' />
      </Campo>

      <button style={S.btn} onClick={importar} disabled={cargando}>
        {cargando ? "Restaurando..." : "Restaurar base"}
      </button>

      {log && (
        <div style={{ marginTop: 12, padding: 10, background: "#f1f5f9", borderRadius: 6, fontSize: 13, fontFamily: "monospace" }}>
          {log}
        </div>
      )}

      <div style={{ marginTop: 24, borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Corregir asignación de pacientes</h3>
        <div style={{ fontSize: 13, color: "#475569", marginBottom: 10 }}>
          Pegá un JSON con la lista oficial <code>[{"{ \"nombre\": \"...\", \"usuario\": \"...\", \"proveedor\": \"...\" }"}]</code>.
          Solo cambia el usuario responsable (y el proveedor si viene) de los pacientes que ya existen, matcheando por nombre. No crea, no borra, no toca facturas ni expedientes.
        </div>
        <Campo label="Lista de asignaciones (JSON)">
          <textarea style={{ ...S.input, minHeight: 120, fontFamily: "monospace", fontSize: 11 }}
            value={textoAsig} onChange={(e) => setTextoAsig(e.target.value)}
            placeholder='[{"nombre":"BRANDAN JAVIER EZEQUIEL","usuario":"JORGE","proveedor":"SIAD"}]' />
        </Campo>
        <button style={S.btn} onClick={reasignar} disabled={cargandoAsig}>
          {cargandoAsig ? "Actualizando..." : "Corregir asignaciones"}
        </button>
        {logAsig && (
          <div style={{ marginTop: 12, padding: 10, background: "#f1f5f9", borderRadius: 6, fontSize: 13, fontFamily: "monospace" }}>
            {logAsig}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   SEGUIMIENTO (estado + días hábiles por organismo)
   ============================================================ */
function VistaSeguimiento({ facturas, sesion, api, fallecidos }) {
  const [fUsuario, setFUsuario] = useState(sesion.usuario);
  const [fEtapa, setFEtapa] = useState("");
  const [busca, setBusca] = useState("");
  const [verFinalizadas, setVerFinalizadas] = useState(false);

  const EN_CIRCUITO = ["RECIBIDA", "AUDITORIA", "OBSERVADA AUDITORIA", "ASESORIA LETRADA", "PARA FIRMA", "TRIBUNAL", "OBSERVADA TRIBUNAL", "TESORERIA"];
  const ETAPAS = ["En el programa", "Auditoría médica", "Asesoría letrada", "Resolución para firma", "Tribunal de cuentas", "Tesorería"];
  const ESTADOS_SELECT = ["RECIBIDA", "AUDITORIA", "OBSERVADA AUDITORIA", "ASESORIA LETRADA", "PARA FIRMA", "TRIBUNAL", "OBSERVADA TRIBUNAL", "TESORERIA"];

  const lista = useMemo(() => {
    return facturas
      .filter((f) => EN_CIRCUITO.includes(normEstado(f.estado)))
      .filter((f) => verFinalizadas || normEstado(f.estado) !== "TESORERIA")
      .filter((f) => !fUsuario || f.usuarioAsignado === fUsuario)
      .filter((f) => !fEtapa || ETAPA(f.estado) === fEtapa)
      .filter((f) => !busca || normalizar(f.paciente).includes(normalizar(busca)))
      .sort((a, b) => (b.periodo || "").localeCompare(a.periodo || "") || (a.paciente || "").localeCompare(b.paciente || ""));
  }, [facturas, fUsuario, fEtapa, busca, verFinalizadas]);

  const cont = (est) => facturas.filter((f) => est.includes(normEstado(f.estado))
    && (!fUsuario || f.usuarioAsignado === fUsuario)).length;
  const enAud = cont(["AUDITORIA", "OBSERVADA AUDITORIA"]);
  const enAse = cont(["ASESORIA LETRADA"]);
  const enTrib = cont(["TRIBUNAL", "OBSERVADA TRIBUNAL"]);

  const ponerEstado = (f, nuevo) => {
    if (!nuevo || nuevo === normEstado(f.estado)) return;
    const c = { estado: nuevo };
    if (nuevo === "AUDITORIA" && !f.fechaAuditoria) c.fechaAuditoria = hoy();
    if (nuevo === "ASESORIA LETRADA" && !f.fechaAsesoria) c.fechaAsesoria = hoy();
    if (nuevo === "TRIBUNAL" && !f.fechaTribunal) c.fechaTribunal = hoy();
    if (nuevo === "TESORERIA" && !f.fechaTesoreria) c.fechaTesoreria = hoy();
    api.actualizarFactura(f.id, c, `estado cambiado a ${ETIQUETA_ESTADO[nuevo]}`);
  };

  const colorDias = (d) => (d == null ? "#94a3b8" : d > 30 ? "#dc2626" : d > 15 ? "#c2410c" : "#0f172a");
  const celdaDias = (d, desde) => (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: colorDias(d) }}>{d == null ? "-" : d}</div>
      {desde && <div style={{ fontSize: 11, color: "#94a3b8" }}>desde {desde}</div>}
    </div>
  );

  return (
    <>
      <div style={{ ...S.card, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ minWidth: 150 }}>
          <label style={S.label}>Buscar paciente</label>
          <input style={S.input} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="nombre..." />
        </div>
        <div>
          <label style={S.label}>Etapa</label>
          <select style={S.input} value={fEtapa} onChange={(e) => setFEtapa(e.target.value)}>
            <option value="">Todas</option>
            {ETAPAS.map((e) => <option key={e}>{e}</option>)}
          </select>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, paddingBottom: 8 }}>
          <input type="checkbox" checked={verFinalizadas} onChange={(e) => setVerFinalizadas(e.target.checked)} />
          Ver pagadas (Tesorería)
        </label>
      </div>

      <div style={{ ...S.card, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700, borderBottom: "1px solid #e2e8f0" }}>
          {lista.length} en circuito · {enAud} en Auditoría · {enAse} en Asesoría · {enTrib} en Tribunal
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={S.th}>Paciente</th>
              <th style={S.th}>Período</th>
              <th style={S.th}>Proveedor</th>
              <th style={S.th}>Etapa (poné el estado)</th>
              <th style={S.th}>Días háb.<br />Auditoría</th>
              <th style={S.th}>Días háb.<br />Asesoría</th>
              <th style={S.th}>Días háb.<br />Tribunal</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((f) => (
              <tr key={f.id}>
                <td style={S.td}><NombrePac nombre={f.paciente} fallecidos={fallecidos} /></td>
                <td style={S.td}>{f.periodo}</td>
                <td style={S.td}>{f.proveedor || "-"}</td>
                <td style={S.td}>
                  <select style={{ ...S.input, minWidth: 200 }} value={normEstado(f.estado)} onChange={(e) => ponerEstado(f, e.target.value)}>
                    {ESTADOS_SELECT.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
                  </select>
                </td>
                <td style={S.td}>{celdaDias(diasEnAuditoria(f), f.fechaAuditoria)}</td>
                <td style={S.td}>{celdaDias(diasEnAsesoria(f), f.fechaAsesoria)}</td>
                <td style={S.td}>{celdaDias(diasEnTribunal(f), f.fechaTribunal)}</td>
              </tr>
            ))}
            {lista.length === 0 && (
              <tr><td style={{ ...S.td, textAlign: "center", color: "#94a3b8" }} colSpan={7}>No hay facturas en circuito con esos filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ ...S.card, fontSize: 12, color: "#64748b" }}>
        Los días hábiles descuentan sábados, domingos y feriados fijos 2026. Cada contador corre desde que la factura entra al organismo hasta que sale al siguiente (o hasta hoy si sigue ahí). En rojo si supera 30 días hábiles, en naranja si supera 15. Al cambiar el estado, el sistema estampa solo la fecha de entrada al organismo.
      </div>
    </>
  );
}

/* ============================================================
   IMPORTAR PADRON (EXCEL)
   ============================================================ */
function VistaImportar({ sesion, api }) {
  const [filas, setFilas] = useState([]);
  const [nombreArch, setNombreArch] = useState("");
  const [usuarioDestino, setUsuarioDestino] = useState(sesion.usuario || "JORGE");
  const [moduloDefault, setModuloDefault] = useState("INTERNACION");
  const [leyendo, setLeyendo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [msg, setMsg] = useState("");
  const [resultado, setResultado] = useState(null);

  const onArchivo = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setLeyendo(true); setMsg(""); setResultado(null); setFilas([]);
    setNombreArch(file.name);
    try {
      const XLSX = await cargarSheetJS();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
      const fs = filasDesdeMatriz(matriz);
      if (!fs.length) { setMsg("No encontré filas con paciente en la primera hoja. Revisá que tenga la columna \"Paciente\"."); }
      setFilas(fs);
    } catch (err) {
      setMsg("Error leyendo el archivo: " + err.message);
    }
    setLeyendo(false);
    e.target.value = "";
  };

  const importar = async () => {
    if (!filas.length) return;
    if (!usuarioDestino) { setMsg("Elegí el usuario responsable."); return; }
    if (!window.confirm(`Se van a cargar ${filas.length} filas del padrón bajo el usuario ${usuarioDestino}. ¿Continuar?`)) return;
    setImportando(true); setMsg(""); setResultado(null);
    try {
      const r = await api.importarPadron({ filas, usuarioDestino, moduloDefault, progreso: (m) => setMsg(m) });
      setResultado(r);
      setMsg("");
    } catch (err) {
      setMsg("Error al importar: " + err.message);
    }
    setImportando(false);
  };

  return (
    <div style={S.card}>
      <h3 style={{ marginTop: 0 }}>Importar padrón de facturación (Excel)</h3>
      <div style={{ fontSize: 13, color: "#475569", marginBottom: 16 }}>
        Subí un Excel con las columnas <b>Proveedor</b>, <b>Paciente</b>, <b>Factura N°</b>, <b>Orden de Compra (OC)</b>,
        {" "}<b>Mes Prestacional</b> y <b>Observaciones</b>. El sistema cruza cada paciente con los que ya existen (no duplica),
        crea los que falten y da de alta las facturas en estado <b>Recibida</b> (o <b>Sin factura</b> si la fila no tiene número), salvo que el Excel traiga una columna Estado.
        Reimportar el mismo padrón no genera duplicados.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <Campo label="Usuario responsable">
          <select style={S.input} value={usuarioDestino} onChange={(e) => setUsuarioDestino(e.target.value)}>
            {USUARIOS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </Campo>
        <Campo label="Módulo por defecto">
          <select style={S.input} value={moduloDefault} onChange={(e) => setModuloDefault(e.target.value)}>
            {MODULOS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Campo>
      </div>

      <Campo label="Archivo Excel (.xlsx / .xls / .csv)">
        <input type="file" accept=".xlsx,.xls,.csv" onChange={onArchivo} style={{ fontSize: 14 }} />
      </Campo>

      {leyendo && <div style={{ color: "#64748b", fontSize: 13 }}>Leyendo archivo...</div>}

      {filas.length > 0 && (
        <>
          <div style={{ margin: "14px 0 8px", fontSize: 13, fontWeight: 700 }}>
            {nombreArch} · {filas.length} filas detectadas
          </div>
          <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 8, maxHeight: 340, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={S.th}>Paciente</th>
                  <th style={S.th}>Proveedor</th>
                  <th style={S.th}>Factura N°</th>
                  <th style={S.th}>OC</th>
                  <th style={S.th}>Período</th>
                  <th style={S.th}>Monto</th>
                  <th style={S.th}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((r, i) => {
                  const per = parsePeriodo(r.mes);
                  const est = estadoDesdeTexto(r.estado) || (limpiarDato(r.nroFactura) ? "RECIBIDA" : "SIN FACTURA");
                  return (
                    <tr key={i}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{normNombre(r.paciente)}</td>
                      <td style={S.td}>{mapProveedor(r.proveedor) || "-"}</td>
                      <td style={S.td}>{limpiarDato(r.nroFactura) || "-"}</td>
                      <td style={S.td}>{limpiarDato(r.oc) || "-"}</td>
                      <td style={{ ...S.td, color: per ? "#0f172a" : "#dc2626" }}>{per || "sin fecha"}</td>
                      <td style={{ ...S.td, textAlign: "right" }}>{plata(parseMonto(r.monto))}</td>
                      <td style={S.td}><Chip estado={est} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 14 }}>
            <button style={S.btn} onClick={importar} disabled={importando}>
              {importando ? "Importando..." : `Importar ${filas.length} filas a ${usuarioDestino}`}
            </button>
          </div>
        </>
      )}

      {msg && (
        <div style={{ marginTop: 12, padding: 10, background: "#f1f5f9", borderRadius: 6, fontSize: 13 }}>{msg}</div>
      )}

      {resultado && (
        <div style={{ marginTop: 12, padding: 12, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, fontSize: 14 }}>
          <b>Importación lista.</b><br />
          Facturas nuevas: <b>{resultado.facturasNuevas}</b><br />
          Facturas ya existentes (omitidas): <b>{resultado.facturasOmitidas}</b><br />
          Pacientes nuevos creados: <b>{resultado.pacientesNuevos}</b>
          {resultado.sinPeriodo > 0 && <><br /><span style={{ color: "#b45309" }}>Filas sin período reconocible: {resultado.sinPeriodo} (revisá la columna Mes Prestacional).</span></>}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   APP
   ============================================================ */
function GateAdmin({ onOk }) {
  const [clave, setClave] = useState("");
  const [ver, setVer] = useState(false);
  const [error, setError] = useState("");
  const probar = () => {
    if (clave === ADMIN_PASSWORD) onOk();
    else setError("Clave incorrecta");
  };
  return (
    <div style={{ ...S.card, maxWidth: 420 }}>
      <h3 style={{ marginTop: 0, color: "#1e3a5f" }}>🔒 Zona de administración</h3>
      <p style={{ fontSize: 13, color: "#64748b" }}>
        Esta sección incluye la carga masiva y la restauración de la base. Ingresá la clave de administrador para continuar.
      </p>
      <Campo label="Clave de administrador">
        <div style={{ position: "relative" }}>
          <input type={ver ? "text" : "password"} style={{ ...S.input, paddingRight: 66 }} value={clave} autoFocus
            onChange={(e) => { setClave(e.target.value); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") probar(); }} />
          <button type="button" onClick={() => setVer((v) => !v)}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#1e3a5f", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 4 }}>
            {ver ? "Ocultar" : "Ver"}
          </button>
        </div>
      </Campo>
      {error && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{error}</div>}
      <button style={S.btn} onClick={probar}>Desbloquear</button>
    </div>
  );
}

export default function App() {
  const [sesion, setSesion] = useState(null);
  const [listo, setListo] = useState(false);
  const [vista, setVista] = useState("resumen");
  const [adminOK, setAdminOK] = useState(false);

  const [pacientes, setPacientes] = useState([]);
  const [expedientes, setExpedientes] = useState([]);
  const [facturas, setFacturas] = useState([]);
  const [transferencias, setTransferencias] = useState([]);

  useEffect(() => {
    const un = onAuthStateChanged(auth, (u) => {
      if (u) setListo(true);
      else signInAnonymously(auth).catch((e) => console.error("Auth:", e));
    });
    return un;
  }, []);

  useEffect(() => {
    if (!listo) return;
    const subs = [
      onSnapshot(query(collection(db, COL_PACIENTES)), (s) =>
        setPacientes(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, COL_EXPEDIENTES)), (s) =>
        setExpedientes(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, COL_FACTURAS)), (s) =>
        setFacturas(s.docs.map((d) => {
          const f = { id: d.id, ...d.data() };
          f.estado = normEstado(f.estado);
          return f;
        }))),
      onSnapshot(query(collection(db, COL_TRANSFERENCIAS)), (s) =>
        setTransferencias(s.docs.map((d) => ({ id: d.id, ...d.data() }))))
    ];
    return () => subs.forEach((u) => u());
  }, [listo]);

  const api = useMemo(() => ({
    crearFactura: async (d) => {
      const id = "FAC-" + Date.now();
      await setDoc(doc(db, COL_FACTURAS, id), {
        ...d,
        historial: [{ estado: d.estado, fecha: hoy(), usuario: sesion?.usuario, nota: "creada" }]
      });
    },

    actualizarFactura: async (id, cambios, nota) => {
      const act = facturas.find((f) => f.id === id);
      const hist = [...(act?.historial || [])];
      if (cambios.estado && cambios.estado !== act?.estado) {
        hist.push({ estado: cambios.estado, fecha: hoy(), usuario: sesion?.usuario, nota: nota || "" });
      }
      await updateDoc(doc(db, COL_FACTURAS, id), { ...cambios, historial: hist });
    },

    transferir: async ({ pacientes: pacs, destino, motivo, facturasAbiertas, exptesVigentes }) => {
      const batch = writeBatch(db);
      const fecha = hoy();

      for (const p of pacs) {
        const hist = [...(p.historialAsignacion || []),
          { desde: fecha, usuario: destino, motivo, transferidoPor: sesion?.usuario }];
        batch.update(doc(db, COL_PACIENTES, p.id), { usuarioAsignado: destino, historialAsignacion: hist });

        const fs = facturasAbiertas.filter((f) => f.paciente === p.nombre);
        fs.forEach((f) => batch.update(doc(db, COL_FACTURAS, f.id), { usuarioAsignado: destino }));

        const es = exptesVigentes.filter((e) => e.paciente === p.nombre);
        es.forEach((e) => batch.update(doc(db, COL_EXPEDIENTES, e.id), { usuarioAsignado: destino }));

        const tid = "TR-" + Date.now() + "-" + p.id;
        batch.set(doc(db, COL_TRANSFERENCIAS, tid), {
          fecha, paciente: p.nombre, pacienteId: p.id,
          usuarioAnterior: p.usuarioAsignado || "", usuarioNuevo: destino,
          motivo, facturasMovidas: fs.length, exptesMovidos: es.length,
          hechoPor: sesion?.usuario, timestamp: Date.now()
        });
      }
      await batch.commit();
    },

    importarSeed: async (data, progreso) => {
      let n = 0;
      const escribir = async (col, items) => {
        for (let i = 0; i < items.length; i += 400) {
          const batch = writeBatch(db);
          items.slice(i, i + 400).forEach((it) => {
            const { id, ...resto } = it;
            batch.set(doc(db, col, id), resto);
          });
          await batch.commit();
          n += Math.min(400, items.length - i);
          progreso && progreso(`Escribiendo ${col}... ${n} documentos`);
        }
      };
      await escribir(COL_PACIENTES, data.pacientes || []);
      await escribir(COL_EXPEDIENTES, data.expedientes || []);
      await escribir(COL_FACTURAS, data.facturas || []);
      return n;
    },

    // Corrige SOLO el usuarioAsignado (y, si viene, el proveedor) de pacientes existentes,
    // matcheando por nombre normalizado. No crea, no borra, no toca facturas ni expedientes.
    // Recibe filas [{nombre, usuario, proveedor?}].
    reasignarPacientes: async (filas, progreso) => {
      const norm = (s) => (s || "").toString().trim().toUpperCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
      const snap = await getDocs(collection(db, COL_PACIENTES));
      const idxPorNombre = {};
      snap.forEach((d) => { idxPorNombre[norm(d.data().nombre)] = { id: d.id, data: d.data() }; });
      const res = { actualizados: 0, sinMatch: [] };
      let cambios = [];
      for (const fila of filas) {
        const hit = idxPorNombre[norm(fila.nombre)];
        if (!hit) { res.sinMatch.push(fila.nombre); continue; }
        const patch = {};
        if (fila.usuario && hit.data.usuarioAsignado !== fila.usuario) patch.usuarioAsignado = fila.usuario;
        if (fila.proveedor && hit.data.proveedor !== fila.proveedor) patch.proveedor = fila.proveedor;
        if (Object.keys(patch).length) cambios.push({ id: hit.id, patch });
      }
      for (let i = 0; i < cambios.length; i += 400) {
        const batch = writeBatch(db);
        cambios.slice(i, i + 400).forEach((c) => batch.update(doc(db, COL_PACIENTES, c.id), c.patch));
        await batch.commit();
        res.actualizados += Math.min(400, cambios.length - i);
        progreso && progreso(`Actualizando asignaciones... ${res.actualizados}`);
      }
      return res;
    },

    // Importa un padrón de facturación (filas ya normalizadas).
    // Matchea pacientes por nombre contra los que ya existen; crea los que faltan.
    // Es idempotente: cada factura tiene un ID derivado de su contenido, así
    // que reimportar el mismo padrón NO duplica ni pisa lo ya cargado.
    importarPadron: async ({ filas, usuarioDestino, moduloDefault, progreso }) => {
      const res = { pacientesNuevos: 0, facturasNuevas: 0, facturasOmitidas: 0, sinPeriodo: 0 };

      const idxPac = {};
      pacientes.forEach((p) => { idxPac[normNombre(p.nombre)] = p; });
      const idsFactura = new Set(facturas.map((f) => f.id));

      const escrituras = [];

      for (const row of filas) {
        const nombre = normNombre(row.paciente);
        if (!nombre) continue;

        let pac = idxPac[nombre];
        let pacId;
        if (pac) {
          pacId = pac.id;
        } else {
          pacId = "PAC-" + nombre.replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
          const nuevo = {
            nombre, usuarioAsignado: usuarioDestino, estado: "ACTIVO",
            modulos: [], dni: "",
            historialAsignacion: [{ desde: hoy(), usuario: usuarioDestino, motivo: "alta por import de padrón" }]
          };
          escrituras.push({ col: COL_PACIENTES, id: pacId, data: nuevo });
          idxPac[nombre] = { id: pacId, ...nuevo };
          res.pacientesNuevos++;
        }

        const periodo = parsePeriodo(row.mes);
        if (!periodo) res.sinPeriodo++;
        const [anio, mes] = periodo ? periodo.split("-").map(Number) : [null, null];
        const nroFactura = limpiarDato(row.nroFactura);
        const oc = limpiarDato(row.oc);
        const estadoExcel = estadoDesdeTexto(row.estado);
        const estado = estadoExcel || (nroFactura ? "RECIBIDA" : "SIN FACTURA");

        const clave = (nombre + "|" + periodo + "|" + nroFactura + "|" + oc)
          .replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
        const facId = ("FAC-IMP-" + clave).slice(0, 400);

        if (idsFactura.has(facId)) { res.facturasOmitidas++; continue; }

        escrituras.push({
          col: COL_FACTURAS, id: facId, data: {
            periodo, anio, mes,
            paciente: nombre, pacienteId: pacId,
            modulo: moduloDefault || "INTERNACION",
            usuarioAsignado: usuarioDestino,
            expedienteId: "",
            proveedor: mapProveedor(row.proveedor),
            nroFactura, sige: "", oc, monto: parseMonto(row.monto),
            nroExpedienteFacturacion: "", nroResolucionPago: "",
            estado,
            fechaAuditoria: null, fechaAsesoria: null, fechaTribunal: null,
            fechaTesoreria: estado === "TESORERIA" ? hoy() : null,
            observaciones: limpiarDato(row.observaciones),
            historial: [{ estado, fecha: hoy(), usuario: usuarioDestino, nota: "importada del padrón" }]
          }
        });
        idsFactura.add(facId);
        res.facturasNuevas++;
      }

      let hechas = 0;
      for (let i = 0; i < escrituras.length; i += 400) {
        const batch = writeBatch(db);
        escrituras.slice(i, i + 400).forEach((w) => batch.set(doc(db, w.col, w.id), w.data));
        await batch.commit();
        hechas += Math.min(400, escrituras.length - i);
        progreso && progreso(`Guardando... ${hechas}/${escrituras.length}`);
      }
      return res;
    }
  }), [facturas, pacientes, sesion]);

  const fallecidos = useMemo(() => {
    const s = new Set();
    pacientes.forEach((p) => { if (normalizar(p.estado) === "FALLECIDO") s.add(normalizar(p.nombre)); });
    return s;
  }, [pacientes]);

  if (!sesion) return <Login onEntrar={setSesion} />;

  if (!listo) {
    return (
      <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#64748b" }}>Conectando...</div>
      </div>
    );
  }

  const jefe = !!sesion.jefatura;
  const TABS = jefe
    ? [["resumen", "Resumen"]]
    : [
        ["facturacion", "Facturación"],
        ["armar", "Armar expediente"],
        ["seguimiento", "Seguimiento"],
        ["reclamos", "Reclamos"],
        ["pacientes", "Pacientes"],
        ["expedientes", "Expedientes"],
        ["transferencias", "Transferencias"],
        ["importar", "Importar"],
        ["admin", "Admin"]
      ];
  const tabKeys = TABS.map((t) => t[0]);
  const vistaActiva = tabKeys.includes(vista) ? vista : tabKeys[0];

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>Facturación PRIS</div>
          <div style={{ fontSize: 11, opacity: 0.8 }}>Internación Domiciliaria · SIPROSA</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13 }}>{jefe ? "RESUMEN" : sesion.usuario}</span>
          <button style={{ ...S.btnAlt, padding: "5px 10px", fontSize: 13 }} onClick={() => { setSesion(null); setAdminOK(false); }}>
            Salir
          </button>
        </div>
      </div>

      <div style={S.nav}>
        {TABS.map(([k, l]) => (
          <button key={k} style={S.tab(vistaActiva === k)} onClick={() => setVista(k)}>{l}</button>
        ))}
      </div>

      <div style={S.main}>
        {vistaActiva === "resumen" && (
          <VistaResumen facturas={facturas} pacientes={pacientes} expedientes={expedientes} fallecidos={fallecidos} />
        )}
        {vistaActiva === "facturacion" && (
          <VistaFacturacion facturas={facturas} pacientes={pacientes}
            expedientes={expedientes} sesion={sesion} api={api} fallecidos={fallecidos} />
        )}
        {vistaActiva === "armar" && (
          <VistaArmarExpediente facturas={facturas} pacientes={pacientes}
            expedientes={expedientes} sesion={sesion} api={api} fallecidos={fallecidos} />
        )}
        {vistaActiva === "seguimiento" && (
          <VistaSeguimiento facturas={facturas} sesion={sesion} api={api} fallecidos={fallecidos} />
        )}
        {vistaActiva === "pacientes" && (
          <VistaPacientes pacientes={pacientes} facturas={facturas}
            expedientes={expedientes} sesion={sesion} api={api} />
        )}
        {vistaActiva === "expedientes" && (
          <VistaExpedientes expedientes={expedientes} sesion={sesion} api={api} />
        )}
        {vistaActiva === "reclamos" && (
          <VistaReclamos facturas={facturas} pacientes={pacientes}
            expedientes={expedientes} sesion={sesion} api={api} fallecidos={fallecidos} />
        )}
        {vistaActiva === "transferencias" && (
          <VistaTransferencias transferencias={transferencias} />
        )}
        {vistaActiva === "importar" && (
          <VistaImportar sesion={sesion} api={api} />
        )}
        {vistaActiva === "admin" && (
          adminOK
            ? <VistaAdmin api={api} pacientes={pacientes} expedientes={expedientes} facturas={facturas} />
            : <GateAdmin onOk={() => setAdminOK(true)} />
        )}
      </div>
    </div>
  );
}
