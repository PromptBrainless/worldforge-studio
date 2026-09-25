import { newWorkspace, type Entity, type Workspace } from "../core/model.ts";
import { mergeWorkspaces } from "../core/merge.ts";
import type { WorkspaceStore } from "../core/store.ts";
import { archiveEntityCommand, createEntityCommand, createRelationCommand, updateEntityCommand } from "./commands.ts";
import { searchWorkspaceEntities, relationGraphQuery, type EntityQuery } from "./queries.ts";
import { renderWorkspacePreview } from "./preview.ts";
import { buildWorkspaceReports } from "../core/reports.ts";
import { importWorkspaceFile, serializeWorkspaceJSON, serializeWorkspaceMarkdown, serializeWorkspaceYAML, serializeWorkspaceZip } from "../core/serialization.ts";

export type WorkspaceExportFormat = "json" | "yaml" | "markdown" | "zip" | "sqlite" | "html";

export class HeadlessWorldForge {
  private readonly store: WorkspaceStore;

  constructor(store: WorkspaceStore) { this.store = store; }

  open(workspace?: Workspace): Workspace {
    const current = workspace ?? this.store.load() ?? newWorkspace();
    this.store.save(current);
    return current;
  }

  workspace(): Workspace {
    const workspace = this.store.load();
    if (!workspace) throw new Error("Kein Workspace geoeffnet.");
    return workspace;
  }

  createEntity(type: string, title: string, data?: Record<string, unknown>): Entity {
    const result = createEntityCommand(this.workspace(), type, title, data);
    this.store.save(result.workspace);
    return result.entity;
  }

  updateEntity(entityId: string, patch: Partial<Entity>): Workspace {
    const workspace = updateEntityCommand(this.workspace(), entityId, patch);
    this.store.save(workspace);
    return workspace;
  }

  archiveEntity(entityId: string): Workspace {
    const workspace = archiveEntityCommand(this.workspace(), entityId);
    this.store.save(workspace);
    return workspace;
  }

  createRelation(fromId: string, toId: string, kind: string) {
    const result = createRelationCommand(this.workspace(), fromId, toId, kind, { sources: [{ kind: "manual", label: "Headless API" }] });
    this.store.save(result.workspace);
    return result.relation;
  }

  merge(source: Workspace) {
    const result = mergeWorkspaces(this.workspace(), source);
    this.store.save(result.workspace);
    return result.report;
  }

  importFile(filename: string, bytes: Uint8Array) {
    return this.merge(importWorkspaceFile(filename, bytes));
  }

  search(query: EntityQuery = {}) { return searchWorkspaceEntities(this.workspace(), query); }
  graph() { return relationGraphQuery(this.workspace()); }
  reports() { return buildWorkspaceReports(this.workspace()); }
  preview() { return renderWorkspacePreview(this.workspace()); }

  export(format: WorkspaceExportFormat): string | Uint8Array {
    const workspace = this.workspace();
    if (format === "json") return serializeWorkspaceJSON(workspace);
    if (format === "yaml") return serializeWorkspaceYAML(workspace);
    if (format === "markdown") return serializeWorkspaceMarkdown(workspace);
    if (format === "zip") return serializeWorkspaceZip(workspace);
    if (format === "html") return this.preview();
    const database = this.store.exportDatabase?.();
    if (!database) throw new Error("Der aktuelle Store kann kein SQLite-Abbild exportieren.");
    return database;
  }
}