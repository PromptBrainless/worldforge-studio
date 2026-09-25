import { z } from "zod";

export const EntityTypeSchema = z.string().min(1).regex(/^[a-z][a-z0-9_.-]*$/);
export const RelationSchema = z.object({ id:z.string(), workspaceId:z.string(), fromId:z.string(), toId:z.string(), kind:z.string().min(1), data:z.record(z.string(), z.unknown()).default({}) });
export const EntitySchema = z.object({ id:z.string(), workspaceId:z.string(), type:EntityTypeSchema, schemaVersion:z.number().int().positive(), title:z.string().min(1), data:z.record(z.string(), z.unknown()), tags:z.array(z.string()).default([]), revision:z.number().int().nonnegative(), createdAt:z.string(), updatedAt:z.string() });
export const WorkspaceSchema = z.object({ id:z.string(), name:z.string().min(1), schemaVersion:z.number().int().positive(), createdAt:z.string(), updatedAt:z.string(), entities:z.array(EntitySchema), relations:z.array(RelationSchema) });
export type Entity = z.infer<typeof EntitySchema>;
export type Relation = z.infer<typeof RelationSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type ValidationFinding = { severity:"error"|"warning"|"info"; message:string; entityId?:string };

export function newWorkspace(name = "Mein WorldForge-Projekt"): Workspace {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name, schemaVersion:1, createdAt:now, updatedAt:now, entities:[], relations:[] };
}
export function newEntity(workspaceId:string, type:string, title:string, data:Record<string,unknown>={}): Entity {
  const now = new Date().toISOString();
  return { id:crypto.randomUUID(), workspaceId, type, schemaVersion:1, title, data, tags:[], revision:0, createdAt:now, updatedAt:now };
}
export function validateWorkspace(input: unknown): { workspace?:Workspace; findings:ValidationFinding[] } {
  const parsed = WorkspaceSchema.safeParse(input);
  if (!parsed.success) return { findings: parsed.error.issues.map(issue => ({severity:"error", message:issue.path.join(".")+": "+issue.message})) };
  const workspace = parsed.data; const ids = new Set(workspace.entities.map(entity => entity.id)); const findings:ValidationFinding[]=[];
  for (const relation of workspace.relations) for (const id of [relation.fromId, relation.toId]) if (!ids.has(id)) findings.push({severity:"error",message:`Relation verweist auf unbekannte Entity ${id}`,entityId:relation.id});
  return { workspace, findings };
}
