import { validateWorkspace, type MergeConflict, type Relation, type Workspace } from "../core/model.ts";
import type { WorkspaceStore } from "../core/store.ts";
import { serializeWorkspaceJSON } from "../core/serialization.ts";

export type SyncSnapshot = { workspace: Workspace; revision: string };
export interface WorkspaceSyncAdapter {
  pull(workspaceId: string): Promise<SyncSnapshot | null>;
  compareAndSwap(workspace: Workspace, expectedRevision: string | null): Promise<SyncSnapshot>;
}
export interface SyncCheckpointStore {
  load(workspaceId: string): SyncSnapshot | null;
  save(snapshot: SyncSnapshot): void;
}
export type SyncResult = { status: "pushed" | "pulled" | "unchanged" | "review-required"; snapshot: SyncSnapshot; conflicts: MergeConflict[]; reviewId?: string };

export class SyncRevisionConflict extends Error {
  readonly current: SyncSnapshot;
  constructor(current: SyncSnapshot) { super("Remote-Revision wurde parallel geaendert."); this.current = current; }
}

export class LocalStorageSyncCheckpointStore implements SyncCheckpointStore {
  private readonly storage: Pick<Storage, "getItem" | "setItem">;
  constructor(storage: Pick<Storage, "getItem" | "setItem"> = localStorage) { this.storage = storage; }
  load(workspaceId: string): SyncSnapshot | null {
    const serialized = this.storage.getItem(`worldforge.sync.v1:${workspaceId}`);
    if (!serialized) return null;
    try {
      const value = JSON.parse(serialized) as { workspace?: unknown; revision?: unknown };
      const result = validateWorkspace(value.workspace);
      if (typeof value.revision !== "string" || !result.workspace || result.workspace.id !== workspaceId || result.findings.some(finding => finding.severity === "error")) return null;
      return { workspace: result.workspace, revision: value.revision };
    } catch {
      return null;
    }
  }
  save(snapshot: SyncSnapshot): void { this.storage.setItem(`worldforge.sync.v1:${snapshot.workspace.id}`, JSON.stringify(snapshot)); }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function entityContent(entity: Workspace["entities"][number]) {
  return stable({ type: entity.type, schemaVersion: entity.schemaVersion, title: entity.title, aliases: entity.aliases, canonState: entity.canonState, sources: entity.sources, data: entity.data, tags: entity.tags });
}

function relationContent(relation: Relation) {
  return stable({ fromId: relation.fromId, toId: relation.toId, kind: relation.kind, weight: relation.weight, confidence: relation.confidence, status: relation.status, sources: relation.sources, time: relation.time, data: relation.data });
}

function addSyncSource<T extends { sources: Relation["sources"] }>(record: T, source: Workspace, kind: "entity" | "relation", originalId: string, importedAt: string): T {
  return { ...record, sources: [...record.sources, { kind: "remote-sync", uri: `workspace:${source.id}#${kind}:${originalId}`, label: source.name, importedAt }] };
}

export function reconcileConcurrentWorkspaces(base: Workspace, local: Workspace, remote: Workspace): { workspace: Workspace; conflicts: MergeConflict[]; reportId: string } {
  if (base.id !== local.id || local.id !== remote.id) throw new Error("Sync-Workspaces muessen dieselbe ID besitzen.");
  const conflicts: MergeConflict[] = [];
  let workspaceName = local.name;
  if (local.name !== base.name && remote.name !== base.name && local.name !== remote.name) conflicts.push({ kind: "sync-entity", message: `Workspace-Name wurde gleichzeitig geaendert: lokal „${local.name}“, remote „${remote.name}“.`, sourceId: remote.id, targetId: local.id });
  else if (local.name === base.name && remote.name !== base.name) workspaceName = remote.name;
  const idMap: Record<string, string> = {};
  const baseEntities = new Map(base.entities.map(entity => [entity.id, entity]));
  const localEntities = new Map(local.entities.map(entity => [entity.id, entity]));
  const remoteEntities = new Map(remote.entities.map(entity => [entity.id, entity]));
  const entityIds = new Set(local.entities.map(entity => entity.id));
  let entitiesAdded = 0;
  let entities = [...local.entities];
  const importedAt = new Date().toISOString();
  const indexEntity = (entity: Workspace["entities"][number], id: string) => {
    const imported = addSyncSource({ ...entity, id, workspaceId: local.id }, remote, "entity", entity.id, importedAt);
    entities.push(imported);
    entityIds.add(id);
    entitiesAdded++;
    return imported;
  };

  for (const remoteEntity of remote.entities) {
    const localEntity = localEntities.get(remoteEntity.id);
    const baseEntity = baseEntities.get(remoteEntity.id);
    if (!localEntity) {
      const id = entityIds.has(remoteEntity.id) ? crypto.randomUUID() : remoteEntity.id;
      idMap[remoteEntity.id] = id;
      indexEntity(remoteEntity, id);
      if (baseEntity) conflicts.push({ kind: "sync-entity", message: `Lokale Entity ${remoteEntity.title} fehlt; die Remote-Fassung wurde erhalten.`, sourceId: remoteEntity.id, targetId: id });
      continue;
    }
    idMap[remoteEntity.id] = localEntity.id;
    const localChanged = !baseEntity || entityContent(localEntity) !== entityContent(baseEntity);
    const remoteChanged = !baseEntity || entityContent(remoteEntity) !== entityContent(baseEntity);
    if (!baseEntity && entityContent(localEntity) === entityContent(remoteEntity)) continue;
    if (!localChanged && !remoteChanged) continue;
    if (remoteChanged && !localChanged) {
      entities = entities.map(entity => entity.id === localEntity.id ? addSyncSource({ ...remoteEntity, workspaceId: local.id }, remote, "entity", remoteEntity.id, importedAt) : entity);
      continue;
    }
    if (localChanged && !remoteChanged) continue;
    if (localChanged && remoteChanged && entityContent(localEntity) === entityContent(remoteEntity)) {
      entities = entities.map(entity => entity.id === localEntity.id ? { ...entity, history: [...entity.history, ...remoteEntity.history.filter(item => !entity.history.some(existing => existing.revision === item.revision && existing.changedAt === item.changedAt))], revision: Math.max(entity.revision, remoteEntity.revision) } : entity);
      continue;
    }
    const duplicateId = crypto.randomUUID();
    idMap[remoteEntity.id] = duplicateId;
    indexEntity(remoteEntity, duplicateId);
    conflicts.push({ kind: "sync-entity", message: `Entity „${localEntity.title}“ wurde gleichzeitig unterschiedlich geaendert; beide Fassungen bleiben erhalten.`, sourceId: remoteEntity.id, targetId: localEntity.id });
  }

  for (const localEntity of local.entities) {
    if (baseEntities.has(localEntity.id) && !remoteEntities.has(localEntity.id)) conflicts.push({ kind: "sync-entity", message: `Remote-Loeschung von „${localEntity.title}“ wurde nicht uebernommen.`, sourceId: localEntity.id, targetId: localEntity.id });
  }

  const baseRelations = new Map(base.relations.map(relation => [relation.id, relation]));
  const localRelations = new Map(local.relations.map(relation => [relation.id, relation]));
  const remoteRelations = new Map(remote.relations.map(relation => [relation.id, relation]));
  const relationIds = new Set(local.relations.map(relation => relation.id));
  let relations = [...local.relations];
  let relationsAdded = 0;
  for (const remoteRelation of remote.relations) {
    const fromId = idMap[remoteRelation.fromId] ?? remoteRelation.fromId;
    const toId = idMap[remoteRelation.toId] ?? remoteRelation.toId;
    const mapped = addSyncSource({ ...remoteRelation, workspaceId: local.id, fromId, toId }, remote, "relation", remoteRelation.id, importedAt);
    const localRelation = localRelations.get(remoteRelation.id);
    const baseRelation = baseRelations.get(remoteRelation.id);
    const endpointsForked = fromId !== remoteRelation.fromId || toId !== remoteRelation.toId;
    if (!localRelation) {
      const id = relationIds.has(remoteRelation.id) ? crypto.randomUUID() : remoteRelation.id;
      relations.push({ ...mapped, id });
      relationIds.add(id);
      relationsAdded++;
      if (baseRelation) conflicts.push({ kind: "sync-relation", message: `Lokale Relation ${remoteRelation.kind} fehlt; die Remote-Fassung wurde erhalten.`, sourceId: remoteRelation.id, targetId: id });
      continue;
    }
    const sameBase = baseRelation && relationContent(localRelation) === relationContent(baseRelation);
    const remoteSameBase = baseRelation && relationContent(remoteRelation) === relationContent(baseRelation);
    if (endpointsForked) {
      const id = crypto.randomUUID();
      relations.push({ ...mapped, id });
      relationIds.add(id);
      relationsAdded++;
      conflicts.push({ kind: "sync-relation", message: `Remote-Relation ${remoteRelation.kind} wurde auf die erhaltene Remote-Entity-Fassung umgehaengt.`, sourceId: remoteRelation.id, targetId: localRelation.id });
    } else if (baseRelation && remoteSameBase && !sameBase) {
      continue;
    } else if (baseRelation && sameBase && !remoteSameBase) {
      relations = relations.map(relation => relation.id === localRelation.id ? mapped : relation);
    } else if (relationContent(localRelation) !== relationContent(remoteRelation)) {
      const id = crypto.randomUUID();
      relations.push({ ...mapped, id });
      relationIds.add(id);
      relationsAdded++;
      conflicts.push({ kind: "sync-relation", message: `Relation ${remoteRelation.kind} wurde gleichzeitig unterschiedlich geaendert; beide Kanten bleiben erhalten.`, sourceId: remoteRelation.id, targetId: localRelation.id });
    }
  }
  for (const localRelation of local.relations) {
    if (baseRelations.has(localRelation.id) && !remoteRelations.has(localRelation.id)) conflicts.push({ kind: "sync-relation", message: `Remote-Loeschung der Relation ${localRelation.kind} wurde nicht uebernommen.`, sourceId: localRelation.id, targetId: localRelation.id });
  }

  const reportId = crypto.randomUUID();
  const report = { id: reportId, sourceWorkspaceId: remote.id, sourceName: remote.name, importedAt, entitiesAdded, relationsAdded, idMap, conflicts, reviewStatus: conflicts.length ? "pending" as const : "approved" as const };
  return { workspace: { ...local, name: workspaceName, updatedAt: importedAt, entities, relations, mergeHistory: [...local.mergeHistory, report] }, conflicts, reportId };
}

export class WorkspaceSyncService {
  private readonly localStore: WorkspaceStore;
  private readonly remote: WorkspaceSyncAdapter;
  private readonly checkpoints?: SyncCheckpointStore;

