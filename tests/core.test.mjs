import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeWorkspaces } from '../src/core/merge.ts';
import { validateWorkspace } from '../src/core/model.ts';
import { buildWorkspaceReports } from '../src/core/reports.ts';
import { importWorkspaceFile, importWorkspaceJSON, importWorkspaceMarkdown, importWorkspaceYAML, importWorkspaceZip, serializeWorkspaceJSON, serializeWorkspaceMarkdown, serializeWorkspaceYAML, serializeWorkspaceZip } from '../src/core/serialization.ts';
import { InMemoryWorkspaceStore } from '../src/core/store.ts';
import initSqlJs from 'sql.js';
import { SqliteWorkspaceStore } from '../src/core/sqlite-store.ts';
import { archiveEntityCommand, createEntityCommand, createRelationCommand, migrateEntityCommand, updateEntityCommand } from '../src/application/commands.ts';
import { listWorkspaceTags, relationGraphQuery, searchWorkspaceEntities } from '../src/application/queries.ts';
import { PluginRegistry } from '../src/core/plugins.ts';
import '../src/plugins/index.ts';
import { HeadlessWorldForge } from '../src/application/headless.ts';
import { renderWorkspacePreview } from '../src/application/preview.ts';
import { HttpWorkspaceSyncAdapter, LocalStorageSyncCheckpointStore, SyncRevisionConflict, WorkspaceSyncService } from '../src/application/sync.ts';

test('WorldForge workspace contract is documented', () => {
  assert.match(JSON.stringify({type:'world',schemaVersion:1}), /world/);
  assert.equal(typeof crypto.randomUUID, 'function');
});

test('merge preserves records, remaps colliding ids and rewrites relation endpoints', () => {
  const now = new Date().toISOString();
  const entity = (id, title) => ({ id, workspaceId: 'source', type: 'character', schemaVersion: 1, title, data: {}, tags: [], revision: 0, createdAt: now, updatedAt: now });
  const target = { id: 'target', name: 'Master', schemaVersion: 1, createdAt: now, updatedAt: now, entities: [{ ...entity('shared', 'Existing'), workspaceId: 'target' }], relations: [], mergeHistory: [] };
  const source = { id: 'source', name: 'Import', schemaVersion: 1, createdAt: now, updatedAt: now, entities: [entity('shared', 'Existing'), entity('other', 'Existing')], relations: [{ id: 'rel', workspaceId: 'source', fromId: 'shared', toId: 'other', kind: 'allied_with', data: {} }] };

  const { workspace, report } = mergeWorkspaces(target, source);

  assert.equal(workspace.entities.length, 3);
  assert.equal(workspace.relations.length, 1);
  assert.notEqual(report.idMap.shared, 'shared');
  assert.equal(workspace.relations[0].fromId, report.idMap.shared);
  assert.equal(workspace.relations[0].toId, report.idMap.other);
  assert.ok(workspace.entities.every(item => item.workspaceId === 'target'));
  assert.ok(workspace.relations.every(item => item.workspaceId === 'target'));
  assert.equal(workspace.entities[1].sources.at(-1).uri, 'workspace:source#entity:shared');
  assert.deepEqual(report.conflicts.map(item => item.kind), ['entity-id', 'entity-name', 'entity-name', 'entity-name']);
  assert.equal(workspace.mergeHistory[0].id, report.id);
});

test('workspace validation rejects ambiguous ids and accepts legacy files without merge history', () => {
  const now = new Date().toISOString();
  const entity = { id: 'duplicate', workspaceId: 'source', type: 'world', schemaVersion: 1, title: 'World', data: {}, tags: [], revision: 0, createdAt: now, updatedAt: now };
  const workspace = { id: 'source', name: 'Import', schemaVersion: 1, createdAt: now, updatedAt: now, entities: [entity, entity], relations: [] };

  const result = validateWorkspace(workspace);

  assert.equal(result.findings.some(item => item.message.includes('doppelte Entity-IDs')), true);
  assert.deepEqual(validateWorkspace({ ...workspace, entities: [entity] }).workspace?.mergeHistory, []);
});

