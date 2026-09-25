import { WorkspaceSchema, type Workspace } from "./model.ts";
import { buildWorkspaceReports } from "./reports.ts";
import { serializeWorkspaceJSON, serializeWorkspaceMarkdown, serializeWorkspaceYAML, serializeWorkspaceZip } from "./serialization.ts";
import { renderWorkspacePreview } from "../application/preview.ts";

const KEY = "worldforge.workspace.v1";
export type WorkspaceExportFormat = "json" | "yaml" | "markdown" | "zip" | "html" | "reports" | "sqlite";
export interface WorkspaceStore { load(): Workspace | null; save(workspace: Workspace): void; clear(): void; exportDatabase?(): Uint8Array; }
export class InMemoryWorkspaceStore implements WorkspaceStore {
  private workspace: Workspace | null = null;
  load() { return this.workspace === null ? null : structuredClone(this.workspace); }
  save(workspace: Workspace) { this.workspace = structuredClone(workspace); }
  clear() { this.workspace = null; }
}
export class LocalWorkspaceStore implements WorkspaceStore {
  load() { const raw=localStorage.getItem(KEY); if (!raw) return null; const parsed=WorkspaceSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : null; }
  save(workspace: Workspace) { localStorage.setItem(KEY, JSON.stringify(workspace)); }
  clear() { localStorage.removeItem(KEY); }
}
function downloadText(filename: string, content: string, type="application/json") { const blob=new Blob([content],{type}); const url=URL.createObjectURL(blob); const link=document.createElement("a"); link.href=url; link.download=filename; link.click(); URL.revokeObjectURL(url); }
function downloadBinary(filename: string, bytes: Uint8Array, type: string) { const blob=new Blob([bytes.slice().buffer],{type}); const url=URL.createObjectURL(blob); const link=document.createElement("a"); link.href=url; link.download=filename; link.click(); URL.revokeObjectURL(url); }
function downloadJson(filename: string, content: unknown) { downloadText(filename,JSON.stringify(content,null,2)); }
function workspaceFilename(workspace: Workspace) { return workspace.name.toLowerCase().replace(/[^a-z0-9]+/g,"-") || "worldforge"; }
export function downloadWorkspace(workspace: Workspace, format: WorkspaceExportFormat, sqliteBytes?: Uint8Array) {
  const filename=workspaceFilename(workspace);
  if(format==="json")downloadText(`${filename}.worldforge.json`,serializeWorkspaceJSON(workspace));
  else if(format==="yaml")downloadText(`${filename}.worldforge.yaml`,serializeWorkspaceYAML(workspace),"application/yaml");
  else if(format==="markdown")downloadText(`${filename}.worldforge.md`,serializeWorkspaceMarkdown(workspace),"text/markdown");
  else if(format==="zip")downloadBinary(`${filename}.worldforge.zip`,serializeWorkspaceZip(workspace),"application/zip");
  else if(format==="html")downloadText(`${filename}.preview.html`,renderWorkspacePreview(workspace),"text/html");
  else if(format==="reports")downloadWorkspaceReport(workspace);
  else if(sqliteBytes)downloadBinary(`${filename}.sqlite`,sqliteBytes,"application/vnd.sqlite3");
  else throw new Error("SQLite-Export ist fuer den aktuellen Store nicht verfuegbar.");
}
export function downloadWorkspaceReport(workspace: Workspace) { downloadJson(`${workspaceFilename(workspace)}.reports.json`,buildWorkspaceReports(workspace)); }
