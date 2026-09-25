import type { Database } from "sql.js";
import { EntitySchema, type Workspace } from "./model.ts";
import { importWorkspaceJSON, serializeWorkspaceJSON } from "./serialization.ts";
import type { WorkspaceStore } from "./store.ts";

export class SqliteWorkspaceStore implements WorkspaceStore {
  private readonly database: Database;
  private readonly persist?: (bytes: Uint8Array) => void;

  constructor(database: Database, persist?: (bytes: Uint8Array) => void) {
    this.database = database;
    this.persist = persist;
    database.run("PRAGMA foreign_keys = ON");
    database.run(`
      CREATE TABLE IF NOT EXISTS workspace (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        merge_history_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entity (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        canon_state TEXT NOT NULL,
        data_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE(workspace_id, id),
        FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS entity_title_idx ON entity(workspace_id, title);
      CREATE INDEX IF NOT EXISTS entity_type_idx ON entity(workspace_id, type);
      CREATE TABLE IF NOT EXISTS entity_tag (
        workspace_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY(entity_id, tag),
        FOREIGN KEY(workspace_id, entity_id) REFERENCES entity(workspace_id, id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS entity_tag_lookup_idx ON entity_tag(workspace_id, tag);
      CREATE TABLE IF NOT EXISTS relation (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        weight REAL NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        time_json TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
        FOREIGN KEY(workspace_id, from_id) REFERENCES entity(workspace_id, id),
        FOREIGN KEY(workspace_id, to_id) REFERENCES entity(workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS relation_from_idx ON relation(workspace_id, from_id);
      CREATE INDEX IF NOT EXISTS relation_to_idx ON relation(workspace_id, to_id);
    `);
  }

  load(): Workspace | null {
    const workspaceRows = this.database.exec(`SELECT id, name, schema_version, created_at, updated_at, merge_history_json FROM workspace ORDER BY updated_at DESC LIMIT 1`)[0]?.values;
    if (!workspaceRows?.length) return null;
    const [id, name, schemaVersion, createdAt, updatedAt, mergeHistoryJson] = workspaceRows[0];
    const workspaceId = String(id);
    const entities = this.readJsonRows("SELECT record_json FROM entity WHERE workspace_id = ? ORDER BY rowid", [workspaceId]);
    const relations = this.readJsonRows("SELECT record_json FROM relation WHERE workspace_id = ? ORDER BY rowid", [workspaceId]);
    return importWorkspaceJSON(JSON.stringify({ id, name, schemaVersion, createdAt, updatedAt, mergeHistory: JSON.parse(String(mergeHistoryJson)), entities, relations }));
  }

  save(input: Workspace): void {
    const workspace = importWorkspaceJSON(serializeWorkspaceJSON(input));
    this.database.run("BEGIN IMMEDIATE");
    try {
      this.database.run("INSERT INTO workspace (id, name, schema_version, created_at, updated_at, merge_history_json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, schema_version=excluded.schema_version, created_at=excluded.created_at, updated_at=excluded.updated_at, merge_history_json=excluded.merge_history_json", [workspace.id, workspace.name, workspace.schemaVersion, workspace.createdAt, workspace.updatedAt, JSON.stringify(workspace.mergeHistory)]);
      this.database.run("DELETE FROM relation WHERE workspace_id = ?", [workspace.id]);
      this.database.run("DELETE FROM entity WHERE workspace_id = ?", [workspace.id]);
      for (const entity of workspace.entities) {
        this.database.run("INSERT INTO entity (id, workspace_id, type, title, canon_state, data_json, tags_json, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [entity.id, workspace.id, entity.type, entity.title, entity.canonState, JSON.stringify(entity.data), JSON.stringify(entity.tags), JSON.stringify(entity)]);
        for (const tag of entity.tags) this.database.run("INSERT INTO entity_tag (workspace_id, entity_id, tag) VALUES (?, ?, ?)", [workspace.id, entity.id, tag]);
      }
      for (const relation of workspace.relations) {
        this.database.run("INSERT INTO relation (id, workspace_id, from_id, to_id, kind, weight, confidence, status, time_json, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [relation.id, workspace.id, relation.fromId, relation.toId, relation.kind, relation.weight, relation.confidence, relation.status, JSON.stringify(relation.time), JSON.stringify(relation)]);
      }
      this.database.run("COMMIT");
      this.persist?.(this.database.export());
    } catch (error) {
      this.database.run("ROLLBACK");
      throw error;
    }
  }

  searchEntities(query = "", tag?: string) {
    const needle = query.trim();
    const selectedTag = tag ?? "";
    const rows = this.readJsonRows(`
      SELECT entity.record_json
      FROM entity
      WHERE entity.workspace_id = (SELECT id FROM workspace ORDER BY updated_at DESC LIMIT 1)
        AND (? = '' OR instr(lower(entity.title), lower(?)) > 0 OR instr(lower(entity.type), lower(?)) > 0)
        AND (? = '' OR EXISTS (SELECT 1 FROM entity_tag WHERE entity_tag.workspace_id = entity.workspace_id AND entity_tag.entity_id = entity.id AND entity_tag.tag = ?))
      ORDER BY entity.title COLLATE NOCASE, entity.id
    `, [needle, needle, needle, selectedTag, selectedTag]);
    return rows.map(row => EntitySchema.parse(row));
  }

  clear(): void {
    this.database.run("BEGIN IMMEDIATE");
    try {
      this.database.run("DELETE FROM workspace");
      this.database.run("COMMIT");
      this.persist?.(this.database.export());
    } catch (error) {
      this.database.run("ROLLBACK");
      throw error;
    }
  }

  exportDatabase(): Uint8Array { return this.database.export(); }
  close(): void { this.database.close(); }

  private readJsonRows(sql: string, params: (string | number)[] = []): unknown[] {
    const statement = this.database.prepare(sql, params);
    const rows: unknown[] = [];
    try {
      while (statement.step()) rows.push(JSON.parse(String(statement.get()[0])));
    } finally {
      statement.free();
    }
    return rows;
  }
}