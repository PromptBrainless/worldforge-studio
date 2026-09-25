import { newEntity, RelationSchema, type Entity, type Relation, type Workspace } from "../core/model.ts";
import { migrateSchemaData, schemaFor } from "../core/plugins.ts";

function snapshot(entity: Entity) {
  return { title: entity.title, type: entity.type, aliases: entity.aliases, canonState: entity.canonState, sources: entity.sources, data: entity.data, tags: entity.tags };
}

export function createEntityCommand(workspace: Workspace, type: string, title: string, data: Record<string, unknown> = {}) {
  const entity = { ...newEntity(workspace.id, type, title, data), schemaVersion: schemaFor(type)?.version ?? 1 };
  return { workspace: { ...workspace, updatedAt: entity.createdAt, entities: [...workspace.entities, entity] }, entity };
}

export function updateEntityCommand(workspace: Workspace, entityId: string, patch: Partial<Entity>): Workspace {
  const current = workspace.entities.find(entity => entity.id === entityId);
  if (!current) return workspace;
  const changedAt = new Date().toISOString();
  const updated = { ...current, ...patch, history: [...current.history, { revision: current.revision, changedAt: current.updatedAt, snapshot: snapshot(current) }], revision: current.revision + 1, updatedAt: changedAt };
  return { ...workspace, updatedAt: changedAt, entities: workspace.entities.map(entity => entity.id === entityId ? updated : entity) };
}

export function archiveEntityCommand(workspace: Workspace, entityId: string): Workspace {
  const entity = workspace.entities.find(candidate => candidate.id === entityId);
  if (!entity || entity.canonState === "deprecated") return workspace;
  return updateEntityCommand(workspace, entityId, { canonState: "deprecated" });
}

export function migrateEntityCommand(workspace: Workspace, entityId: string): Workspace {
  const entity = workspace.entities.find(candidate => candidate.id === entityId);
  if (!entity) return workspace;
  const schema = schemaFor(entity.type);
  if (!schema || entity.schemaVersion >= schema.version) return workspace;
  const data = migrateSchemaData(entity.type, entity.data, entity.schemaVersion, schema.version);
  return updateEntityCommand(workspace, entityId, { schemaVersion: schema.version, data });
}

export function createRelationCommand(workspace: Workspace, fromId: string, toId: string, kind: string, fields: Partial<Relation> = {}) {
  const entityIds = new Set(workspace.entities.map(entity => entity.id));
  if (!entityIds.has(fromId) || !entityIds.has(toId)) throw new Error("Relation muss auf vorhandene Entities zeigen.");
  const relation = RelationSchema.parse({ id: crypto.randomUUID(), workspaceId: workspace.id, fromId, toId, kind, ...fields });
  const updatedAt = new Date().toISOString();
  return { workspace: { ...workspace, updatedAt, relations: [...workspace.relations, relation] }, relation };
}