  constructor(localStore: WorkspaceStore, remote: WorkspaceSyncAdapter, checkpoints?: SyncCheckpointStore) { this.localStore = localStore; this.remote = remote; this.checkpoints = checkpoints; }

  async synchronizeFromCheckpoint(): Promise<SyncResult> {
    const local = this.localStore.load();
    if (!local) throw new Error("Kein lokaler Workspace zum Synchronisieren.");
    if (!this.checkpoints) throw new Error("Kein Sync-Checkpoint-Store konfiguriert.");
    const result = await this.synchronize(this.checkpoints.load(local.id));
    this.checkpoints.save(result.snapshot);
    return result;
  }

  async synchronize(base: SyncSnapshot | null): Promise<SyncResult> {
    const local = this.localStore.load();
    if (!local) throw new Error("Kein lokaler Workspace zum Synchronisieren.");
    const openReview = local.mergeHistory.find(entry => entry.reviewStatus === "pending" && entry.conflicts.some(conflict => conflict.kind.startsWith("sync-")));
    const currentRemote = await this.remote.pull(local.id);
    if (currentRemote && currentRemote.workspace.id !== local.id) throw new Error("Remote hat eine andere Workspace-ID geliefert.");
    if (openReview) {
      if (!currentRemote) throw new Error("Remote-Workspace fehlt waehrend ein Sync-Konflikt geprueft wird.");
      return { status: "review-required", snapshot: currentRemote, conflicts: openReview.conflicts, reviewId: openReview.id };
    }
    if (!currentRemote) {
      if (base) throw new Error("Remote-Workspace fehlt trotz vorhandenem Sync-Checkpoint.");
      const snapshot = await this.remote.compareAndSwap(local, null);
      this.localStore.save(snapshot.workspace);
      return { status: "pushed", snapshot, conflicts: [] };
    }
    if (base && currentRemote.revision === base.revision) {
      if (serializeWorkspaceJSON(local) === serializeWorkspaceJSON(base.workspace)) {
        this.localStore.save(currentRemote.workspace);
        return { status: "pulled", snapshot: currentRemote, conflicts: [] };
      }
      return this.pushOrReconcile(local, base, currentRemote);
    }
    if (base && serializeWorkspaceJSON(local) === serializeWorkspaceJSON(base.workspace)) {
      this.localStore.save(currentRemote.workspace);
      return { status: "pulled", snapshot: currentRemote, conflicts: [] };
    }
    if (serializeWorkspaceJSON(local) === serializeWorkspaceJSON(currentRemote.workspace)) return { status: "unchanged", snapshot: currentRemote, conflicts: [] };
    const common = base?.workspace ?? { ...local, entities: [], relations: [], mergeHistory: [] };
    return this.reconcileAndReturn(common, local, currentRemote);
  }

