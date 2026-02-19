const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

let win = null;
let tray = null;

const ICON_PATH = path.join(__dirname, "assets", "icon.ico");

// Datei-Speicher (für Benachrichtigungen / Persistenz)
const DB_PATH = path.join(app.getPath("userData"), "bundk_rows.json");
const NOTIFY_STATE_PATH = path.join(app.getPath("userData"), "notify_state.json");

// STEP Index
const STEP_INDEX_PATH = path.join(app.getPath("userData"), "step_index.json");
const STEP_EXTS = new Set([".step", ".stp"]);

// =======================
// WINDOW + TRAY
// =======================
function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0b0f19",
    icon: ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "index.html"));

  // X -> Tray weiterlaufen
  win.on("close", (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  const img = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(img);
  tray.setToolTip("Lieferplaner BUNDK");

  const menu = Menu.buildFromTemplate([
    { label: "Öffnen", click: () => win && win.show() },
    { label: "STEP-Index neu erstellen", click: () => rebuildStepIndex(true) },
    { label: "Jetzt prüfen (Benachr.)", click: () => checkAndNotify() },
    { type: "separator" },
    { label: "Beenden", click: () => { app.isQuiting = true; app.quit(); } },
  ]);

  tray.setContextMenu(menu);
  tray.on("double-click", () => win && win.show());
}

// =======================
// FILE DB (Rows)
// =======================
function loadRows() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveRows(rows) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(rows, null, 2), "utf8");
  } catch {}
}

ipcMain.handle("save-rows", async (_e, rows) => {
  if (Array.isArray(rows)) saveRows(rows);
  return true;
});
ipcMain.handle("load-rows", async () => loadRows());

// =======================
// BENACHRICHTIGUNGEN
// =======================
function isRelevantOffene(offene) {
  if (!offene) return false;
  const nums = String(offene).split("/").map(x => parseInt(x, 10)).filter(n => Number.isFinite(n));
  return nums.some(n => n >= 600 && n <= 699 && n !== 640);
}
function toDateMaybe(s) {
  if (!s) return null;
  // dd.mm.yy oder dd.mm.yyyy
  let m = String(s).match(/(\d{2})\.(\d{2})\.(\d{2})$/);
  if (m) {
    const [_, d, mo, y2] = m;
    return new Date(+y2 + 2000, +mo - 1, +d);
  }
  m = String(s).match(/(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) {
    const [_, d, mo, y4] = m;
    return new Date(+y4, +mo - 1, +d);
  }
  return null;
}
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function daysUntil(date) {
  const t = startOfDay(new Date());
  const d = startOfDay(date);
  return Math.round((d - t) / 864e5);
}
function uidOf(r) {
  const posKey = (r.Position || "").slice(0, 120).replace(/\s+/g, " ");
  return `${r.Beleg || ""}::${r.BA || ""}::${r.Artikel || ""}::${posKey}`;
}
function loadNotifyState() {
  try { return JSON.parse(fs.readFileSync(NOTIFY_STATE_PATH, "utf8")) || {}; }
  catch { return {}; }
}
function saveNotifyState(s) {
  try { fs.writeFileSync(NOTIFY_STATE_PATH, JSON.stringify(s, null, 2), "utf8"); } catch {}
}
function sendNotification(title, body) {
  try { new Notification({ title, body }).show(); } catch {}
}

function checkAndNotify() {
  const rows = loadRows();
  const state = loadNotifyState();
  const today = new Date().toISOString().slice(0, 10);

  const overdue = [];
  const dueSoon = [];

  for (const r of rows) {
    if (r.Done === true) continue;
    if (!isRelevantOffene(r.Offene)) continue;
    if (r.Arrived === true) continue;

    const dt = toDateMaybe(r.Liefertermin);
    if (!dt) continue;

    const du = daysUntil(dt);
    const id = uidOf(r);

    if (du < 0) {
      const key = `${id}::overdue`;
      if (state[key] !== today) { overdue.push(r); state[key] = today; }
    } else if (du <= 7) {
      const key = `${id}::dueSoon`;
      if (state[key] !== today) { dueSoon.push(r); state[key] = today; }
    }
  }

  if (overdue.length) {
    const top = overdue.slice(0, 4).map(r => `${r.BA || "-"} • ${r.Liefertermin || ""}`).join("\n");
    sendNotification("Lieferplaner BUNDK – ÜBERFÄLLIG",
      `🚨 ${overdue.length} relevante offene Arbeit(en) überfällig\n${top}${overdue.length > 4 ? "\n…" : ""}`);
  }
  if (dueSoon.length) {
    const top = dueSoon.slice(0, 4).map(r => `${r.BA || "-"} • ${r.Liefertermin || ""}`).join("\n");
    sendNotification("Lieferplaner BUNDK – fällig in ≤ 7 Tagen",
      `⚠️ ${dueSoon.length} relevante offene Arbeit(en) ≤ 7 Tage\n${top}${dueSoon.length > 4 ? "\n…" : ""}`);
  }

  saveNotifyState(state);
}

// =======================
// NETZLAUFWERK: Root finden
// =======================
function getZeichnungenRoot() {
  // bevorzugt Z:\Zeichnungen, fallback UNC
  const candidates = [
    "Z:\\Zeichnungen",
    "\\\\BUKSRV1\\Zeichnungen",
  ];
  for (const c of candidates) {
    try {
      fs.accessSync(c);
      return c;
    } catch {}
  }
  return null;
}

// =======================
// STEP: Index + schnelle Suche
// =======================
function normalizeAlphaNum(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function extractSearchKey(positionText) {
  const txt = String(positionText || "").trim();

  // TM000195055
  const mTM = txt.match(/\bTM\d{5,}\b/i);
  if (mTM) return mTM[0].toUpperCase();

  // lange Zahl
  const mNum = txt.match(/\b\d{7,}\b/);
  if (mNum) return mNum[0];

  // fallback: erster Block ohne Sonderzeichen
  const words = txt.split(/\s+/).filter(Boolean);
  return words.length ? words[0] : "";
}

function loadStepIndex() {
  try {
    const raw = fs.readFileSync(STEP_INDEX_PATH, "utf8");
    const idx = JSON.parse(raw);
    if (!idx || !Array.isArray(idx.files)) return null;
    return idx;
  } catch {
    return null;
  }
}

function saveStepIndex(idx) {
  try { fs.writeFileSync(STEP_INDEX_PATH, JSON.stringify(idx, null, 2), "utf8"); } catch {}
}

function buildStepIndex(rootDir) {
  // iterativ (nicht rekursiv) -> stabil
  const files = [];
  const stack = [rootDir];

  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (STEP_EXTS.has(ext)) {
          const nameLower = e.name.toLowerCase();
          files.push({
            name: e.name,
            path: full,
            nameLower,
            alpha: normalizeAlphaNum(e.name),
            pathLower: full.toLowerCase(),
          });
        }
      }
    }
  }

  return { root: rootDir, createdAt: new Date().toISOString(), files };
}

