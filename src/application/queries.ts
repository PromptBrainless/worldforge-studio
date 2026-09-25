import type { Workspace } from "../core/model.ts";

export type EntityQuery = { text?: string; type?: string; tag?: string };

export function searchWorkspaceEntities(workspace: Workspace, query: EntityQuery = {}) {
  const text = query.text?.trim().toLowerCase() ?? "";
  const tag = query.tag?.trim().toLowerCase() ?? "";
  return workspace.entities.filter(entity =>
    (!query.type || query.type === "all" || entity.type === query.type) &&
    (!text || `${entity.title} ${entity.type} ${(entity.aliases ?? []).join(" ")}`.toLowerCase().includes(text)) &&
    (!tag || entity.tags.some(value => value.toLowerCase() === tag))
  );
}

export function listWorkspaceTags(workspace: Workspace) {
  return [...new Set(workspace.entities.flatMap(entity => entity.tags))].sort((left, right) => left.localeCompare(right));
}

export function relationGraphQuery(workspace: Workspace) {
  const titles = new Map(workspace.entities.map(entity => [entity.id, entity.title]));
  return {
    nodes: workspace.entities,
    edges: workspace.relations.map(relation => ({ ...relation, fromTitle: titles.get(relation.fromId) ?? null, toTitle: titles.get(relation.toId) ?? null })),
  };
}