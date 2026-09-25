import { WorkspaceSchema, type Workspace } from "./model";

const KEY = "worldforge.workspace.v1";
export interface WorkspaceStore { load(): Workspace | null; save(workspace: Workspace): void; clear(): void; }
export class LocalWorkspaceStore implements WorkspaceStore {
  load() { const raw=localStorage.getItem(KEY); if (!raw) return null; const parsed=WorkspaceSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : null; }
  save(workspace: Workspace) { localStorage.setItem(KEY, JSON.stringify(workspace)); }
  clear() { localStorage.removeItem(KEY); }
}
export function downloadWorkspace(workspace: Workspace) { const blob=new Blob([JSON.stringify(workspace,null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob); const link=document.createElement("a"); link.href=url; link.download=`${workspace.name.toLowerCase().replace(/[^a-z0-9]+/g,"-") || "worldforge"}.worldforge.json`; link.click(); URL.revokeObjectURL(url); }
