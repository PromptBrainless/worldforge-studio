import { z } from "zod";

export const EntityTypeSchema = z.string().min(1).regex(/^[a-z][a-z0-9_.-]*$/);
export const CanonStateSchema = z.enum(["canon", "semi-canon", "alternate-canon", "deprecated", "unknown", "review-required"]);
export const SourceSchema = z.object({ kind:z.string().min(1), uri:z.string().optional(), label:z.string().optional(), importedAt:z.string().optional() });
export const EntityRevisionSchema = z.object({ revision:z.number().int().nonnegative(), changedAt:z.string(), snapshot:z.record(z.string(), z.unknown()) });
export const RelationStatusSchema = z.enum(["proposed", "confirmed", "disputed", "deprecated"]);
export const RelationTimeSchema = z.object({ from:z.string().optional(), to:z.string().optional() });
export const RelationSchema = z.object({ id:z.string(), workspaceId:z.string(), fromId:z.string(), toId:z.string(), kind:z.string().min(1), weight:z.number().nonnegative().default(1), confidence:z.number().min(0).max(1).default(1), status:RelationStatusSchema.default("confirmed"), sources:z.array(SourceSchema).default([]), time:RelationTimeSchema.default({}), data:z.record(z.string(), z.unknown()).default({}) });
export const EntitySchema = z.object({ id:z.string(), workspaceId:z.string(), type:EntityTypeSchema, schemaVersion:z.number().int().positive(), title:z.string().min(1), aliases:z.array(z.string()).default([]), canonState:CanonStateSchema.default("unknown"), sources:z.array(SourceSchema).default([]), history:z.array(EntityRevisionSchema).default([]), data:z.record(z.string(), z.unknown()), tags:z.array(z.string()).default([]), revision:z.number().int().nonnegative(), createdAt:z.string(), updatedAt:z.string() });
export const MergeConflictSchema = z.object({ kind:z.enum(["entity-id", "entity-name", "entity-content", "relation-id", "relation-duplicate", "relation-opposition", "relation-content", "relation-time", "sync-entity", "sync-relation"]), message:z.string(), sourceId:z.string().optional(), targetId:z.string().optional() });
export const MergeHistorySchema = z.object({ id:z.string(), sourceWorkspaceId:z.string(), sourceName:z.string(), importedAt:z.string(), entitiesAdded:z.number().int().nonnegative(), relationsAdded:z.number().int().nonnegative(), idMap:z.record(z.string(), z.string()), conflicts:z.array(MergeConflictSchema), reviewStatus:z.enum(["pending", "approved"]).optional() });
export const WorkspaceSchema = z.object({ id:z.string(), name:z.string().min(1), schemaVersion:z.number().int().positive(), createdAt:z.string(), updatedAt:z.string(), entities:z.array(EntitySchema), relations:z.array(RelationSchema), mergeHistory:z.array(MergeHistorySchema).default([]) });
export type Entity = z.infer<typeof EntitySchema>;
export type Relation = z.infer<typeof RelationSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type MergeConflict = z.infer<typeof MergeConflictSchema>;
export type MergeHistory = z.infer<typeof MergeHistorySchema>;
export type ValidationFinding = { severity:"error"|"warning"|"info"; message:string; entityId?:string };

export function newWorkspace(name = "Mein WorldForge-Projekt"): Workspace {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name, schemaVersion:1, createdAt:now, updatedAt:now, entities:[], relations:[], mergeHistory:[] };
}
export function newEntity(workspaceId:string, type:string, title:string, data:Record<string,unknown>={}): Entity {
  const now = new Date().toISOString();
  return { id:crypto.randomUUID(), workspaceId, type, schemaVersion:1, title, aliases:[], canonState:"unknown", sources:[], history:[], data, tags:[], revision:0, createdAt:now, updatedAt:now };
}
export function validateWorkspace(input: unknown): { workspace?:Workspace; findings:ValidationFinding[] } {
  const parsed = WorkspaceSchema.safeParse(input);
  if (!parsed.success) return { findings: parsed.error.issues.map(issue => ({severity:"error", message:issue.path.join(".")+": "+issue.message})) };
  const workspace = parsed.data; const ids = new Set(workspace.entities.map(entity => entity.id)); const findings:ValidationFinding[]=[];
  if (ids.size !== workspace.entities.length) findings.push({severity:"error",message:"Workspace enthaelt doppelte Entity-IDs"});
  if (new Set(workspace.relations.map(relation => relation.id)).size !== workspace.relations.length) findings.push({severity:"error",message:"Workspace enthaelt doppelte Relations-IDs"});
  for (const relation of workspace.relations) for (const id of [relation.fromId, relation.toId]) if (!ids.has(id)) findings.push({severity:"error",message:`Relation verweist auf unbekannte Entity ${id}`,entityId:relation.id});
  return { workspace, findings };
}