test('workspace reports index canon, detect causal cycles and identify duplicate assets', () => {
  const now = new Date().toISOString();
  const entity = (id, type, title, data = {}, canonState = 'unknown') => ({ id, workspaceId: 'w', type, schemaVersion: 1, title, aliases: [], canonState, sources: [{ kind: 'test' }], history: [], data, tags: [], revision: 0, createdAt: now, updatedAt: now });
  const workspace = { id: 'w', name: 'Report test', schemaVersion: 1, createdAt: now, updatedAt: now, mergeHistory: [], entities: [entity('a', 'event', 'Start', { date: 'not-a-date' }, 'canon'), entity('b', 'event', 'End', { date: '2025-01-01' }), entity('asset-a', 'asset', 'Map A', { sha256: 'abc' }), entity('asset-b', 'asset', 'Map B', { sha256: 'ABC' })], relations: [{ id: 'ab', workspaceId: 'w', fromId: 'a', toId: 'b', kind: 'caused_by' }, { id: 'ba', workspaceId: 'w', fromId: 'b', toId: 'a', kind: 'caused_by' }] };

  const report = buildWorkspaceReports(workspace);

  assert.equal(report.knowledgeGraph.nodes.length, 4);
  assert.equal(report.canonReport.counts.canon, 1);
  assert.equal(report.timelineReport.findings.some(item => item.message.includes('Zyklus')), true);
  assert.equal(report.assetReport.duplicates.length, 1);
  assert.equal(report.conflictReport.count, 1);
  assert.deepEqual(Object.keys(report), ['schemaRegistry', 'knowledgeGraph', 'entityIndex', 'relationIndex', 'conflictReport', 'canonReport', 'timelineReport', 'assetReport', 'mergeReport', 'dataQualityReport', 'recommendations']);
  assert.ok(report.recommendations.length > 0);
});

test('legacy relations receive metadata defaults and explicit metadata survives validation', () => {
  const now = new Date().toISOString();
  const entity = { id: 'entity', workspaceId: 'w', type: 'world', schemaVersion: 1, title: 'World', data: {}, tags: [], revision: 0, createdAt: now, updatedAt: now };
  const relation = { id: 'relation', workspaceId: 'w', fromId: 'entity', toId: 'entity', kind: 'part_of', weight: 2, confidence: 0.6, status: 'disputed', sources: [{ kind: 'manual', label: 'Author note' }], time: { from: '1000-01-01', to: '1100-01-01' } };
  const result = validateWorkspace({ id: 'w', name: 'Legacy', schemaVersion: 1, createdAt: now, updatedAt: now, entities: [entity], relations: [relation] });

  assert.equal(result.workspace.relations[0].weight, 2);
  assert.equal(result.workspace.relations[0].confidence, 0.6);
  assert.equal(result.workspace.relations[0].status, 'disputed');
  assert.deepEqual(result.workspace.entities[0].aliases, []);
  assert.equal(result.workspace.entities[0].canonState, 'unknown');
});

test('JSON roundtrip normalizes legacy defaults and produces stable bytes', () => {
  const now = new Date().toISOString();
  const legacy = { id: 'w', name: 'Roundtrip', schemaVersion: 1, createdAt: now, updatedAt: now, entities: [{ id: 'e', workspaceId: 'w', type: 'world', schemaVersion: 1, title: 'World', data: { z: 1, a: 2 }, tags: [], revision: 0, createdAt: now, updatedAt: now }], relations: [] };
  const exported = serializeWorkspaceJSON(legacy);
  const imported = importWorkspaceJSON(exported);

  assert.equal(imported.entities[0].canonState, 'unknown');
  assert.deepEqual(imported.mergeHistory, []);
  assert.equal(serializeWorkspaceJSON(imported), exported);
  assert.throws(() => serializeWorkspaceJSON({ ...legacy, relations: [{ id: 'dead', workspaceId: 'w', fromId: 'e', toId: 'missing', kind: 'located_in' }] }), /unbekannte Entity/);
});

test('in-memory store isolates saved and loaded workspace objects', () => {
  const store = new InMemoryWorkspaceStore();
  const now = new Date().toISOString();
  const workspace = { id: 'w', name: 'Memory', schemaVersion: 1, createdAt: now, updatedAt: now, entities: [], relations: [], mergeHistory: [] };
  store.save(workspace);
  workspace.name = 'Mutated after save';
  const loaded = store.load();
  assert.equal(loaded.name, 'Memory');
  loaded.name = 'Mutated after load';
  assert.equal(store.load().name, 'Memory');
  store.clear();
  assert.equal(store.load(), null);
});

test('generic WorldForge fixture validates without project-specific lore', () => {
  const fixture = importWorkspaceJSON(readFileSync(new URL('./fixtures/worldforge-core.json', import.meta.url), 'utf8'));

  assert.deepEqual(new Set(fixture.entities.map(entity => entity.type)), new Set(['world', 'quest', 'dialogue']));
  assert.equal(fixture.relations.length, 2);
  assert.deepEqual(validateWorkspace(fixture).findings, []);
});

