import { useState, useEffect, useMemo } from "react";
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
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwXnUvwLx91Y88AX7wDT9M7sSkp76vJ888aErmcWMT7-E7csttQVho31TZfk1G6lPnk/exec";
const APPS_SCRIPT_CLAVE = "GESTORPRIS2026";

// Contraseña de acceso (la misma del panel admin de visitas-siprosa)
const ADMIN_PASSWORD = "gerenciapris626";

// Logos (copiá los archivos desde la carpeta /public de visitas-siprosa)
const LOGO_PRIS = "/logo-pris.png";
const LOGO_GOBIERNO = "/logo-gobierno.png";

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

function generarCuerpoMail(exp) {
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
Gerencia Administrativa
Programa Integrado de Salud – SI.PRO.SA.`
  );
}

function numeroEnLetrasSimple(n) {
  const letras = ["cero","uno","dos","tres","cuatro","cinco","seis","siete","ocho","nueve","diez","once","doce"];
  return letras[n] || n;
}

function leerArchivoBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("No se pudo leer " + file.name));
    r.readAsDataURL(file);
  });
}

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
  const [vista, setVista] = useState("tablero"); // tablero | nuevo | detalle | proveedores
  const [expedientes, setExpedientes] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [expedienteSel, setExpedienteSel] = useState(null);

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
        <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          <button style={vista === "tablero" ? S.btn : S.btnSec} onClick={() => setVista("tablero")}>📋 Tablero</button>
          <button style={vista === "nuevo" ? S.btn : S.btnSec} onClick={() => setVista("nuevo")}>➕ Nuevo expediente</button>
          <button style={vista === "proveedores" ? S.btn : S.btnSec} onClick={() => setVista("proveedores")}>🏢 Proveedores</button>
          <div style={{ flex: 1 }} />
          <button style={S.btnRojo} onClick={() => { localStorage.removeItem("gexp_login"); setLogueado(false); }}>Salir</button>
        </div>

        {vista === "tablero" && (
          <Tablero
            expedientes={expedientes}
            abrir={(e) => { setExpedienteSel(e); setVista("detalle"); }}
          />
        )}
        {vista === "nuevo" && (
          <NuevoExpediente
            onCreado={(e) => { setExpedienteSel(e); setVista("detalle"); }}
            onCancelar={() => setVista("tablero")}
          />
        )}
        {vista === "detalle" && expedienteVivo && (
          <DetalleExpediente
            exp={expedienteVivo}
            proveedores={proveedores}
            volver={() => { setExpedienteSel(null); setVista("tablero"); }}
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
  const [error, setError] = useState(false);
  const entrar = () => {
    if (clave === ADMIN_PASSWORD) onOk();
    else setError(true);
  };
  return (
    <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...S.card, width: 340, textAlign: "center" }}>
        <img src={LOGO_PRIS} alt="" style={{ maxWidth: "85%", height: "auto", marginBottom: 10 }} onError={(e) => (e.target.style.display = "none")} />
<img src={LOGO_GOBIERNO} alt="" style={{ maxWidth: "70%", height: "auto", marginBottom: 10 }} onError={(e) => (e.target.style.display = "none")} />
        <h2 style={{ color: "#075e75", marginBottom: 4 }}>Gestor de Expedientes</h2>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>Internación Domiciliaria · PRIS</div>
        <input
          type="password"
          placeholder="Contraseña"
          autoComplete="new-password"
          style={S.input}
          value={clave}
          onChange={(e) => { setClave(e.target.value); setError(false); }}
          onKeyDown={(e) => e.key === "Enter" && entrar()}
        />
        {error && <div style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>Contraseña incorrecta</div>}
        <button style={{ ...S.btn, width: "100%", marginTop: 14 }} onClick={entrar}>Ingresar</button>
      </div>
    </div>
  );
}

/* ---------- Tablero ---------- */

function Tablero({ expedientes, abrir }) {
  if (expedientes.length === 0) {
    return (
      <div style={{ ...S.card, textAlign: "center", color: "#64748b", padding: 40 }}>
        Todavía no hay expedientes cargados.<br />Creá el primero con el botón <b>➕ Nuevo expediente</b>.
      </div>
    );
  }
  return expedientes.map((e) => {
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
  });
}

/* ---------- Nuevo expediente ---------- */

function NuevoExpediente({ onCreado, onCancelar }) {
  const [f, setF] = useState({
    nroExpediente: "", paciente: "", dni: "", fechaNacimiento: "",
    domicilio: "", telefono: "", diagnostico: "", modulo: "",
    detalleServicios: "", periodoMeses: 6, periodoTexto: "",
  });
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const edad = calcularEdad(f.fechaNacimiento);

  const guardar = async () => {
    if (!f.nroExpediente || !f.paciente || !f.dni || !f.modulo) {
      alert("Completá al menos: N° de expediente, paciente, DNI y módulo.");
      return;
    }
    setGuardando(true);
    try {
      const data = { ...f, edad, etapa: 0, creado: new Date().toISOString() };
      const ref = await addDoc(collection(db, COL_EXPEDIENTES), data);
      onCreado({ id: ref.id, ...data });
    } catch (e) {
      alert("Error al guardar: " + e.message);
    }
    setGuardando(false);
  };

  return (
    <div style={S.card}>
      <h3 style={{ color: "#075e75", marginBottom: 4 }}>Nuevo expediente</h3>
      <div style={{ fontSize: 13, color: "#64748b" }}>Estos datos se usan para el mail de cotización y para todos los documentos posteriores. Se cargan una sola vez.</div>

      <label style={S.label}>N° de expediente (ej: 1694/415/G/2026)</label>
      <input style={S.input} value={f.nroExpediente} onChange={set("nroExpediente")} placeholder="0000/000/G/2026" />

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

      <label style={S.label}>Detalle de servicios mensuales (lo autorizado por Auditoría Médica)</label>
      <textarea style={{ ...S.input, minHeight: 70 }} value={f.detalleServicios} onChange={set("detalleServicios")} placeholder="Alimentación: BOMBA DE INFUSIÓN ENTERAL PARA SOPORTE NUTRICIONAL ENTERAL PARA GASTROTOMIA (x15 set)" />

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

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button style={S.btn} onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando..." : "💾 Crear expediente"}
        </button>
        <button style={S.btnSec} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

/* ---------- Detalle de expediente ---------- */

function DetalleExpediente({ exp, proveedores, volver }) {
  return (
    <div>
      <button style={{ ...S.btnSec, marginBottom: 12 }} onClick={volver}>← Volver al tablero</button>

      <div style={S.card}>
        <div style={{ fontWeight: 800, fontSize: 18, color: "#075e75" }}>{exp.paciente.toUpperCase()}</div>
        <div style={{ fontSize: 14, color: "#475569", marginTop: 4 }}>
          <b>Expte.:</b> {exp.nroExpediente} · <b>DNI:</b> {exp.dni} · <b>Edad:</b> {exp.edad} años
        </div>
        <div style={{ fontSize: 14, color: "#475569" }}><b>Diagnóstico:</b> {exp.diagnostico}</div>
        <div style={{ fontSize: 14, color: "#475569" }}><b>Módulo:</b> {exp.modulo}</div>
        <div style={{ fontSize: 14, color: "#475569" }}><b>Período:</b> {exp.periodoMeses} meses {exp.periodoTexto && `(${exp.periodoTexto})`}</div>
      </div>

      {/* semáforo de etapas */}
      <div style={{ ...S.card, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {ETAPAS.map((nombre, i) => (
          <span key={i} style={S.chip(i === exp.etapa, i < exp.etapa)}>
            {i < exp.etapa ? "✓ " : ""}{nombre}
          </span>
        ))}
      </div>

      {exp.etapa === 0 && <EnvioCotizacion exp={exp} proveedores={proveedores} />}
      {exp.etapa >= 1 && exp.cotizacion && (
        <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
          <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Cotización enviada</div>
          <div style={{ fontSize: 14, color: "#334155" }}>
            <b>Fecha de envío:</b> {formatearFecha(exp.cotizacion.fecha)}<br />
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
      {exp.etapa >= 1 && (
        <div style={{ ...S.card, background: "#f8fafc", color: "#64748b", fontSize: 14 }}>
          🔜 <b>Próxima etapa: registro de presupuestos y cuadro comparativo</b> — se habilita en la Fase 2 del desarrollo.
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

/* ---------- Envío de cotización ---------- */

function EnvioCotizacion({ exp, proveedores }) {
  const activos = proveedores.filter((p) => p.activo);
  const [seleccion, setSeleccion] = useState({});
  const [asunto, setAsunto] = useState(`SOLICITAMOS COTIZACION PARA ${exp.paciente.toUpperCase()}`);
  const [cuerpo, setCuerpo] = useState(generarCuerpoMail(exp));
  const [archivos, setArchivos] = useState([]);
  const [enviando, setEnviando] = useState(false);

  // por defecto, todos los proveedores activos marcados
  useEffect(() => {
    const sel = {};
    activos.forEach((p) => (sel[p.id] = true));
    setSeleccion(sel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedores.length]);

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

      <label style={S.label}>Asunto</label>
      <input style={S.input} value={asunto} onChange={(e) => setAsunto(e.target.value)} />

      <label style={S.label}>Cuerpo del mail (podés editarlo antes de enviar)</label>
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
    </div>
  );
}

/* ---------- Proveedores ---------- */

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
