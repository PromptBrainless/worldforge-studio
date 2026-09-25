# WorldForge Studio

Offline-first Studio für Welten, Kampagnen, Quests, Dialoge, Ereignisse, Wissen und Assets.

Dieses Repository ist der herausgelöste Werkzeugkern. Es enthält kein Lindendorf: kein Dorf, keine Figuren, keine Questtexte, keine Spielstände. Lindendorf bleibt das Spiel und kann später höchstens ein optionales Beispiel-Dataset werden, nicht der Kern.

Quelle: [PromptBrainless/lindendorf-rpg-alpha-V.1.3](https://github.com/PromptBrainless/lindendorf-rpg-alpha-V.1.3) @ `76e89b8` („Add isolated WorldForge Studio foundation“). Der Plan steht in [docs/WORLDFORGE-TRANSFORMATIONS-AUDIT.md](docs/WORLDFORGE-TRANSFORMATIONS-AUDIT.md).

## Architektur

Der Kern arbeitet mit versionierten Entities und Relations. Ein Workspace kann als JSON exportiert und wieder importiert werden. Die Oberfläche nutzt localStorage als Browseradapter; ein SQLite-Adapter kann denselben Store-Port später implementieren. Plugins registrieren neue Schemas und Validatoren über `src/core/plugins.ts`.

Kern-Typen: Welt, Region, Ort, Figur, Fraktion, Kampagne, Quest, Dialog, Ereignis, Wissen, Regelwerk, Asset.

SQLite, YAML, Markdown und ZIP sind im Audit als Ziele beschrieben, noch nicht im Code.

## Start

```bash
npm install
npm run dev
```

```bash
npm test
npm run typecheck
```