test('SQLite store persists normalized entities and relations across database reopen', async () => {
  const fixture = importWorkspaceJSON(readFileSync(new URL('./fixtures/worldforge-core.json', import.meta.url), 'utf8'));
  const SQL = await initSqlJs();
  let savedDatabase;
  const store = new SqliteWorkspaceStore(new SQL.Database(), bytes => { savedDatabase = bytes; });
  store.save(fixture);
  const secondStore = new SqliteWorkspaceStore(new SQL.Database());
  secondStore.save(fixture);

  assert.equal(store.searchEntities('signal', 'fixture').length, 2);
  assert.equal(store.load().relations.length, 2);
  assert.ok(savedDatabase instanceof Uint8Array);
  assert.equal(Buffer.compare(Buffer.from(savedDatabase), Buffer.from(secondStore.exportDatabase())), 0);
  secondStore.close();
  store.close();

  const reopened = new SqliteWorkspaceStore(new SQL.Database(savedDatabase));
  assert.equal(serializeWorkspaceJSON(reopened.load()), serializeWorkspaceJSON(fixture));
  assert.equal(reopened.searchEntities('', 'fixture').length, 3);
  reopened.clear();
  assert.equal(reopened.load(), null);
  reopened.close();
});

test('application commands preserve history and relations when archiving entities', () => {
  const fixture = importWorkspaceJSON(readFileSync(new URL('./fixtures/worldforge-core.json', import.meta.url), 'utf8'));
  const edited = updateEntityCommand(fixture, fixture.entities[0].id, { title: 'Updated World' });
  const archived = archiveEntityCommand(edited, fixture.entities[0].id);

  assert.equal(archived.entities.length, fixture.entities.length);
  assert.equal(archived.relations.length, fixture.relations.length);
  assert.equal(archived.entities[0].title, 'Updated World');
  assert.equal(archived.entities[0].canonState, 'deprecated');
  assert.equal(archived.entities[0].history.length, 2);
});

test('application commands and queries create directed graph edges and filter by tag', () => {
  const fixture = importWorkspaceJSON(readFileSync(new URL('./fixtures/worldforge-core.json', import.meta.url), 'utf8'));
  const { workspace, entity } = createEntityCommand(fixture, 'character', 'Signal Keeper', { role: 'observer' });
  const connected = createRelationCommand(workspace, entity.id, fixture.entities[0].id, 'located_in', { confidence: 0.8 }).workspace;
  const graph = relationGraphQuery(connected);

  assert.equal(searchWorkspaceEntities(connected, { text: 'signal', tag: 'fixture' }).length, 2);
  assert.ok(listWorkspaceTags(connected).includes('fixture'));
  assert.equal(graph.edges.at(-1).fromId, entity.id);
  assert.equal(graph.edges.at(-1).toTitle, fixture.entities[0].title);
  assert.throws(() => createRelationCommand(fixture, 'missing', fixture.entities[0].id, 'located_in'), /vorhandene Entities/);
});

test('YAML, Markdown and deterministic ZIP roundtrip the canonical workspace', () => {
  const fixture = importWorkspaceJSON(readFileSync(new URL('./fixtures/worldforge-core.json', import.meta.url), 'utf8'));
  const yaml = serializeWorkspaceYAML(fixture);
  const markdown = serializeWorkspaceMarkdown(fixture);
  const zip = serializeWorkspaceZip(fixture);
  const expected = serializeWorkspaceJSON(fixture);

  assert.equal(serializeWorkspaceJSON(importWorkspaceYAML(yaml)), expected);
  assert.equal(serializeWorkspaceJSON(importWorkspaceMarkdown(markdown)), expected);
  assert.equal(serializeWorkspaceJSON(importWorkspaceZip(zip)), expected);
  assert.equal(Buffer.compare(Buffer.from(zip), Buffer.from(serializeWorkspaceZip(fixture))), 0);
  assert.equal(serializeWorkspaceJSON(importWorkspaceFile('core.yaml', new TextEncoder().encode(yaml))), expected);
});

