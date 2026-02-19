Lieferplaner Fix-Paket

Enthält:
- index.html (PDF-Import + Anzeige gefixt, UI wie früher mit Scrollboxen)
- main.js / preload.js (unverändert von deinem Upload)
- assets (logo-32.png + icon.ico)
- samples (Beispiel-PDFs)

So verwendest du es:
1) In deinem Projektordner (z.B. C:\Users\Avor\Desktop\lieferplaner-exe) diese Dateien ersetzen:
   - index.html
   - main.js
   - preload.js
   - assets\logo-32.png (falls du dein eigenes Logo hast: einfach überschreiben)
2) Wichtig: der Ordner lib\ muss weiterhin vorhanden sein und pdf.js + pdf.worker.js enthalten.
   (Wenn du ihn schon hast, nichts ändern.)
3) App starten:
   - Entwicklung: npm run start
   - Setup bauen: npm run dist

Hinweis:
- PDF.js Worker ist absichtlich deaktiviert (stabil in Electron/asar). PDF Import kann dadurch etwas langsamer sein.