function rebuildStepIndex(force = false) {
  const root = getZeichnungenRoot();
  if (!root) {
    dialog.showMessageBoxSync({
      type: "warning",
      title: "Z-Laufwerk nicht verfügbar",
      message: "Ich kann Z:\\Zeichnungen nicht lesen.\nBitte Netzlaufwerk verbinden (Z:).",
    });
    return false;
  }

  if (force) {
    try { fs.unlinkSync(STEP_INDEX_PATH); } catch {}
  }

  // bauen
  sendNotification("Lieferplaner BUNDK", "⏳ STEP-Index wird erstellt (kann dauern) …");
  const idx = buildStepIndex(root);
  saveStepIndex(idx);
  sendNotification("Lieferplaner BUNDK", `✅ STEP-Index fertig: ${idx.files.length} Dateien`);
  return true;
}

function findStepPath(positionText) {
  const key = extractSearchKey(positionText);
  if (!key) return null;

  const root = getZeichnungenRoot();
  if (!root) return null;

  let idx = loadStepIndex();
  // wenn kein Index oder Root geändert: neu bauen
  if (!idx || !idx.root || idx.root.toLowerCase() !== root.toLowerCase()) {
    idx = buildStepIndex(root);
    saveStepIndex(idx);
  }

  const q = key.toLowerCase();
  const qa = normalizeAlphaNum(key);

  // 1) Treffer im Dateinamen (normal)
  let hit = idx.files.find(f => f.nameLower.includes(q));
  if (hit) return hit.path;

  // 2) Treffer im Pfad (Ordnername enthält TM…)
  hit = idx.files.find(f => f.pathLower.includes(q) && (f.nameLower.endsWith(".stp") || f.nameLower.endsWith(".step")));
  if (hit) return hit.path;

  // 3) alphanumerisch (sehr tolerant)
  if (qa) {
    hit = idx.files.find(f => f.alpha.includes(qa));
    if (hit) return hit.path;
    hit = idx.files.find(f => normalizeAlphaNum(f.pathLower).includes(qa));
    if (hit) return hit.path;
  }

  return null;
}

ipcMain.handle("step-find", async (_e, positionText) => {
  const root = getZeichnungenRoot();
  if (!root) {
    return { ok: false, reason: "Z_NOT_READY" };
  }
  const p = findStepPath(positionText);
  if (!p) return { ok: false, reason: "NOT_FOUND" };
  return { ok: true, path: p };
});

ipcMain.handle("step-open", async (_e, filePath) => {
  try {
    if (!filePath) return false;
    await shell.openPath(filePath);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("step-reindex", async () => {
  return rebuildStepIndex(true);
});

// =======================
// APP LIFECYCLE
// =======================
app.whenReady().then(() => {
  createWindow();
  createTray();

  // Autostart im Tray
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });

  // Benachrichtigungen
  checkAndNotify();
  setInterval(checkAndNotify, 15 * 60 * 1000);
});

app.on("window-all-closed", () => {
  // Tray App -> nicht beenden
});