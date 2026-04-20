# DAV Distro WebApp – Fortschritt

## Session 2026-04-15

### Bugfixes (Deployment)

**1. TypeScript-Buildfehler (Frontend)**
- `initiated_by` wurde zum `DeliveryRun`-Interface hinzugefügt, aber zwei manuell zusammengebaute Objekte in `Dashboard.tsx` wurden nicht aktualisiert
- Fix: `initiated_by: null` in beiden Stellen ergänzt
- Commit: `7a6b49b`

**2. Login funktionierte nicht (bcrypt-Inkompatibilität)**
- `passlib==1.7.4` ist inkompatibel mit neueren `bcrypt`-Versionen (>= 4.1.x)
- Führte zu extrem langsamem / fehlerhaftem Passwort-Check
- Fix: `bcrypt==4.0.1` in `requirements.txt` fest gepinnt
- Commit: `81d3bef`

---

### Neues Feature: Dateiverwaltung

**Ziel:** Sicherer Bereich auf dem Server für ZIPs, TOC-Dateien, PDFs und Cover-Bilder. Zugriff per Web-App und per SFTP (für Offline-Tool).

#### Ordnerstruktur auf dem Server
```
/opt/dav-storage/
  ├── zips/      ← Audiobook-Master-ZIPs
  ├── toc/       ← TOC-Excel-Dateien
  ├── pdf/       ← Booklets & Beilagen
  └── covers/    ← Cover-Bilder (Audible MoA)
```

#### Backend (`backend/app/routers/files.py`)
- Neuer Router `/api/files/{category}`
- Endpunkte: **LIST** `GET`, **UPLOAD** `POST`, **DOWNLOAD** `GET /{filename}/download`, **DELETE** `DELETE /{filename}`
- Alle Endpunkte hinter JWT-Auth
- Kategorien: `zips`, `toc`, `pdf`, `covers`

#### Frontend (`frontend/src/components/FileManager.tsx`)
- Neue Seite "Dateien" in der Navigation
- Tabs: ZIPs / TOC / PDFs / Cover
- Drag & Drop Upload (mehrere Dateien gleichzeitig)
- Dateiliste mit Name, Größe, Datum
- Download & Löschen (mit Bestätigungs-Dialog)

#### Infrastruktur
- `compose.yml`: `/opt/dav-storage` als `/storage` in den Backend-Container gemountet (via `STORAGE_DIR` Env-Var in Coolify)
- `setup_sftp_server.sh`: Script zum Einrichten eines dedizierten SFTP-Users `dav-upload` auf dem Server

---

### Offen / Nächste Schritte

- [ ] **SFTP-Setup auf dem Server ausführen** (`bash setup_sftp_server.sh` als root auf `94.130.65.4`)
- [ ] **`STORAGE_DIR=/opt/dav-storage`** als Env-Variable in Coolify eintragen
- [ ] **SSH-Key** für `dav-upload` User hinterlegen
- [ ] **Offline-Tool (DAV_Distro_App)** um SFTP-Upload-Funktion erweitern (paramiko bereits als Dependency vorhanden)
- [ ] **Audible MoA Modul** auf den Cover-Ordner (`/storage/covers`) verdrahten
