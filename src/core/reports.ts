import { validateWorkspace, type MergeConflict, type Workspace } from "./model.ts";
import { registeredSchemas, schemaFor, validateWithPlugins } from "./plugins.ts";

export type ReportFinding = { severity: "error" | "warning" | "info"; message: string; entityId?: string; relationId?: string };

export function buildWorkspaceReports(workspace: Workspace) {
  const conflicts: MergeConflict[] = workspace.mergeHistory.flatMap(entry => entry.conflicts);
  const findings: ReportFinding[] = validateWorkspace(workspace).findings;
  const entitiesById = new Map(workspace.entities.map(entity => [entity.id, entity]));
  const names = new Map<string, string[]>();
  const addName = (type: string, name: string, id: string) => {
    const key = `${type}:${name.trim().toLowerCase()}`;
    if (!key.endsWith(":")) names.set(key, [...(names.get(key) ?? []), id]);
  };

  for (const entity of workspace.entities) {
    for (const name of [entity.title, ...(entity.aliases ?? [])]) addName(entity.type, name, entity.id);
    if (!(entity.sources ?? []).length) findings.push({ severity: "warning", message: `Entity „${entity.title}“ hat keine dokumentierte Quelle.`, entityId: entity.id });
    const registration = schemaFor(entity.type);
    if (!registration) findings.push({ severity: "warning", message: `Kein Plugin-Schema fuer Typ ${entity.type} registriert.`, entityId: entity.id });
    else {
      const parsed = registration.schema.safeParse(entity.data);
      if (!parsed.success) findings.push(...parsed.error.issues.map(issue => ({ severity: "error" as const, message: `${entity.title}: ${issue.path.join(".")}: ${issue.message}`, entityId: entity.id })));
    }
    findings.push(...validateWithPlugins(entity));
  }
  for (const [key, ids] of names) {
    const distinctIds = [...new Set(ids)];
    if (distinctIds.length > 1) conflicts.push({ kind: "entity-name", message: `Mehrdeutiger Name/Alias „${key.slice(key.indexOf(":") + 1)}“ bei ${distinctIds.length} Entities.`, sourceId: distinctIds[1], targetId: distinctIds[0] });
    for (let index = 1; index < distinctIds.length; index++) {
      const first = entitiesById.get(distinctIds[0]);
      const next = entitiesById.get(distinctIds[index]);
      if (first && next && JSON.stringify(first.data) !== JSON.stringify(next.data)) conflicts.push({ kind: "entity-content", message: `Abweichende Daten bei gleichem Namen/Alias „${key.slice(key.indexOf(":") + 1)}“.`, sourceId: next.id, targetId: first.id });
    }
  }

  const opposingKinds: Record<string, string> = { allied_with:"enemy_of", enemy_of:"allied_with", owns:"owned_by", owned_by:"owns", controls:"controlled_by", controlled_by:"controls" };
  const relationNames = new Map<string, string>();
  for (const relation of workspace.relations) {
    const key = `${relation.fromId}:${relation.kind}:${relation.toId}`;
    const existingRelation = relationNames.get(key);
    if (existingRelation) conflicts.push({ kind: "relation-duplicate", message: `Relation ${relation.kind} zwischen ${relation.fromId} und ${relation.toId} ist mehrfach vorhanden.`, sourceId: relation.id, targetId: existingRelation });
    const opposing = opposingKinds[relation.kind];
    const opposingId = opposing ? relationNames.get(`${relation.fromId}:${opposing}:${relation.toId}`) : undefined;
    if (opposingId) conflicts.push({ kind: "relation-opposition", message: `Widerspruechliche Relationsarten ${relation.kind} und ${opposing} zwischen ${relation.fromId} und ${relation.toId}.`, sourceId: relation.id, targetId: opposingId });
    relationNames.set(key, relation.id);
    if (relation.status === "disputed") findings.push({ severity: "warning", message: `Relation ${relation.kind} ist als umstritten markiert.`, relationId: relation.id });
  }

  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const relation of workspace.relations) {
    outgoing.set(relation.fromId, (outgoing.get(relation.fromId) ?? 0) + 1);
    incoming.set(relation.toId, (incoming.get(relation.toId) ?? 0) + 1);
  }
  const entityIndex = workspace.entities.map(entity => ({
    id: entity.id,
    type: entity.type,
    title: entity.title,
    aliases: entity.aliases ?? [],
    canonState: entity.canonState ?? "unknown",
    sources: entity.sources ?? [],
    incoming: incoming.get(entity.id) ?? 0,
    outgoing: outgoing.get(entity.id) ?? 0,
  }));
  const relationIndex = workspace.relations.map(relation => ({
    id: relation.id,
    fromId: relation.fromId,
    fromTitle: entitiesById.get(relation.fromId)?.title ?? null,
    kind: relation.kind,
    toId: relation.toId,
    toTitle: entitiesById.get(relation.toId)?.title ?? null,
    weight: relation.weight ?? 1,
    confidence: relation.confidence ?? 1,
    status: relation.status ?? "confirmed",
    sources: relation.sources ?? [],
    time: relation.time ?? {},
  }));

  const canonStates = ["canon", "semi-canon", "alternate-canon", "deprecated", "unknown", "review-required"] as const;
  const canonReport = Object.fromEntries(canonStates.map(state => [state, workspace.entities.filter(entity => (entity.canonState ?? "unknown") === state).map(entity => ({ id: entity.id, title: entity.title }))]));
  const events = workspace.entities.filter(entity => entity.type === "event" || entity.type === "timeline-event");
  const timelineFindings: ReportFinding[] = [];
  const timelineEvents = events.map(entity => {
    const date = entity.data.date ?? entity.data.startDate;
    const timestamp = typeof date === "string" ? Date.parse(date) : Number.NaN;
    if (!Number.isFinite(timestamp)) timelineFindings.push({ severity: "warning", message: `Ereignis „${entity.title}“ hat kein gueltiges Datum.`, entityId: entity.id });
    return { id: entity.id, title: entity.title, date: typeof date === "string" ? date : null, timestamp };
  }).sort((left, right) => left.timestamp - right.timestamp);
  const causalRelations = workspace.relations.filter(relation => relation.kind === "caused_by" || relation.kind === "causes");
  const adjacency = new Map<string, string[]>();
  const eventsWithCauses = new Set<string>();
  const eventTimestamps = new Map(timelineEvents.filter(event => Number.isFinite(event.timestamp)).map(event => [event.id, event.timestamp]));
  for (const relation of causalRelations) adjacency.set(relation.fromId, [...(adjacency.get(relation.fromId) ?? []), relation.toId]);
  for (const relation of causalRelations) {
    const effectId = relation.kind === "caused_by" ? relation.fromId : relation.toId;
    const causeId = relation.kind === "caused_by" ? relation.toId : relation.fromId;
    eventsWithCauses.add(effectId);
    const effectDate = eventTimestamps.get(effectId);
    const causeDate = eventTimestamps.get(causeId);
    if (effectDate !== undefined && causeDate !== undefined && causeDate > effectDate) timelineFindings.push({ severity: "error", message: `Kausalitaets-Paradox: Ursache liegt zeitlich nach dem Ereignis.`, entityId: effectId, relationId: relation.id });
  }
  for (const event of events) if (!eventsWithCauses.has(event.id)) timelineFindings.push({ severity: "info", message: `Fuer Ereignis „${event.title}“ ist keine Ursache verknuepft.`, entityId: event.id });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (visiting.has(id)) { cycles.add([...path.slice(path.indexOf(id)), id].join(" -> ")); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) visit(next, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const event of events) visit(event.id, []);
  for (const cycle of cycles) timelineFindings.push({ severity: "error", message: `Kausaler Zyklus erkannt: ${cycle}` });
  for (const relation of workspace.relations) {
    if (!(relation.sources ?? []).length) findings.push({ severity: "warning", message: `Relation ${relation.kind} hat keine dokumentierte Quelle.`, relationId: relation.id });
    const from = relation.time?.from;
    const to = relation.time?.to;
    if (from && !Number.isFinite(Date.parse(from))) timelineFindings.push({ severity: "error", message: `Ungueltiger Relations-Zeitbeginn: ${from}`, relationId: relation.id });
    if (to && !Number.isFinite(Date.parse(to))) timelineFindings.push({ severity: "error", message: `Ungueltiges Relations-Zeitende: ${to}`, relationId: relation.id });
    if (from && to && Date.parse(from) > Date.parse(to)) timelineFindings.push({ severity: "error", message: "Relations-Zeitbeginn liegt nach dem Zeitende.", relationId: relation.id });
  }

  const assets = workspace.entities.filter(entity => entity.type === "asset");
  const assetHashes = new Map<string, string[]>();
  for (const asset of assets) {
    const hash = asset.data.sha256;
    if (typeof hash === "string" && hash.trim()) assetHashes.set(hash.trim().toLowerCase(), [...(assetHashes.get(hash.trim().toLowerCase()) ?? []), asset.id]);
  }
  const duplicateAssets = [...assetHashes].filter(([, ids]) => ids.length > 1).map(([sha256, ids]) => ({ sha256, entityIds: ids }));
  for (const duplicate of duplicateAssets) conflicts.push({ kind: "entity-content", message: `Doppelte Asset-Datei mit SHA-256 ${duplicate.sha256}; Entities: ${duplicate.entityIds.join(", " )}.`, sourceId: duplicate.entityIds[0], targetId: duplicate.entityIds[1] });

  const validation = validateWorkspace(workspace);
  const dataQuality = [...findings, ...timelineFindings];
  const recommendations = [
    ...conflicts.map(conflict => `Manuell pruefen: ${conflict.message}`),
    ...dataQuality.filter(finding => finding.severity !== "info").map(finding => `Datenqualitaet verbessern: ${finding.message}`),
    ...workspace.entities.filter(entity => entity.type === "event" && !entity.data.date && !entity.data.startDate).map(entity => `Zeitangabe fuer Ereignis „${entity.title}“ ergaenzen.`),
    ...workspace.entities.filter(entity => (entity.canonState ?? "unknown") === "unknown").map(entity => `Canon-Status fuer „${entity.title}“ klaeren.`),
    ...timelineFindings.filter(finding => finding.message.includes("keine Ursache")).map(finding => `Kausalitaet pruefen: ${finding.message}`),
    ...entityIndex.filter(entity => entity.incoming + entity.outgoing === 0).map(entity => `Graph-Anbindung fuer „${entity.title}“ pruefen.`),
  ];

  return {
    schemaRegistry: registeredSchemas().map(schema => ({ type: schema.type, version: schema.version, label: schema.label })),
    knowledgeGraph: { nodes: workspace.entities.map(entity => entity.id), edges: workspace.relations.map(relation => ({ id: relation.id, from: relation.fromId, to: relation.toId, kind: relation.kind })) },
    entityIndex,
    relationIndex,
    conflictReport: { count: conflicts.length, items: conflicts },
    canonReport: { counts: Object.fromEntries(canonStates.map(state => [state, canonReport[state].length])), entitiesByState: canonReport },
    timelineReport: { events: timelineEvents.map(({ timestamp: _timestamp, ...event }) => event), causalGraph: causalRelations.map(relation => ({ from: relation.fromId, to: relation.toId, kind: relation.kind })), missingCauses: events.filter(event => !eventsWithCauses.has(event.id)).map(event => event.id), findings: timelineFindings },
    assetReport: { count: assets.length, assets: assets.map(asset => ({ id: asset.id, title: asset.title, uri: asset.data.uri ?? null, mediaType: asset.data.mediaType ?? null, sha256: asset.data.sha256 ?? null })), duplicates: duplicateAssets },
    mergeReport: { imports: workspace.mergeHistory, importedEntities: workspace.mergeHistory.reduce((total, entry) => total + entry.entitiesAdded, 0), importedRelations: workspace.mergeHistory.reduce((total, entry) => total + entry.relationsAdded, 0) },
    dataQualityReport: { valid: dataQuality.every(finding => finding.severity !== "error"), findings: dataQuality },
    recommendations,
  };
}