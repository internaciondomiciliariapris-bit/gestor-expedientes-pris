# GESTOR DE EXPEDIENTES PRIS — Instalación Fase 1

Proyecto nuevo, separado de visitas-siprosa y del generador de resoluciones.
Todo se hace desde el navegador, como siempre.

---

## PASO 1 — Crear el repositorio en GitHub

1. Entrá a github.com con tu cuenta (internaciondomiciliariapris-bit)
2. New repository → nombre: **gestor-expedientes-pris** → Public → Create
3. Subí los archivos de este proyecto respetando las carpetas:
   - `package.json`
   - `vite.config.js`
   - `vercel.json`
   - `index.html`
   - `INSTRUCCIONES.md` (este archivo, opcional)
   - `src/main.jsx`
   - `src/App.jsx`
   - (la carpeta `apps-script` NO hace falta subirla, es para el Paso 3)

## PASO 2 — Copiar los logos

1. Abrí el repositorio de **visitas-siprosa** → carpeta `public`
2. Descargá los dos logos institucionales (PRIS y Gobierno de Tucumán)
3. Subilos a la carpeta `public` del repo nuevo con estos nombres exactos:
   - `logo-pris.png`
   - `logo-gobierno.png`
   (Si tienen otro nombre en el repo viejo, simplemente renombralos al subirlos.
   Si preferís mantener los nombres originales, cambiá las constantes
   LOGO_PRIS y LOGO_GOBIERNO al inicio de src/App.jsx)

## PASO 3 — Crear el NUEVO Apps Script (Gmail + Drive)

⚠️ Es un Apps Script NUEVO, separado del de facturación. No tocar el viejo.

1. Entrá a **script.google.com** con la cuenta internaciondomiciliariapris@gmail.com
2. Nuevo proyecto → nombre: "Gestor Expedientes PRIS"
3. Borrá lo que haya y pegá TODO el contenido de `apps-script/Codigo.gs`
4. Implementar → Nueva implementación → tipo: **Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona**
5. Autorizá los permisos (Gmail y Drive) cuando los pida
6. Copiá la URL que termina en **/exec**

## PASO 4 — Completar las constantes en src/App.jsx

Al inicio del archivo hay un bloque marcado. Completá:

1. **firebaseConfig** → copiá el mismo bloque firebaseConfig que está en el
   App.jsx de visitas-siprosa (mismo proyecto de Firebase, comparte la base)
2. **APPS_SCRIPT_URL** → la URL /exec del Paso 3

La clave GESTORPRIS2026 ya está puesta en los dos lados. No hace falta tocarla.

## PASO 5 — Conectar Vercel

1. Entrá a vercel.com → Add New → Project
2. Importá el repositorio **gestor-expedientes-pris**
3. Deploy (detecta Vite solo, no hay que configurar nada)
4. La app queda en: gestor-expedientes-pris.vercel.app

## PASO 6 — Primera prueba

1. Entrá a la app → contraseña: **gerenciapris626**
2. Pestaña **🏢 Proveedores** → botón "Cargar los 6 proveedores habituales"
   → verificá que estén los correos correctos y corregí lo que haga falta
3. **➕ Nuevo expediente** → cargá uno de PRUEBA (podés usar datos inventados)
4. Entrá al expediente → **✉️ Enviar pedido de cotización**
   - ⚠️ PARA LA PRIMERA PRUEBA: desmarcá todos los proveedores reales,
     creá antes un proveedor de prueba con TU correo personal,
     y enviale solo a ese. Así verificás que llega bien sin molestar
     a las empresas.
5. Verificá: que llegue el mail, que esté el adjunto, y que en el Drive
   aparezca la carpeta "GESTOR EXPEDIENTES PRIS" con la subcarpeta del
   expediente y los archivos adentro.

---

## Qué hace la Fase 1

- Tablero de expedientes con semáforo de 8 etapas
- Carga única de datos del paciente/expediente
- Mail de cotización automático a todos los proveedores (texto oficial
  prellenado y editable), con adjuntos, desde la casilla institucional
- Contador de 5 días hábiles con alerta de plazo vencido
- Carpeta automática por expediente en el Drive
- Gestión de proveedores: agregar, editar, activar/desactivar

## Próximas fases

- **Fase 2:** registro de presupuestos + cuadro comparativo automático + nota de afectación presupuestaria (con monto en letras)
- **Fase 3:** pases (Letrada / Tribunal) + resolución de contratación + orden de compra + mail final al adjudicado
- **Fase 4:** alertas de renovación a los 6 meses
