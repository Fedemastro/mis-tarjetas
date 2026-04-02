# Mis Tarjetas — Guía de instalación

App para controlar gastos de tarjetas de crédito con sincronización via Google Sheets.

---

## Archivos del proyecto

```
tarjetas-app/
├── index.html   → la app completa
├── app.js       → lógica de la aplicación
├── sheets.js    → módulo de sincronización con Google Sheets
└── README.md    → esta guía
```

---

## Paso 1 — Subir a GitHub Pages

1. Entrá a **github.com** y creá una cuenta si no tenés (es gratis)
2. Hacé click en **New repository**
3. Ponele de nombre: `mis-tarjetas` (o el que quieras)
4. Dejalo en **Public**, sin inicializar con README
5. Hacé click en **Create repository**
6. En la página del repo, hacé click en **uploading an existing file**
7. Arrastrá los 4 archivos: `index.html`, `app.js`, `sheets.js`, `README.md`
8. Hacé click en **Commit changes**
9. Andá a **Settings → Pages**
10. En "Source", seleccioná **Deploy from a branch → main → / (root)**
11. Guardá. En 1-2 minutos tu app va a estar en:
    `https://TU-USUARIO.github.io/mis-tarjetas/`

---

## Paso 2 — Configurar Google Cloud (para sincronización)

### 2a. Crear proyecto

1. Andá a **console.cloud.google.com**
2. Hacé click en el selector de proyectos → **New Project**
3. Nombre: `mis-tarjetas` → **Create**

### 2b. Habilitar Google Sheets API

1. En el menú izquierdo: **APIs & Services → Library**
2. Buscá "Google Sheets API" → hacé click → **Enable**

### 2c. Crear API Key

1. Andá a **APIs & Services → Credentials**
2. Hacé click en **+ Create Credentials → API Key**
3. Copiá la key (empieza con `AIzaSy...`)
4. Opcional: hacé click en la key → **Restrict key** → HTTP referrers → agregá `https://TU-USUARIO.github.io/*`

### 2d. Crear OAuth 2.0 Client ID

1. En **Credentials** → **+ Create Credentials → OAuth client ID**
2. Si te pide configurar "OAuth consent screen": seleccioná **External**, completá solo los campos obligatorios (nombre de la app, email), guardá
3. Application type: **Web application**
4. Name: `mis-tarjetas`
5. En **Authorized JavaScript origins** agregá:
   - `https://TU-USUARIO.github.io`
   - `http://localhost` (para pruebas locales)
6. Hacé click en **Create**
7. Copiá el **Client ID** (termina en `.apps.googleusercontent.com`)

---

## Paso 3 — Crear Google Spreadsheet

1. Andá a **sheets.google.com** → **+ Nueva hoja de cálculo**
2. Ponele un nombre: "Mis Tarjetas DB"
3. Copiá el **ID** de la URL:
   - URL ejemplo: `https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit`
   - El ID es la parte entre `/d/` y `/edit`: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms`

---

## Paso 4 — Conectar la app

1. Abrí tu URL de GitHub Pages: `https://TU-USUARIO.github.io/mis-tarjetas/`
2. En la pantalla de inicio, pegá:
   - **Client ID**: el que obtuviste en el paso 2d
   - **API Key**: el que obtuviste en el paso 2c
   - **Spreadsheet ID**: el que obtuviste en el paso 3
3. Hacé click en **Conectar y continuar**
4. Va a aparecer un popup de Google pidiendo permiso → Aceptá
5. ¡Listo! Los datos se sincronizan automáticamente

---

## Uso desde el celular

1. Abrí la URL en el navegador del celular
2. En iPhone: Safari → compartir → **Agregar a pantalla de inicio**
3. En Android: Chrome → menú (3 puntos) → **Agregar a pantalla de inicio**

Funciona como una app nativa, sin instalar nada.

---

## Cómo funciona la sincronización

- Cada vez que guardás algo, la app actualiza Google Sheets automáticamente
- Si entrás desde otro dispositivo, hace pull de Sheets al iniciar
- El botón **↻ Sync** fuerza una sincronización manual
- La Spreadsheet tiene una pestaña por tipo de dato: `cards`, `summaries`, `gastos`, `gastosTerceros`, `extHolders`, `categories`
- Podés ver y editar los datos directamente en la planilla si querés

---

## Sin Google Sheets (uso local)

Si no querés configurar Google, hacé click en **"Usar sin Google Sheets"** en la pantalla inicial. Los datos se guardan en el navegador del dispositivo. Podés exportar/importar JSON para hacer backup manualmente.

---

## Preguntas frecuentes

**¿Es gratis?**
Sí. GitHub Pages es gratis, Google Sheets API es gratis para uso personal.

**¿Mis datos son privados?**
Los datos quedan en tu propia Google Spreadsheet, en tu cuenta. Nadie más tiene acceso.

**¿Qué pasa si borro el caché del navegador?**
Si usás Google Sheets, los datos se recuperan automáticamente al reconectar. Si usás solo local, perdés los datos (por eso se recomienda el backup JSON periódico).

**¿Puedo usar la app sin internet?**
La app carga desde GitHub Pages (necesita internet). Una vez cargada, puede funcionar offline con los datos en localStorage, pero no sincroniza hasta que vuelva la conexión.