  approveReview(reviewId: string): Workspace {
    const local = this.localStore.load();
    if (!local) throw new Error("Kein lokaler Workspace zum Synchronisieren.");
    const review = local.mergeHistory.find(entry => entry.id === reviewId && entry.reviewStatus === "pending" && entry.conflicts.some(conflict => conflict.kind.startsWith("sync-")));
    if (!review) throw new Error("Offener Sync-Konfliktbericht nicht gefunden.");
    const approved = { ...local, mergeHistory: local.mergeHistory.map(entry => entry.id === reviewId ? { ...entry, reviewStatus: "approved" as const } : entry) };
    this.localStore.save(approved);
    return approved;
  }

  async publishReviewed(expectedRevision?: string): Promise<SyncSnapshot> {
    const approved = this.localStore.load();
    if (!approved) throw new Error("Kein lokaler Workspace zum Synchronisieren.");
    const revision = expectedRevision ?? this.checkpoints?.load(approved.id)?.revision;
    if (!revision) throw new Error("Kein Remote-Checkpoint fuer den Review-Push vorhanden.");
    if (approved.mergeHistory.some(entry => entry.reviewStatus === "pending" && entry.conflicts.some(conflict => conflict.kind.startsWith("sync-")))) throw new Error("Alle Sync-Konflikte muessen vor dem Push geprueft werden.");
    if (!approved.mergeHistory.some(entry => entry.reviewStatus === "approved" && entry.conflicts.some(conflict => conflict.kind.startsWith("sync-")))) throw new Error("Kein freigegebener Sync-Konfliktbericht gefunden.");
    const snapshot = await this.remote.compareAndSwap(approved, revision);
    this.localStore.save(snapshot.workspace);
    this.checkpoints?.save(snapshot);
    return snapshot;
  }

