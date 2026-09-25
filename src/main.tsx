import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  ArrowRight,
  Download,
  FilePlus2,
  Layers3,
  Link2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  EntitySchema,
  newEntity,
  newWorkspace,
  validateWorkspace,
  type Entity,
  type Workspace,
} from "./core/model";
import { mergeWorkspaces } from "./core/merge";
import {
  downloadWorkspace,
  LocalWorkspaceStore,
  type WorkspaceExportFormat,
  type WorkspaceStore,
} from "./core/store";
import { importWorkspaceFile } from "./core/serialization";
import { buildWorkspaceReports } from "./core/reports";
import { LocalStorageSyncCheckpointStore, HttpWorkspaceSyncAdapter, WorkspaceSyncService } from "./application/sync";
import {
  archiveEntityCommand,
  createEntityCommand,
  createRelationCommand,
  migrateEntityCommand,
  updateEntityCommand,
} from "./application/commands";
import {
  listWorkspaceTags,
  relationGraphQuery,
  searchWorkspaceEntities,
} from "./application/queries";
import { editorsFor, registeredSchemas, schemaFor } from "./core/plugins";
import "./plugins";
import "./styles.css";
import "./graph.css";
import "./validation.css";
import "./export.css";
import "./sync.css";

type AppProps = {
  store: WorkspaceStore;
  initialWorkspace: Workspace;
  initialNotice: string;
};
function App({ store, initialWorkspace, initialNotice }: AppProps) {
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const [selected, setSelected] = useState<string>("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [view, setView] = useState<"entities" | "graph" | "validation">("entities");
  const [tagFilter, setTagFilter] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [syncEndpoint, setSyncEndpoint] = useState(() => {
    try {
      return localStorage.getItem("worldforge.sync.endpoint") ?? "";
    } catch {
      return "";
    }
  });
  const [syncBusy, setSyncBusy] = useState(false);
  const [relationKind, setRelationKind] = useState("located_in");
  const [relationFrom, setRelationFrom] = useState("");
  const [relationTo, setRelationTo] = useState("");
  const [notice, setNotice] = useState(initialNotice);
  const selectedEntity =
    workspace.entities.find((entity) => entity.id === selected) ?? null;
  const editorFields = selectedEntity
    ? editorsFor(selectedEntity.type).flatMap((editor) => editor.fields)
    : [];
  const visible = searchWorkspaceEntities(workspace, {
    type,
    text: query,
    tag: tagFilter,
  });
  const tags = listWorkspaceTags(workspace);
  const graph = relationGraphQuery(workspace);
  const graphEdges = graph.edges.filter((edge) => {
    const from = workspace.entities.find((entity) => entity.id === edge.fromId);
    const to = workspace.entities.find((entity) => entity.id === edge.toId);
    const textMatch = `${edge.kind} ${edge.fromTitle ?? ""} ${edge.toTitle ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase());
    const tagMatch =
      !tagFilter ||
      from?.tags.includes(tagFilter) ||
      to?.tags.includes(tagFilter);
    return textMatch && tagMatch;
  });
  function update(next: Workspace) {
    const removed =
      workspace.id === next.id
        ? workspace.entities.filter(
            (entity) =>
              !next.entities.some((candidate) => candidate.id === entity.id),
          )
        : [];
    const archived = removed.reduce(
      (current, entity) => archiveEntityCommand(current, entity.id),
      workspace,
    );
    const retainedEntities = archived.entities.filter((entity) =>
      removed.some((candidate) => candidate.id === entity.id),
    );
    const retainedRelations =
      workspace.id === next.id
        ? workspace.relations.filter(
            (relation) =>
              !next.relations.some((candidate) => candidate.id === relation.id),
          )
        : [];
    const updated = {
      ...next,
      entities: [...next.entities, ...retainedEntities],
      relations: [...next.relations, ...retainedRelations],
      updatedAt: new Date().toISOString(),
    };
    setWorkspace(updated);
    store.save(updated);
    if (removed.length)
      setNotice("Entity archiviert; Daten und Beziehungen bleiben erhalten.");
  }
  function addEntity(entityType = registeredSchemas()[0]?.type ?? "world") {
    const schema = registeredSchemas().find((item) => item.type === entityType);
    const result = createEntityCommand(
      workspace,
      entityType,
      schema?.label ?? "Neue Entity",
    );
    update(result.workspace);
    setSelected(result.entity.id);
  }
  function editEntity(patch: Partial<Entity>) {
    if (!selectedEntity) return;
    update(updateEntityCommand(workspace, selected, patch));
  }
  function addRelation() {
    if (!relationFrom || !relationTo) {
      setNotice("Bitte Start- und Ziel-Entity auswaehlen.");
      return;
    }
    try {
      const result = createRelationCommand(
        workspace,
        relationFrom,
        relationTo,
        relationKind,
        { sources: [{ kind: "manual", label: "WorldForge Studio" }] },
      );
      update(result.workspace);
      setNotice(`Relation ${result.relation.kind} angelegt.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Relation ungueltig.");
    }
  }
  function importFile(file: File) {
    file
      .arrayBuffer()
      .then(async (buffer) => {
        const bytes = new Uint8Array(buffer);
        const source = /\.(sqlite|db)$/i.test(file.name)
          ? await import("./core/browser-sqlite").then(({ readWorkspaceFromSqliteFile }) => readWorkspaceFromSqliteFile(bytes))
          : importWorkspaceFile(file.name, bytes);
        if (!source) throw new Error("SQLite-Datei enthaelt keinen Workspace.");
        const merged = mergeWorkspaces(workspace, source);
        update(merged.workspace);
        setNotice(
          `${merged.report.entitiesAdded} Entities und ${merged.report.relationsAdded} Relationen uebernommen; ${merged.report.conflicts.length} Konflikte zur Pruefung.`,
        );
      })
      .catch((error) =>
        setNotice(error instanceof Error ? error.message : "Import fehlgeschlagen."),
      );
  }
  const validation = validateWorkspace(workspace);
  const reports = buildWorkspaceReports(workspace);
  const pendingSyncReview = workspace.mergeHistory.find(
    (entry) => entry.reviewStatus === "pending" && entry.conflicts.some((conflict) => conflict.kind.startsWith("sync-")),
  );
  function createSyncService() {
    if (!syncEndpoint.trim()) throw new Error("Bitte zuerst einen Sync-Endpoint eintragen.");
    return new WorkspaceSyncService(
      store,
      new HttpWorkspaceSyncAdapter(syncEndpoint.trim()),
      new LocalStorageSyncCheckpointStore(),
    );
  }
  async function synchronizeNow() {
    setSyncBusy(true);
    try {
      const result = await createSyncService().synchronizeFromCheckpoint();
      const current = store.load();
      if (current) setWorkspace(current);
      setNotice(result.status === "review-required" ? "Sync-Konflikt: beide Fassungen bleiben erhalten und muessen geprueft werden." : `Synchronisierung: ${result.status}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Synchronisierung fehlgeschlagen.");
    } finally {
      setSyncBusy(false);
    }
  }
  async function approveSyncReview() {
    if (!pendingSyncReview) return;
    setSyncBusy(true);
    try {
      const service = createSyncService();
      service.approveReview(pendingSyncReview.id);
      const snapshot = await service.publishReviewed();
      setWorkspace(snapshot.workspace);
      setNotice("Beide Fassungen wurden nach manueller Pruefung freigegeben und synchronisiert.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Review-Push fehlgeschlagen.");
      const current = store.load();
      if (current) setWorkspace(current);
    } finally {
      setSyncBusy(false);
    }
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Layers3 size={19} />
          </div>
          <div>
            <strong>WorldForge</strong>
            <span>Studio</span>
          </div>
        </div>
        <div className="workspace-name">
          <input
            value={workspace.name}
            onChange={(event) =>
              update({ ...workspace, name: event.target.value })
            }
            aria-label="Workspace-Name"
          />
          <small>OFFLINE WORKSPACE</small>
        </div>
        <div className="top-actions">
          <div className="export-control">
            <button
              className="icon-button"
              title="Exportformat waehlen"
              aria-expanded={exportOpen}
              onClick={() => setExportOpen(!exportOpen)}
            >
              <Download size={17} />
            </button>
            {exportOpen && (
              <div className="export-menu" role="menu" aria-label="Workspace exportieren">
                {([
                  ["json", "JSON"],
                  ["yaml", "YAML"],
                  ["markdown", "Markdown"],
                  ["zip", "ZIP-Projekt"],
                  ["html", "HTML-Vorschau"],
                  ["reports", "Analyseberichte"],
                  ...(store.exportDatabase ? [["sqlite", "SQLite"]] : []),
                ] as [WorkspaceExportFormat, string][]).map(([format, label]) => (
                  <button
                    key={format}
                    role="menuitem"
                    onClick={() => {
                      downloadWorkspace(workspace, format, store.exportDatabase?.());
                      setExportOpen(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="icon-button" title="Workspace importieren">
            <Upload size={17} />
            <input
              type="file"
              accept=".json,.yaml,.yml,.md,.markdown,.zip,.sqlite,.db,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importFile(file);
                event.target.value = "";
              }}
            />
          </label>
          <button className="primary" onClick={() => addEntity()}>
            <Plus size={17} /> Neu
          </button>
        </div>
      </header>
      <main className="layout">
        <aside className="sidebar">
          <div className="eyebrow">Workspace</div>
          <div className="side-title">Inhalte</div>
          <nav>
            {registeredSchemas().map((schema) => (
              <button
                className={
                  type === schema.type ? "nav-item active" : "nav-item"
                }
                key={schema.type}
                onClick={() =>
                  setType(type === schema.type ? "all" : schema.type)
                }
              >
                <span className="nav-dot" />
                {schema.label}
                <b>
                  {workspace.entities.filter(
                    (entity) => entity.type === schema.type,
                  ).length || ""}
                </b>
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className="eyebrow">System</div>
            <div className="status-row">
              <ShieldCheck size={15} />
              {validation.findings.length
                ? `${validation.findings.length} Befunde`
                : "Workspace valide"}
            </div>
            <div className="status-row muted">
              <Link2 size={15} />
              {workspace.relations.length} Beziehungen
            </div>
          </div>
        </aside>
        <section className="content">
          <div className="content-head">
            <div>
              <div className="eyebrow">Projektuebersicht</div>
              <h1>{workspace.name}</h1>
              <p>Baue Welten, die ihre Zusammenhaenge sichtbar machen.</p>
            </div>
            <button
              className="secondary"
              onClick={() => {
                update(newWorkspace());
                setSelected("");
                setNotice("Neuer leerer Workspace erstellt.");
              }}
            >
              <FilePlus2 size={16} /> Leeres Projekt
            </button>
          </div>
          <div className="metrics">
            <div>
              <span>Entities</span>
              <strong>{workspace.entities.length}</strong>
            </div>
            <div>
              <span>Relationen</span>
              <strong>{workspace.relations.length}</strong>
            </div>
            <div>
              <span>Schema-Typen</span>
              <strong>{registeredSchemas().length}</strong>
            </div>
            <div
              className={
                validation.findings.length ? "metric warning" : "metric"
              }
            >
              <span>Pruefung</span>
              <strong>
                {validation.findings.length ? validation.findings.length : "OK"}
              </strong>
            </div>
          </div>
          <div className="toolbar">
            <div className="search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Inhalte, Aliase oder Kanten suchen..."
                aria-label="Workspace durchsuchen"
              />
            </div>
            <label className="tag-filter">
              <span>Tag</span>
              <select
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
                aria-label="Nach Tag filtern"
              >
                <option value="">Alle</option>
                {tags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
            <div className="view-switch" aria-label="Ansicht">
              <button
                className={view === "entities" ? "active" : ""}
                onClick={() => setView("entities")}
                title="Entities"
              >
                Entities
              </button>
              <button
                className={view === "graph" ? "active" : ""}
                onClick={() => setView("graph")}
                title="Relationsgraph"
              >
                <Link2 size={14} /> Graph
              </button>
              <button
                className={view === "validation" ? "active" : ""}
                onClick={() => setView("validation")}
                title="Qualitaetspruefung"
              >
                <ShieldCheck size={14} /> Pruefung
              </button>
            </div>
            <button className="secondary" onClick={() => addEntity()}>
              <Plus size={15} /> Entity
            </button>
          </div>
          {view === "graph" ? (
            <section className="graph-view" aria-label="Gerichteter Relationsgraph">
              <div className="graph-heading">
                <div>
                  <div className="eyebrow">Wissensgraph</div>
                  <strong>{graph.nodes.length} Entities · {graphEdges.length} Relationen</strong>
                </div>
              </div>
              <form
                className="relation-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  addRelation();
                }}
              >
                <select
                  value={relationFrom}
                  onChange={(event) => setRelationFrom(event.target.value)}
                  aria-label="Relation von Entity"
                >
                  <option value="">Von Entity...</option>
                  {workspace.entities.map((entity) => (
                    <option key={entity.id} value={entity.id}>{entity.title}</option>
                  ))}
                </select>
                <input
                  value={relationKind}
                  onChange={(event) => setRelationKind(event.target.value)}
                  aria-label="Relationsart"
                  placeholder="Relationsart"
                  required
                />
                <select
                  value={relationTo}
                  onChange={(event) => setRelationTo(event.target.value)}
                  aria-label="Relation zu Entity"
                >
                  <option value="">Zu Entity...</option>
                  {workspace.entities.map((entity) => (
                    <option key={entity.id} value={entity.id}>{entity.title}</option>
                  ))}
                </select>
                <button className="secondary" type="submit"><Plus size={14} /> Relation</button>
              </form>
              <div className="graph-edges">
                {graphEdges.length ? graphEdges.map((edge) => (
                  <div className="graph-edge" key={edge.id}>
                    <button onClick={() => { setSelected(edge.fromId); setView("entities"); }}>
                      {edge.fromTitle ?? edge.fromId}
                    </button>
                    <div className="graph-link">
                      <span>{edge.kind}</span>
                      <ArrowRight size={17} aria-hidden="true" />
                    </div>
                    <button onClick={() => { setSelected(edge.toId); setView("entities"); }}>
                      {edge.toTitle ?? edge.toId}
                    </button>
                    <small>{edge.status} · Vertrauen {Math.round(edge.confidence * 100)}%</small>
                  </div>
                )) : (
                  <div className="empty graph-empty">
                    <Link2 size={25} />
                    <strong>Keine passenden Relationen</strong>
                    <span>Erstelle eine gerichtete Kante zwischen zwei Entities.</span>
                  </div>
                )}
              </div>
            </section>
          ) : view === "validation" ? (
            <section className="validation-view" aria-label="Datenqualitaet und Konflikte">
              <header className="validation-heading">
                <div>
                  <div className="eyebrow">Datenqualitaet</div>
                  <strong>{reports.dataQualityReport.valid ? "Keine strukturellen Fehler" : "Fehler erfordern Pruefung"}</strong>
                </div>
                <span>{reports.conflictReport.count} Konflikte · {reports.dataQualityReport.findings.length} Befunde</span>
              </header>
              <h2>Konflikte</h2>
              {reports.conflictReport.items.length ? (
                <div className="validation-list">
                  {reports.conflictReport.items.map((item, index) => (
                    <div className="validation-item conflict" key={`${item.kind}-${index}`}>
                      <strong>{item.kind}</strong>
                      <span>{item.message}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="validation-empty">Keine Konflikte erkannt.</p>}
              <h2>Befunde</h2>
              {reports.dataQualityReport.findings.length ? (
                <div className="validation-list">
                  {reports.dataQualityReport.findings.map((finding, index) => (
                    <button
                      className={`validation-item severity-${finding.severity}`}
                      key={`${finding.entityId ?? finding.relationId ?? "workspace"}-${index}`}
                      onClick={() => {
                        if (finding.entityId) { setSelected(finding.entityId); setView("entities"); }
                        else if (finding.relationId) setView("graph");
                      }}
                    >
                      <strong>{finding.severity}</strong>
                      <span>{finding.message}</span>
                    </button>
                  ))}
                </div>
              ) : <p className="validation-empty">Keine Befunde.</p>}
              <h2>Handlungsempfehlungen</h2>
              <ul className="recommendations">
                {reports.recommendations.length ? reports.recommendations.map((recommendation, index) => <li key={`${index}-${recommendation}`}>{recommendation}</li>) : <li>Keine Empfehlungen.</li>}
              </ul>
              <p className="review-note">Vorschlaege loesen keine Konflikte automatisch auf; Entscheidungen bleiben nachvollziehbar bei dir.</p>
              <section className="sync-panel" aria-label="Workspace synchronisieren">
                <h2>Synchronisierung</h2>
                <div className="sync-controls">
                  <label>
                    HTTP-Workspace-Endpoint
                    <input
                      type="url"
                      value={syncEndpoint}
                      onChange={(event) => {
                        setSyncEndpoint(event.target.value);
                        try {
                          localStorage.setItem("worldforge.sync.endpoint", event.target.value);
                        } catch {
                          setNotice("Sync-Endpoint konnte nicht lokal gespeichert werden.");
                        }
                      }}
                      placeholder="https://server.example/api"
                    />
                  </label>
                  <button className="secondary" disabled={syncBusy} onClick={() => void synchronizeNow()}>
                    <RefreshCw size={15} /> {syncBusy ? "Synchronisiere..." : "Jetzt synchronisieren"}
                  </button>
                </div>
                {pendingSyncReview && (
                  <div className="sync-review">
                    <span>{pendingSyncReview.conflicts.length} Konflikte offen. Beide Fassungen sind erhalten.</span>
                    <button className="primary" disabled={syncBusy} onClick={() => void approveSyncReview()}>
                      Beide Fassungen geprueft behalten und senden
                    </button>
                  </div>
                )}
                <p>Der Server muss JSON-Workspace-GET/PUT mit Revisionsantwort und Compare-and-Swap-Headern unterstuetzen. Zugangsdaten werden nicht lokal gespeichert.</p>
              </section>
            </section>
          ) : (
          <div className="work-area">
            <div className="entity-list">
              {visible.length === 0 ? (
                <div className="empty">
                  <Layers3 size={28} />
                  <strong>Noch keine Inhalte</strong>
                  <span>Erstelle deine erste Welt, Figur oder Quest.</span>
                  <button
                    className="primary"
                    onClick={() => addEntity("world")}
                  >
                    <Plus size={16} /> Welt anlegen
                  </button>
                </div>
              ) : (
                visible.map((entity) => (
                  <button
                    className={
                      selected === entity.id
                        ? "entity-row selected"
                        : "entity-row"
                    }
                    key={entity.id}
                    onClick={() => setSelected(entity.id)}
                  >
                    <span className={`entity-icon ${entity.type}`}>
                      {entity.type.slice(0, 1).toUpperCase()}
                    </span>
                    <span>
                      <strong>{entity.title}</strong>
                      <small>
                        {registeredSchemas().find(
                          (schema) => schema.type === entity.type,
                        )?.label ?? entity.type}{" "}
                        · Revision {entity.revision}
                      </small>
                    </span>
                    <span className="row-arrow">›</span>
                  </button>
                ))
              )}
            </div>
            <div className="inspector">
              {selectedEntity ? (
                <>
                  <div className="inspector-head">
                    <div>
                      <div className="eyebrow">Entity Inspector</div>
                      <h2>{selectedEntity.title}</h2>
                    </div>
                    <button
                      className="danger icon-button"
                      title="Entity archivieren"
                      onClick={() => {
                        update({
                          ...workspace,
                          entities: workspace.entities.filter(
                            (entity) => entity.id !== selected,
                          ),
                        });
                        setSelected("");
                      }}
                    >
                      <Archive size={16} />
                    </button>
                  </div>
                  <label>
                    Titel
                    <input
                      value={selectedEntity.title}
                      onChange={(event) =>
                        editEntity({ title: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Aliase
                    <input
                      value={selectedEntity.aliases.join(", ")}
                      onChange={(event) =>
                        editEntity({
                          aliases: event.target.value.split(",").map((alias) => alias.trim()).filter(Boolean),
                        })
                      }
                      placeholder="Alternative Namen, durch Komma getrennt"
                    />
                  </label>
                  <label>
                    Canon-Status
                    <select
                      value={selectedEntity.canonState}
                      onChange={(event) =>
                        editEntity({ canonState: event.target.value as Entity["canonState"] })
                      }
                    >
                      <option value="canon">Canon</option>
                      <option value="semi-canon">Semi Canon</option>
                      <option value="alternate-canon">Alternate Canon</option>
                      <option value="deprecated">Deprecated</option>
                      <option value="unknown">Unknown</option>
                      <option value="review-required">Pruefung erforderlich</option>
                    </select>
                  </label>
                  <label>
                    Tags
                    <input
                      value={selectedEntity.tags.join(", ")}
                      onChange={(event) =>
                        editEntity({
                          tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
                        })
                      }
                      placeholder="Tags, durch Komma getrennt"
                    />
                  </label>
                  <label>
                    Typ
                    <select
                      value={selectedEntity.type}
                      onChange={(event) =>
                        editEntity({ type: event.target.value })
                      }
                    >
                      {registeredSchemas().map((schema) => (
                        <option key={schema.type} value={schema.type}>
                          {schema.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Beschreibung
                    <textarea
                      value={String(
                        selectedEntity.data.description ??
                          selectedEntity.data.body ??
                          "",
                      )}
                      onChange={(event) =>
                        editEntity({
                          data: {
                            ...selectedEntity.data,
                            description: event.target.value,
                          },
                        })
                      }
                      placeholder="Was ist fuer diesen Inhalt wichtig?"
                    />
                  </label>
                  {editorFields.map((field) => (
                    <label key={`${selectedEntity.type}-${field.key}`}>
                      {field.label}
                      {field.control === "textarea" ? (
                        <textarea
                          value={String(selectedEntity.data[field.key] ?? "")}
                          onChange={(event) =>
                            editEntity({
                              data: { ...selectedEntity.data, [field.key]: event.target.value },
                            })
                          }
                        />
                      ) : (
                        <input
                          type={field.control}
                          value={String(selectedEntity.data[field.key] ?? "")}
                          onChange={(event) =>
                            editEntity({
                              data: { ...selectedEntity.data, [field.key]: event.target.value },
                            })
                          }
                        />
                      )}
                    </label>
                  ))}
                  {(schemaFor(selectedEntity.type)?.version ?? selectedEntity.schemaVersion) > selectedEntity.schemaVersion && (
                    <button
                      className="secondary"
                      onClick={() => update(migrateEntityCommand(workspace, selectedEntity.id))}
                    >
                      Schema auf v{schemaFor(selectedEntity.type)?.version} migrieren
                    </button>
                  )}
                  <div className="inspector-meta">
                    <span>ID</span>
                    <code>{selectedEntity.id.slice(0, 8)}...</code>
                    <span>Schema</span>
                    <code>v{selectedEntity.schemaVersion}</code>
                    <span>Aktualisiert</span>
                    <code>
                      {new Date(selectedEntity.updatedAt).toLocaleString(
                        "de-DE",
                      )}
                    </code>
                  </div>
                </>
              ) : (
                <div className="inspector-empty">
                  <Search size={25} />
                  <strong>Waehle einen Inhalt</strong>
                  <span>
                    Der Inspector zeigt Details und Bearbeitungsfelder.
                  </span>
                </div>
              )}
            </div>
          </div>
          )}
          {notice && <div className="notice">{notice}</div>}
        </section>
      </main>
    </div>
  );
}
function Bootstrap() {
  const [ready, setReady] = useState<{
    store: WorkspaceStore;
    workspace: Workspace;
    notice: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    let opened: { close: () => void } | null = null;
    const localStore = new LocalWorkspaceStore();
    let localWorkspace: Workspace;
    try {
      localWorkspace = localStore.load() ?? newWorkspace();
    } catch {
      localWorkspace = newWorkspace();
    }
    import("./core/browser-sqlite")
      .then(({ openBrowserSqliteStore }) => openBrowserSqliteStore())
      .then((sqliteStore) => {
        opened = sqliteStore;
        if (!active) {
          sqliteStore.close();
          return;
        }
        const stored = sqliteStore.load();
        const workspace = stored ?? localWorkspace;
        if (!stored) sqliteStore.save(workspace);
        setReady({ store: sqliteStore, workspace, notice: "" });
      })
      .catch(() => {
        if (active)
          setReady({
            store: localStore,
            workspace: localWorkspace,
            notice:
              "SQLite nicht verfuegbar; Workspace laeuft im localStorage-Fallback.",
          });
      });
    return () => {
      active = false;
      opened?.close();
    };
  }, []);
  return ready ? (
    <App
      store={ready.store}
      initialWorkspace={ready.workspace}
      initialNotice={ready.notice}
    />
  ) : (
    <div className="app-shell">
      <main className="content">
        <p>Lokalen Workspace wird geoeffnet...</p>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Bootstrap />
  </React.StrictMode>,
);
