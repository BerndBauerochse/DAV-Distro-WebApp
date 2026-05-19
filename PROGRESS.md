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

---

## Session 2026-04-23

### Sicherheits- und Dateihandling-Fixes

**1. Path-Traversal-Schutz für Dateiverwaltung und Run-Uploads**
- In `backend/app/routers/files.py` werden Dateinamen jetzt vor Upload, Thumbnail, Download und Delete validiert
- In `backend/app/routers/runs.py` werden hochgeladene Metadateien ebenfalls auf sichere Dateinamen begrenzt
- Ziel: Kein Ausbrechen aus den vorgesehenen Storage-/Upload-Verzeichnissen über manipulierte Dateinamen

**2. Metadaten-Download nach Run-Löschung abgesichert**
- Der Download-Endpunkt für Run-Metadateien prüft jetzt, ob der Run noch existiert
- In-Memory-Caches für Metadatei-Pfade werden beim Löschen eines Runs sowie bei nicht erfolgreich abgeschlossenen Runs bereinigt
- Dadurch bleiben keine verwaisten Download-Referenzen mehr aktiv

### Zebra-Bugfixes

**3. Statusfehler bei Zebra-Uploads korrigiert**
- Einzelne MP3-Dateien wurden im Protokoll teilweise als `übersprungen` angezeigt, obwohl sie auf dem Zielserver angekommen waren
- Ursache: Der `success`-Status wurde erst nach dem Schließen der SFTP-Verbindung gesetzt; Fehler beim Cleanup konnten dadurch einen erfolgreichen Upload nachträglich in den Fehlerpfad schieben
- Fix:
  - `success` wird jetzt direkt nach erfolgreichem `sftp_upload(...)` gesetzt
  - SFTP-Cleanup in `backend/app/modules/ftp_helper.py` ist jetzt robuster und loggt Close-Fehler nur noch als Warnung

**4. Retry für Zebra-Dateiuploads eingebaut**
- Zebra-Uploads versuchen fehlgeschlagene Dateiübertragungen jetzt mehrfach erneut
- Der Retry umfasst den kompletten Versuch inklusive SFTP-Verbindungsaufbau, nicht nur den eigentlichen Datei-Transfer
- Ziel: Temporäre Netzwerk-/Verbindungsprobleme sollen nicht mehr zu verlorenen Einzeldateien oder falschen Statuswerten führen

**5. `InfoMediaVariant` für Zebra korrekt ausgewertet**
- Beim Preview der Zebra-Metadaten wurde bisher häufig fälschlich `gekürzt` angezeigt
- Ursache: Die Prüfung auf `gekürzt` griff auch bei `ungekürzt`, weil der String enthalten ist
- Fix: Erst `ungekürzt`, dann `gekürzt` prüfen; zusätzlich englische Varianten `unabridged` / `abridged` berücksichtigen

### Verifikation

- Frontend-Produktionsbuild erfolgreich (`npm run build`)
- Syntax-Check für die geänderten Python-Dateien erfolgreich

### Git

- Commit: `2951905`
- Message: `Fix zebra upload status and file handling`
- Nach `origin/master` gepusht

---

## Session 2026-05-13

### Feature: Sortierung in allen Dateibereichen

**Ziel:** Die Sort-Controls (Neu / Alt / EAN ↑ / EAN ↓), die bisher nur im Cover-Bereich vorhanden waren, auf ZIPs, TOC, PDFs und Metadaten übertragen.

**Änderungen (`frontend/src/components/FileManager.tsx`)**
- `coverSort` → `sortOrder` — gilt jetzt für alle Kategorien
- `sortedFiles` sortiert immer (war vorher nur bei Covers aktiv)
- Sort-Controls als eigene `sortControls`-Variable extrahiert und im Header aller Listenbereiche eingebunden
- Commits: `5811436`

---

### Feature: Titelkatalog aus n8n-Webhook

**Ziel:** Einmal täglich EAN → Titel / Autor vom n8n-Webhook laden und in der App überall dort anzeigen, wo bisher nur die EAN sichtbar war (Dateiliste, Auslieferungshistorie).

**Webhook:** `https://n8n.der-audio-verlag.de/webhook/49dd3f5e-dc77-496e-a099-0115828c1161`  
Liefert JSON mit Feldern: `EAN_digital`, `Titel`, `Autor`, `Sprecher`, `Inhaltsbeschreibung`, `ET`, …

#### Backend

**Neue Tabelle `title_catalog`** (`backend/app/models.py`, `backend/app/database.py`)
```sql
CREATE TABLE title_catalog (
  ean       TEXT PRIMARY KEY,
  titel     TEXT NOT NULL,
  autor     TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
Migration läuft automatisch beim App-Start via `init_db()`.

**Neuer Router `backend/app/routers/catalog.py`**
- `GET /api/catalog` — gibt `{ "EAN": { "titel": "...", "autor": "..." } }` zurück (auth required)
- `POST /api/catalog/sync` — manueller Sync-Trigger (auth required)
- Fetch via `urllib.request` (keine externe Abhängigkeit nötig)
- Upsert per `ON CONFLICT (ean) DO UPDATE`

**Background-Task (`backend/app/main.py`)**
- Beim App-Start sofort ein Sync, danach alle 24 Stunden
- Task-Referenz wird in einem `set` gehalten um Garbage-Collection zu verhindern

#### Frontend

**`frontend/src/types/index.ts`**
- Neuer Typ `CatalogEntry { titel, autor }` und `CatalogMap`

**`frontend/src/api/client.ts`**
- `api.getCatalog()` → `GET /api/catalog`
- `api.syncCatalog()` → `POST /api/catalog/sync`

**`frontend/src/components/FileManager.tsx`**
- Katalog per `useQuery` geladen (staleTime 1h)
- In der Dateiliste: Titel (lila) + Autor als zweite Zeile unter dem Dateinamen, wenn EAN im Katalog gefunden

**`frontend/src/components/History.tsx`**
- Katalog per `useQuery` geladen
- EAN-Chips zeigen hinter der EAN den Titelnamen
- In der aufgeklappten Log-Tabelle: Titel als zweite Zeile unter der EAN

#### Bugfixes während Rollout

| Commit | Problem | Fix |
|--------|---------|-----|
| `79e998f` | `httpx` nicht in `requirements.txt` → Container-Crash | `httpx` durch `urllib.request` + `asyncio.to_thread` ersetzt |
| `b955049` | `asyncio.create_task()` ohne gespeicherte Referenz → GC verwarf den Task vor Ausführung | Referenz in `_background_tasks: set` gespeichert |
| `ad34485` | `Autor = null` im Webhook für manche Titel → `NOT NULL`-Constraint bricht Sync ab | `item.get("Autor") or ""` statt `item.get("Autor", "")` |

#### Commits
- `5811436` — feat: Titelkatalog aus n8n-Webhook
- `79e998f` — fix: httpx durch urllib stdlib ersetzen
- `b955049` — fix: Task-Referenz für asyncio.create_task halten (GC-Bug)
- `ad34485` — fix: Autor kann null sein