  private async pushOrReconcile(local: Workspace, base: SyncSnapshot, remote: SyncSnapshot): Promise<SyncResult> {
    try {
      const snapshot = await this.remote.compareAndSwap(local, remote.revision);
      this.localStore.save(snapshot.workspace);
      return { status: "pushed", snapshot, conflicts: [] };
    } catch (error) {
      if (!(error instanceof SyncRevisionConflict)) throw error;
      return this.reconcileAndReturn(base.workspace, local, error.current);
    }
  }

  private async reconcileAndReturn(base: Workspace, local: Workspace, remote: SyncSnapshot): Promise<SyncResult> {
    const result = reconcileConcurrentWorkspaces(base, local, remote.workspace);
    if (result.conflicts.length) {
      this.localStore.save(result.workspace);
      return { status: "review-required", snapshot: remote, conflicts: result.conflicts, reviewId: result.reportId };
    }
    const snapshot = await this.remote.compareAndSwap(result.workspace, remote.revision);
    this.localStore.save(snapshot.workspace);
    return { status: "pushed", snapshot, conflicts: [] };
  }
}

export class HttpWorkspaceSyncAdapter implements WorkspaceSyncAdapter {
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;

  constructor(endpoint: string, fetcher: typeof fetch = fetch) {
    this.endpoint = endpoint.replace(/\/+$/, "");
    this.fetcher = fetcher;
  }

  async pull(workspaceId: string): Promise<SyncSnapshot | null> {
    const response = await this.fetcher(`${this.endpoint}/workspaces/${encodeURIComponent(workspaceId)}`, { headers: { Accept: "application/json" } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Sync-GET fehlgeschlagen: HTTP ${response.status}`);
    return this.parseSnapshot(await response.json());
  }

  async compareAndSwap(workspace: Workspace, expectedRevision: string | null): Promise<SyncSnapshot> {
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
    if (expectedRevision === null) headers["If-None-Match"] = "*";
    else headers["If-Match"] = expectedRevision;
    const response = await this.fetcher(`${this.endpoint}/workspaces/${encodeURIComponent(workspace.id)}`, {
      method: "PUT",
      headers,
      body: serializeWorkspaceJSON(workspace),
    });
    if (response.status === 409 || response.status === 412) {
      const current = await this.pull(workspace.id);
      if (!current) throw new Error("Sync-Revisionkonflikt: Remote-Fassung ist nicht verfuegbar.");
      throw new SyncRevisionConflict(current);
    }
    if (!response.ok) throw new Error(`Sync-PUT fehlgeschlagen: HTTP ${response.status}`);
    return this.parseSnapshot(await response.json());
  }

  private parseSnapshot(input: unknown): SyncSnapshot {
    if (!input || typeof input !== "object") throw new Error("Sync-Antwort ist ungueltig.");
    const payload = input as Record<string, unknown>;
    if (typeof payload.revision !== "string") throw new Error("Sync-Antwort enthaelt keine Revision.");
    const result = validateWorkspace(payload.workspace);
    if (!result.workspace || result.findings.some(finding => finding.severity === "error")) throw new Error("Remote-Workspace ist ungueltig.");
    return { workspace: result.workspace, revision: payload.revision };
  }
}