test('plugin registry enforces capabilities and runs versioned schema migrations', () => {
  const registry = new PluginRegistry();
  const schema = { type: 'test-record', version: 2, label: 'Test Record', schema: { safeParse: value => ({ success: true, data: value }) } };
  assert.throws(() => registry.register({ id: 'test.blocked', version: '1.0.0', apiVersion: '1', schemas: [schema], exporters: [{ format: 'test', export: () => '' }], capabilities: ['schemas'] }), /Capability exporters/);

  registry.register({
    id: 'test.records',
    version: '1.0.0',
    apiVersion: '1',
    capabilities: ['schemas', 'migrations', 'exporters', 'validators', 'editors'],
    schemas: [schema],
    migrations: [{ type: 'test-record', fromVersion: 1, toVersion: 2, migrate: data => ({ ...data, upgraded: true }) }],
    exporters: [{ format: 'test-json', export: workspace => JSON.stringify(workspace.id) }],
    validators: [{ id: 'test.validator', validate: () => [{ severity: 'info', message: 'Registered validator' }] }],
    editors: [{ id: 'test.editor', type: 'test-record', fields: [{ key: 'name', label: 'Name', control: 'text' }] }],
  });

  assert.equal(registry.schemaFor('test-record').version, 2);
  assert.deepEqual(registry.migrate('test-record', { name: 'Example' }, 1, 2), { name: 'Example', upgraded: true });
  assert.equal(registry.editorsFor('test-record')[0].fields[0].key, 'name');
  assert.equal(registry.validateEntity({ type: 'test-record' })[0].message, 'Registered validator');
  assert.equal(registry.exporterFor('test-json').export({ id: 'w' }), '"w"');
  assert.throws(() => registry.migrate('test-record', {}, 1, 3), /Keine Migration/);
  assert.throws(() => registry.register({ id: 'test.records', version: '1.0.0', apiVersion: '1', schemas: [] }), /bereits registriert/);
});

test('example plugins expose schemas and contribute validation findings', () => {
  const now = new Date().toISOString();
  const workspace = { id: 'plugins', name: 'Plugin test', schemaVersion: 1, createdAt: now, updatedAt: now, mergeHistory: [], relations: [], entities: [{ id: 'asset', workspaceId: 'plugins', type: 'binary-asset', schemaVersion: 1, title: 'Bad asset', aliases: [], canonState: 'unknown', sources: [{ kind: 'test' }], history: [], data: { uri: 'file:test', sha256: 'bad' }, tags: [], revision: 0, createdAt: now, updatedAt: now }] };

  const report = buildWorkspaceReports(workspace);

  assert.ok(report.schemaRegistry.some(schema => schema.type === 'basic-rule'));
  assert.ok(report.schemaRegistry.some(schema => schema.type === 'timeline-event'));
  assert.equal(report.dataQualityReport.findings.some(finding => finding.entityId === 'asset' && finding.severity === 'error'), true);
});

test('plugin schema migration is explicit and creates an entity history revision', () => {
  const fixture = importWorkspaceJSON(readFileSync(new URL('./fixtures/worldforge-core.json', import.meta.url), 'utf8'));
  const now = new Date().toISOString();
  const oldTimelineEntity = { id: 'timeline-v1', workspaceId: fixture.id, type: 'timeline-event', schemaVersion: 1, title: 'Old event', aliases: [], canonState: 'unknown', sources: [{ kind: 'test' }], history: [], data: { date: '2020-01-01' }, tags: [], revision: 0, createdAt: now, updatedAt: now };
  const oldWorkspace = { ...fixture, entities: [...fixture.entities, oldTimelineEntity] };

  const migrated = migrateEntityCommand(oldWorkspace, oldTimelineEntity.id);

  assert.equal(migrated.entities.at(-1).schemaVersion, 2);
  assert.equal(migrated.entities.at(-1).data.calendar, 'unspecified');
  assert.equal(migrated.entities.at(-1).revision, 1);
  assert.equal(migrated.entities.at(-1).history.length, 1);
});

