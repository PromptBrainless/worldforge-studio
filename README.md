![WorldForge Studio](docs/REPOSITORY-COVER.svg)

# WorldForge Studio

Offline-first Studio für Welten, Kampagnen, Quests, Dialoge, Ereignisse, Wissen und Assets.

Dieses Repository ist der herausgelöste Werkzeugkern. Es enthält kein Lindendorf: kein Dorf, keine Figuren, keine Questtexte, keine Spielstände. Lindendorf bleibt das Spiel und kann später höchstens ein optionales Beispiel-Dataset werden, nicht der Kern.

Quelle: [PromptBrainless/lindendorf-rpg-alpha-V.1.3](https://github.com/PromptBrainless/lindendorf-rpg-alpha-V.1.3) @ `76e89b8` („Add isolated WorldForge Studio foundation“). Der Plan steht in [docs/WORLDFORGE-TRANSFORMATIONS-AUDIT.md](docs/WORLDFORGE-TRANSFORMATIONS-AUDIT.md).

## Architektur

Der Kern arbeitet mit versionierten Entities und Relations. Die Browseroberflaeche nutzt SQLite-WASM als Primaerspeicher und migriert vorhandene localStorage-Workspaces beim ersten Start. Pluginregistrierungen stellen Schemas, Validatoren, Editorfelder, Exporter und explizite Migrationen bereit.

Kern-Typen: Welt, Region, Ort, Figur, Fraktion, Kampagne, Quest, Dialog, Ereignis, Wissen, Regelwerk, Asset.

JSON, YAML, Markdown-Frontmatter, ZIP-Projekte und SQLite-Dateien koennen validiert importiert und einzeln exportiert werden. HTML-Vorschau und Analyseberichte sind ebenfalls exportierbar. Die lokale SQLite-Datei wird offline im Browser gespeichert.

Importe fuehren Entities und gerichtete Relationen nicht-destruktiv zusammen. ID-Kollisionen werden umgeschrieben und gemappt; Quellen, Canon-Status, Aliasnamen und Entity-Aenderungssnapshots werden mitgefuehrt. Namens-, Inhalts-, Relations-, Zeit- und Assetkonflikte werden nicht automatisch entschieden. Der Sync-Client nutzt einen HTTP-Compare-and-Swap-Vertrag und blockiert konkurrierende Aenderungen bis zur expliziten Reviewfreigabe. Er enthaelt keinen konkreten Authentifizierungsanbieter. Adapter fuer World Anvil, VTTs, weitere Dokument-/Repositoryquellen und externe APIs sowie KI-Extraktion und Karten-/Assetdateiverwaltung sind noch nicht implementiert.

## Start

```bash
npm install
npm run dev
```

```bash
npm test
npm run typecheck
```

## Android-APK

Voraussetzungen: JDK 21 und Android SDK mit API 36. Android-Projekt synchronisieren und die installierbare Debug-APK bauen:

```bash
npm run android:apk
```

Die APK liegt danach unter `artifacts/WorldForge-Studio-debug.apk`. Zum Installieren auf einem verbundenen Android-Geraet:

```bash
adb install -r artifacts/WorldForge-Studio-debug.apk
```

Die Debug-APK ist fuer lokale Tests signiert; fuer eine Play-Store-Verteilung ist ein eigener Release-Schluessel erforderlich.


---

## Repository identity

This repository uses a versioned visual cover in `docs/REPOSITORY-COVER.svg` to make its scope visible at a glance.
