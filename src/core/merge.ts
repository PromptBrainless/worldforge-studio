import type { MergeConflict, MergeHistory, Workspace } from "./model";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function mergeWorkspaces(target: Workspace, source: Workspace): { workspace: Workspace; report: MergeHistory } {
  const conflicts: MergeConflict[] = [];
  const idMap: Record<string, string> = {};
  const targetEntityIds = new Set(target.entities.map(entity => entity.id));
  const entityNames = new Map<string, string[]>();
  const indexEntityNames = (entity: Workspace["entities"][number], id: string) => {
    for (const name of [entity.title, ...(entity.aliases ?? [])]) {
      const key = `${entity.type}:${name.trim().toLowerCase()}`;
      entityNames.set(key, [...(entityNames.get(key) ?? []), id]);
    }
  };
  target.entities.forEach(entity => indexEntityNames(entity, entity.id));

  const importedEntities: Workspace["entities"] = [];
  for (const entity of source.entities) {
    const id = targetEntityIds.has(entity.id) ? crypto.randomUUID() : entity.id;
    idMap[entity.id] = id;
    if (id !== entity.id) conflicts.push({ kind: "entity-id", message: `Entity-ID ${entity.id} existiert bereits; der importierte Datensatz wurde auf ${id} umgeschrieben.`, sourceId: entity.id, targetId: id });
    const matchingIds = new Set([entity.title, ...(entity.aliases ?? [])].flatMap(name => entityNames.get(`${entity.type}:${name.trim().toLowerCase()}`) ?? []));
    for (const matchingId of matchingIds) {
      conflicts.push({ kind: "entity-name", message: `Titel oder Alias „${entity.title}“ passt zu einer vorhandenen Entity. Beide Datensaetze bleiben erhalten.`, sourceId: entity.id, targetId: matchingId });
      const existing = target.entities.find(candidate => candidate.id === matchingId) ?? importedEntities.find(candidate => candidate.id === matchingId);
      if (existing && stableStringify({ type: existing.type, title: existing.title, aliases: existing.aliases ?? [], canonState: existing.canonState ?? "unknown", data: existing.data, tags: existing.tags }) !== stableStringify({ type: entity.type, title: entity.title, aliases: entity.aliases ?? [], canonState: entity.canonState ?? "unknown", data: entity.data, tags: entity.tags })) conflicts.push({ kind: "entity-content", message: `Abweichende Inhalte oder Canon-Angaben fuer „${entity.title}“; eine manuelle Pruefung ist erforderlich.`, sourceId: entity.id, targetId: matchingId });
    }
    const importedAt = new Date().toISOString();
    const imported = { ...entity, id, workspaceId: target.id, sources: [...(entity.sources ?? []), { kind: "worldforge-json", uri: `workspace:${source.id}#entity:${entity.id}`, label: source.name, importedAt }] };
    indexEntityNames(imported, id);
    importedEntities.push(imported);
  }

  const relationIds = new Set(target.relations.map(relation => relation.id));
  const relationKeys = new Set(target.relations.map(relation => `${relation.fromId}:${relation.kind}:${relation.toId}`));
  const relationsByKey = new Map(target.relations.map(relation => [`${relation.fromId}:${relation.kind}:${relation.toId}`, [relation]]));
  const opposingKinds: Record<string, string> = { allied_with:"enemy_of", enemy_of:"allied_with", owns:"owned_by", owned_by:"owns", controls:"controlled_by", controlled_by:"controls" };
  const importedRelations = source.relations.map(relation => {
    const fromId = idMap[relation.fromId] ?? relation.fromId;
    const toId = idMap[relation.toId] ?? relation.toId;
    const id = relationIds.has(relation.id) ? crypto.randomUUID() : relation.id;
    if (id !== relation.id) conflicts.push({ kind: "relation-id", message: `Relations-ID ${relation.id} existiert bereits; die importierte Relation wurde auf ${id} umgeschrieben.`, sourceId: relation.id, targetId: id });
    const relationKey = `${fromId}:${relation.kind}:${toId}`;
    if (relationKeys.has(relationKey)) conflicts.push({ kind: "relation-duplicate", message: `Doppelte Relation ${relation.kind} zwischen ${fromId} und ${toId}; beide Einträge bleiben erhalten.`, sourceId: relation.id });
    const matchingRelations = relationsByKey.get(relationKey) ?? [];
    const matchingRelation = matchingRelations[0];
    if (matchingRelation && stableStringify({ weight: matchingRelation.weight ?? 1, confidence: matchingRelation.confidence ?? 1, status: matchingRelation.status ?? "confirmed", data: matchingRelation.data }) !== stableStringify({ weight: relation.weight ?? 1, confidence: relation.confidence ?? 1, status: relation.status ?? "confirmed", data: relation.data })) conflicts.push({ kind: "relation-content", message: `Abweichende Metadaten fuer ${relation.kind} zwischen ${fromId} und ${toId}.`, sourceId: relation.id, targetId: matchingRelation.id });
    if (matchingRelation && stableStringify(matchingRelation.time ?? {}) !== stableStringify(relation.time ?? {})) conflicts.push({ kind: "relation-time", message: `Widerspruechlicher Zeitbezug fuer ${relation.kind} zwischen ${fromId} und ${toId}.`, sourceId: relation.id, targetId: matchingRelation.id });
    relationKeys.add(relationKey);
    const opposingKey = `${fromId}:${opposingKinds[relation.kind]}:${toId}`;
    if (opposingKinds[relation.kind] && relationKeys.has(opposingKey)) conflicts.push({ kind: "relation-opposition", message: `Widerspruechliche Relationsarten ${relation.kind} und ${opposingKinds[relation.kind]} zwischen ${fromId} und ${toId}.`, sourceId: relation.id });
    const imported = { ...relation, id, workspaceId: target.id, fromId, toId, sources: [...(relation.sources ?? []), { kind: "worldforge-json", uri: `workspace:${source.id}#relation:${relation.id}`, label: source.name, importedAt: new Date().toISOString() }] };
    relationsByKey.set(relationKey, [...matchingRelations, imported]);
    return imported;
  });

  const report: MergeHistory = {
    id: crypto.randomUUID(),
    sourceWorkspaceId: source.id,
    sourceName: source.name,
    importedAt: new Date().toISOString(),
    entitiesAdded: importedEntities.length,
    relationsAdded: importedRelations.length,
    idMap,
    conflicts,
    reviewStatus: conflicts.length ? "pending" : "approved",
  };
  return {
    workspace: {
      ...target,
      updatedAt: report.importedAt,
      entities: [...target.entities, ...importedEntities],
      relations: [...target.relations, ...importedRelations],
      mergeHistory: [...target.mergeHistory, report],
    },
    report,
  };
}