import { validateWorkspace, type Workspace } from "./model.ts";
import { parse as parseYAML, stringify as stringifyYAML } from "yaml";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { buildWorkspaceReports } from "./reports.ts";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const serializable = "toJSON" in value && typeof value.toJSON === "function" ? value.toJSON() : value;
    if (serializable !== value) return canonicalize(serializable);
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function serializeWorkspaceJSON(input: unknown): string {
  const result = validateWorkspace(input);
  if (!result.workspace || result.findings.some(finding => finding.severity === "error")) {
    throw new Error(`Workspace kann nicht exportiert werden: ${result.findings.map(finding => finding.message).join("; ")}`);
  }
  return JSON.stringify(canonicalize(result.workspace), null, 2);
}

export function importWorkspaceJSON(serialized: string): Workspace {
  let input: unknown;
  try {
    input = JSON.parse(serialized);
  } catch {
    throw new Error("Import fehlgeschlagen: ungueltiges JSON.");
  }
  const result = validateWorkspace(input);
  if (!result.workspace || result.findings.some(finding => finding.severity === "error")) {
    throw new Error(`Import fehlgeschlagen: ${result.findings.map(finding => finding.message).join("; ")}`);
  }
  return result.workspace;
}

export function serializeWorkspaceYAML(input: unknown): string {
  const workspace = importWorkspaceJSON(serializeWorkspaceJSON(input));
  return stringifyYAML(canonicalize(workspace), { lineWidth: 0, sortMapEntries: true });
}

export function importWorkspaceYAML(serialized: string): Workspace {
  let input: unknown;
  try {
    input = parseYAML(serialized);
  } catch {
    throw new Error("Import fehlgeschlagen: ungueltiges YAML.");
  }
  const result = validateWorkspace(input);
  if (!result.workspace || result.findings.some(finding => finding.severity === "error")) {
    throw new Error(`Import fehlgeschlagen: ${result.findings.map(finding => finding.message).join("; ")}`);
  }
  return result.workspace;
}

export function serializeWorkspaceMarkdown(input: unknown): string {
  const workspace = importWorkspaceJSON(serializeWorkspaceJSON(input));
  const frontMatter = stringifyYAML({ format: "worldforge", version: 1, workspace: canonicalize(workspace) }, { lineWidth: 0, sortMapEntries: true });
  const entities = workspace.entities.map(entity => `- **${entity.title.replace(/[\r\n]/g, " ")}** (${entity.type}; ${entity.id})`).join("\n");
  const titles = new Map(workspace.entities.map(entity => [entity.id, entity.title]));
  const relations = workspace.relations.map(relation => `- ${titles.get(relation.fromId) ?? relation.fromId} --${relation.kind}--> ${titles.get(relation.toId) ?? relation.toId}`).join("\n");
  return `---\n${frontMatter}---\n\n# ${workspace.name.replace(/[\r\n]/g, " ")}\n\n## Entities\n\n${entities || "_Keine Entities_"}\n\n## Relations\n\n${relations || "_Keine Relations_"}\n`;
}

export function importWorkspaceMarkdown(serialized: string): Workspace {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(serialized);
  if (!match) throw new Error("Import fehlgeschlagen: WorldForge-YAML-Frontmatter fehlt.");
  let frontMatter: unknown;
  try {
    frontMatter = parseYAML(match[1]);
  } catch {
    throw new Error("Import fehlgeschlagen: ungueltiges Markdown-Frontmatter.");
  }
  if (!frontMatter || typeof frontMatter !== "object") {
    throw new Error("Import fehlgeschlagen: unbekanntes Markdown-Projektformat.");
  }
  const fields = frontMatter as Record<string, unknown>;
  if (fields.format !== "worldforge" || fields.version !== 1 || !("workspace" in fields)) {
    throw new Error("Import fehlgeschlagen: unbekanntes Markdown-Projektformat.");
  }
  const result = validateWorkspace(fields.workspace);
  if (!result.workspace || result.findings.some(finding => finding.severity === "error")) {
    throw new Error(`Import fehlgeschlagen: ${result.findings.map(finding => finding.message).join("; ")}`);
  }
  return result.workspace;
}

export function serializeWorkspaceZip(input: unknown): Uint8Array {
  const workspace = importWorkspaceJSON(serializeWorkspaceJSON(input));
  const archiveTime = new Date("1980-01-01T00:00:00.000Z");
  const entry = (content: string): [Uint8Array, { mtime: Date; level: 6 }] => [strToU8(content), { mtime: archiveTime, level: 6 }];
  const files = {
    "workspace.json": entry(serializeWorkspaceJSON(workspace)),
    "workspace.yaml": entry(serializeWorkspaceYAML(workspace)),
    "workspace.md": entry(serializeWorkspaceMarkdown(workspace)),
    "reports.json": entry(JSON.stringify(buildWorkspaceReports(workspace), null, 2)),
  };
  return zipSync(files, { level: 6 });
}

export function importWorkspaceZip(bytes: Uint8Array): Workspace {
  let files: ReturnType<typeof unzipSync>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("Import fehlgeschlagen: ZIP-Archiv ist ungueltig.");
  }
  const json = files["workspace.json"];
  if (json) return importWorkspaceJSON(strFromU8(json));
  const yaml = files["workspace.yaml"];
  if (yaml) return importWorkspaceYAML(strFromU8(yaml));
  const markdown = files["workspace.md"];
  if (markdown) return importWorkspaceMarkdown(strFromU8(markdown));
  throw new Error("Import fehlgeschlagen: ZIP enthaelt kein WorldForge-Workspaceformat.");
}

export function importWorkspaceFile(filename: string, bytes: Uint8Array): Workspace {
  const extension = filename.toLowerCase().split(".").at(-1);
  const serialized = strFromU8(bytes);
  if (extension === "json") return importWorkspaceJSON(serialized);
  if (extension === "yaml" || extension === "yml") return importWorkspaceYAML(serialized);
  if (extension === "md" || extension === "markdown") return importWorkspaceMarkdown(serialized);
  if (extension === "zip") return importWorkspaceZip(bytes);
  throw new Error(`Importformat .${extension ?? ""} wird nicht unterstuetzt.`);
}