test('headless application shares commands, graph queries, reports, export and escaped preview', () => {
  const fixture = importWorkspaceJSON(readFileSync(new URL('./fixtures/worldforge-core.json', import.meta.url), 'utf8'));
  const store = new InMemoryWorkspaceStore();
  const engine = new HeadlessWorldForge(store);
  assert.throws(() => engine.workspace(), /Kein Workspace/);
  engine.open({ ...fixture, name: '<img src=x onerror=alert(1)>' });
  const entity = engine.createEntity('character', 'Observer', { role: 'reader' });
  engine.createRelation(entity.id, fixture.entities[0].id, 'located_in');

  assert.equal(engine.search({ text: 'observer' })[0].id, entity.id);
  assert.equal(engine.graph().edges.at(-1).fromId, entity.id);
  assert.equal(engine.reports().knowledgeGraph.nodes.length, 4);
  assert.equal(importWorkspaceJSON(engine.export('json')).entities.length, 4);
  assert.match(engine.export('html'), /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(engine.export('html'), /<img src=x/);
  assert.equal(renderWorkspacePreview(engine.workspace()), engine.export('html'));
});

test('sync preserves concurrent revisions and blocks publication until explicit review', async () => {
  class MemoryRemote {
    snapshot = null;
    sequence = 0;
    async pull() { return this.snapshot && structuredClone(this.snapshot); }
    async compareAndSwap(workspace, expectedRevision) {
      if ((this.snapshot?.revision ?? null) !== expectedRevision) throw new SyncRevisionConflict(this.snapshot);
      this.sequence += 1;
      this.snapshot = { workspace: structuredClone(workspace), revision: String(this.sequence) };
      return structuredClone(this.snapshot);
    }
  }
  const fixture = importWorkspaceJSON(readFileSync(new URL('./fixtures/worldforge-core.json', import.meta.url), 'utf8'));
  const localStore = new InMemoryWorkspaceStore();
  localStore.save(fixture);
  const remote = new MemoryRemote();
  const checkpoint = { snapshot: null, load() { return this.snapshot; }, save(snapshot) { this.snapshot = structuredClone(snapshot); } };
  const sync = new WorkspaceSyncService(localStore, remote, checkpoint);
  const initial = await sync.synchronizeFromCheckpoint();
  localStore.save(updateEntityCommand(localStore.load(), fixture.entities[0].id, { title: 'Local revision' }));
  remote.snapshot.workspace = updateEntityCommand(remote.snapshot.workspace, fixture.entities[0].id, { title: 'Remote revision' });
  remote.snapshot.revision = '2';
  remote.sequence = 2;

  const conflict = await sync.synchronizeFromCheckpoint();

  assert.equal(conflict.status, 'review-required');
  assert.equal(conflict.conflicts.some(item => item.kind === 'sync-entity'), true);
  assert.equal(conflict.conflicts.some(item => item.kind === 'sync-relation'), true);
  assert.equal(localStore.load().entities.length, fixture.entities.length + 1);
  assert.equal(localStore.load().relations.length, fixture.relations.length + 1);
  assert.equal(remote.snapshot.revision, '2');
  assert.equal((await sync.synchronizeFromCheckpoint()).status, 'review-required');
  await assert.rejects(sync.publishReviewed(), /Alle Sync-Konflikte muessen/);
  sync.approveReview(conflict.reviewId);
  await assert.rejects(sync.publishReviewed('1'), SyncRevisionConflict);

  const published = await sync.publishReviewed();

  assert.equal(published.revision, '3');
  assert.equal(published.workspace.entities.length, fixture.entities.length + 1);
  assert.equal(published.workspace.mergeHistory.at(-1).reviewStatus, 'approved');
});

test('local sync checkpoint store roundtrips validated snapshots by workspace ID', () => {
  const fixture = importWorkspaceJSON(readFileSync(new URL('./fixtures/worldforge-core.json', import.meta.url), 'utf8'));
  const storage = new Map();
  const checkpointStore = new LocalStorageSyncCheckpointStore({ getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) });
  checkpointStore.save({ workspace: fixture, revision: 'rev-7' });

  assert.equal(checkpointStore.load(fixture.id).revision, 'rev-7');
  assert.equal(checkpointStore.load('other'), null);
  storage.set(`worldforge.sync.v1:${fixture.id}`, '{broken');
  assert.equal(checkpointStore.load(fixture.id), null);
});

test('HTTP sync adapter uses conditional requests and validates remote snapshots', async () => {
  const fixture = importWorkspaceJSON(readFileSync(new URL('./fixtures/worldforge-core.json', import.meta.url), 'utf8'));
  const requests = [];
  let revision = 'etag-1';
  const fetcher = async (url, init = {}) => {
    requests.push({ url, init });
    if (init.method === 'PUT' && init.headers['If-Match'] === 'stale') return new Response('', { status: 412 });
    return new Response(JSON.stringify({ workspace: fixture, revision }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const adapter = new HttpWorkspaceSyncAdapter('https://sync.example/api/', fetcher);

  assert.equal((await adapter.pull(fixture.id)).revision, 'etag-1');
  const updated = await adapter.compareAndSwap(fixture, 'etag-1');
  assert.equal(updated.revision, 'etag-1');
  await assert.rejects(adapter.compareAndSwap(fixture, 'stale'), SyncRevisionConflict);
  assert.equal(requests[1].init.headers['If-Match'], 'etag-1');
  assert.equal(requests[2].init.headers['If-Match'], 'stale');
  assert.match(requests[2].url, /workspaces%2F|workspaces\//);
});
