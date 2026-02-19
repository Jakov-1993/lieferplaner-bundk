const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bundkStore", {
  saveRows: (rows) => ipcRenderer.invoke("save-rows", rows),
  loadRows: () => ipcRenderer.invoke("load-rows"),
});

contextBridge.exposeInMainWorld("bundkStep", {
  // Findet und öffnet direkt
  openStepFor: async (positionText) => {
    const res = await ipcRenderer.invoke("step-find", positionText);

    if (!res || res.ok !== true) {
      if (res && res.reason === "Z_NOT_READY") {
        alert("Z:\\Zeichnungen ist nicht erreichbar.\nBitte Netzlaufwerk verbinden.");
        return false;
      }
      alert(
        "Keine STEP-Datei gefunden für:\n\n" +
        positionText +
        "\n\nTipp: Datei muss .stp oder .step heißen und in Z:\\Zeichnungen liegen."
      );
      return false;
    }

    const ok = await ipcRenderer.invoke("step-open", res.path);
    if (!ok) alert("Konnte Datei nicht öffnen:\n" + res.path);
    return ok;
  },

  // Optional: Index neu bauen (falls gewünscht)
  reindex: () => ipcRenderer.invoke("step-reindex"),
});