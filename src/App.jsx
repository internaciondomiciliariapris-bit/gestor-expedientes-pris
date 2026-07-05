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

--
Confirmar Recepción
Atte. ${firmante}
Internaciones Domiciliarias
Oficina de Compras y Contrataciones
Gerencia Administrativa
Programa Integrado de Salud – SI.PRO.SA.`
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
  if (!usuario) return <SeleccionUsuario onElegir={elegirUsuario} />;

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
          >👤 {usuario} ▾</span>
          <button style={S.btnRojo} onClick={() => { localStorage.removeItem("gexp_login"); localStorage.removeItem("gexp_usuario"); setUsuario(""); setLogueado(false); }}>Salir</button>
        </div>

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

function SeleccionUsuario({ onElegir }) {
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

      <label style={S.label}>N° de expediente (ej: 1694/415/G/2026){modo === "renovar" && " — PONÉ EL NÚMERO NUEVO"}</label>
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

      {exp.etapa === 0 && <EnvioCotizacion exp={exp} proveedores={proveedores} />}
      {exp.etapa >= 1 && exp.cotizacion && (
        <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
          <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Cotización enviada</div>
          <div style={{ fontSize: 14, color: "#334155" }}>
            <b>Fecha de envío:</b> {formatearFecha(exp.cotizacion.fecha)}<br />
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
            <b>Precio mensual:</b> {formatoPesos(exp.cuadro.mensual)} · <b>Total {exp.periodoMeses} meses:</b> {formatoPesos(exp.cuadro.total)}<br />
            {exp.cuadro.pdfUrl && <a href={exp.cuadro.pdfUrl} target="_blank" rel="noreferrer" style={{ color: "#0891b2", fontWeight: 700 }}>📄 Cuadro en PDF (para SIGEDIG)</a>}
            {exp.cuadro.docUrl && <> · <a href={exp.cuadro.docUrl} target="_blank" rel="noreferrer" style={{ color: "#0891b2", fontWeight: 700 }}>✏️ Versión editable (Google Doc)</a></>}
          </div>
        </div>
      )}

      {exp.etapa === 3 && <GenerarNota exp={exp} />}

      {exp.etapa >= 4 && exp.nota && (
        <div style={{ ...S.card, borderLeft: "5px solid #16a34a" }}>
          <div style={{ fontWeight: 800, color: "#166534", marginBottom: 6 }}>✅ Nota de afectación presupuestaria generada</div>
          <div style={{ fontSize: 14, color: "#334155" }}>
            <b>Importe total:</b> {formatoPesos(exp.nota.monto)} ({exp.nota.montoLetras})<br />
            {exp.nota.pdfUrl && <a href={exp.nota.pdfUrl} target="_blank" rel="noreferrer" style={{ color: "#0891b2", fontWeight: 700 }}>📄 Nota en PDF (para SIGEDIG)</a>}
            {exp.nota.docUrl && <> · <a href={exp.nota.docUrl} target="_blank" rel="noreferrer" style={{ color: "#0891b2", fontWeight: 700 }}>✏️ Versión editable (Google Doc)</a></>}
          </div>
        </div>
      )}

      {exp.etapa >= 4 && (
        <div style={{ ...S.card, background: "#f8fafc", color: "#64748b", fontSize: 14 }}>
          🔜 <b>Próximas etapas: pases, resolución de contratación y orden de compra</b> — se habilitan en la Fase 3 del desarrollo. Mientras tanto, con el cuadro y la nota en PDF ya podés subir al SIGEDIG y girar a Asesoría Letrada como siempre.
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
  const firmaInicial = (USUARIOS.find((u) => u.id === exp.responsable)?.firma) || FIRMANTES[0];
  const [seleccion, setSeleccion] = useState({});
  const [firmante, setFirmante] = useState(firmaInicial);
  const [asunto, setAsunto] = useState(`SOLICITAMOS COTIZACION PARA ${exp.paciente.toUpperCase()}`);
  const [cuerpo, setCuerpo] = useState(generarCuerpoMail(exp, firmaInicial));
  const [archivos, setArchivos] = useState([]);
  const [enviando, setEnviando] = useState(false);

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

  const generarCuadro = async () => {
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

    if (!confirm(`CUADRO COMPARATIVO\n\nAdjudicación al menor precio:\n→ ${ganador}: ${formatoPesos(g.mensual)}/mes · Total ${exp.periodoMeses} meses: ${formatoPesos(total)}\n\n¿Generar el cuadro comparativo en PDF?`)) return;

    setOcupado(true);
    try {
      const lista = consultados.map((n) => ({
        nombre: n,
        estado: guardados[n]?.estado || "sin_respuesta",
        unitario: guardados[n]?.unitario || null,
        mensual: guardados[n]?.mensual || null,
      }));
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({
          accion: "generarCuadro", clave: APPS_SCRIPT_CLAVE,
          nroExpediente: exp.nroExpediente, paciente: exp.paciente,
          modulo: exp.modulo, detalleServicios: exp.detalleServicios,
          periodoTexto: exp.periodoTexto, periodoMeses: exp.periodoMeses,
          proveedores: lista,
          adjudicado: { nombre: ganador, unitario: g.unitario, mensual: g.mensual, total },
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Error en Apps Script");
      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
        etapa: 3,
        cuadro: {
          fecha: new Date().toISOString(),
          adjudicado: ganador,
          unitario: g.unitario, mensual: g.mensual, total,
          pdfUrl: data.pdfUrl || "", docUrl: data.docUrl || "",
        },
      });
      alert("✅ Cuadro comparativo generado. Adjudicado: " + ganador);
    } catch (e) {
      alert("❌ Error al generar el cuadro: " + e.message);
    }
    setOcupado(false);
  };

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #f59e0b" }}>
      <h3 style={{ color: "#075e75", marginBottom: 4 }}>📬 Registro de presupuestos</h3>
      <div style={{ fontSize: 13, color: "#64748b" }}>
        A medida que respondan al mail, cargá acá cada proveedor: estado, precios y el PDF del presupuesto (queda guardado en el Drive del expediente). Cuando estén todos, generá el cuadro comparativo.
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

      <button style={{ ...S.btn, marginTop: 18, width: "100%", fontSize: 16, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={generarCuadro}>
        {ocupado ? "⏳ Procesando..." : "📊 GENERAR CUADRO COMPARATIVO (adjudica al menor precio)"}
      </button>
    </div>
  );
}

/* ---------- Nota de afectación presupuestaria (Fase 2) ---------- */

function GenerarNota({ exp }) {
  const monto = (exp.cuadro?.mensual || 0) * Number(exp.periodoMeses || 6);
  const [directora, setDirectora] = useState("Dra. Noellia Bottone");
  const [imputacion, setImputacion] = useState(
    "Jur: 67, U.O: 965, Fin/Fun: 314, Proy: 00, Subp: 00, Progr: 19, A/OB: 01, Part. Ppal.: 300, Subp: 322 – Fuente de financiamiento Nº 10 – Recursos Tesoro General de la Provincia – Presupuesto 2026"
  );
  const [ocupado, setOcupado] = useState(false);

  const generar = async () => {
    if (!exp.periodoTexto && !confirm("El expediente no tiene el período en texto (ej: Julio 2026 a Diciembre 2026). Podés cargarlo con ✏️ Editar datos. ¿Generar la nota igual?")) return;
    setOcupado(true);
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({
          accion: "generarNota", clave: APPS_SCRIPT_CLAVE,
          nroExpediente: exp.nroExpediente, paciente: exp.paciente, dni: exp.dni,
          modulo: exp.modulo, periodoTexto: exp.periodoTexto || "", periodoMeses: exp.periodoMeses,
          monto, directora, imputacion,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Error en Apps Script");
      await updateDoc(doc(db, COL_EXPEDIENTES, exp.id), {
        etapa: 4,
        nota: {
          fecha: new Date().toISOString(),
          monto, montoLetras: data.montoLetras || "",
          directora, imputacion,
          pdfUrl: data.pdfUrl || "", docUrl: data.docUrl || "",
        },
      });
      alert("✅ Nota de afectación generada.");
    } catch (e) {
      alert("❌ Error al generar la nota: " + e.message);
    }
    setOcupado(false);
  };

  return (
    <div style={{ ...S.card, borderLeft: "5px solid #f59e0b" }}>
      <h3 style={{ color: "#075e75", marginBottom: 4 }}>📄 Nota de afectación presupuestaria</h3>
      <div style={{ fontSize: 13, color: "#64748b" }}>
        Informa a la Dirección el gasto del período. El importe sale del cuadro comparativo y se escribe también en letras, automáticamente.
      </div>

      <div style={{ background: "#e0f2fe", borderRadius: 8, padding: 10, marginTop: 12, fontSize: 14, color: "#075e75", fontWeight: 700 }}>
        Importe total ({exp.periodoMeses} meses · {exp.cuadro?.adjudicado}): {formatoPesos(monto)}
      </div>

      <label style={S.label}>Dirigida a (Directora del Programa)</label>
      <input style={S.input} value={directora} onChange={(e) => setDirectora(e.target.value)} />

      <label style={S.label}>Imputación presupuestaria (revisala si cambió el ejercicio)</label>
      <textarea style={{ ...S.input, minHeight: 70 }} value={imputacion} onChange={(e) => setImputacion(e.target.value)} />

      <button style={{ ...S.btn, marginTop: 16, width: "100%", fontSize: 16, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado} onClick={generar}>
        {ocupado ? "⏳ Generando..." : "📄 GENERAR NOTA DE AFECTACIÓN (PDF)"}
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
