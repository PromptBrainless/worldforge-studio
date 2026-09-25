import type { Workspace } from "../core/model.ts";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

export function renderWorkspacePreview(workspace: Workspace): string {
  const titles = new Map(workspace.entities.map(entity => [entity.id, entity.title]));
  const entities = workspace.entities.map(entity => {
    const description = entity.data.description ?? entity.data.body ?? entity.data.statement ?? "";
    const aliases = entity.aliases.length ? `<p class="muted">Aliases: ${entity.aliases.map(escapeHtml).join(", ")}</p>` : "";
    const tags = entity.tags.length ? `<p class="muted">Tags: ${entity.tags.map(escapeHtml).join(", ")}</p>` : "";
    return `<article><header><span>${escapeHtml(entity.type)}</span><span>${escapeHtml(entity.canonState)}</span></header><h3>${escapeHtml(entity.title)}</h3><p>${escapeHtml(description)}</p>${aliases}${tags}</article>`;
  }).join("\n");
  const relations = workspace.relations.map(relation => `<li><span>${escapeHtml(titles.get(relation.fromId) ?? relation.fromId)}</span><b>${escapeHtml(relation.kind)} →</b><span>${escapeHtml(titles.get(relation.toId) ?? relation.toId)}</span></li>`).join("\n");
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(workspace.name)}</title>
<style>
:root{color-scheme:light;font-family:Georgia,serif;color:#18251e;background:#f4f6f2}body{margin:0}.page{max-width:1000px;margin:auto;padding:48px 24px}header h1{font-size:36px;margin:8px 0}header p,.muted{color:#586b60;font:13px/1.6 system-ui,sans-serif}.index{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1px;background:#cad4ca;border:1px solid #cad4ca}article{background:#fff;padding:18px}article header{display:flex;justify-content:space-between;color:#52675a;font:11px system-ui,sans-serif;text-transform:uppercase}article h3{font-size:20px;margin:15px 0 8px}article>p{line-height:1.6;overflow-wrap:anywhere}section{margin-top:42px}section h2{font:700 12px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em}ul{list-style:none;padding:0;margin:0;border-top:1px solid #cad4ca}li{display:grid;grid-template-columns:1fr auto 1fr;gap:14px;padding:12px 4px;border-bottom:1px solid #cad4ca;font:13px system-ui,sans-serif}li span:last-child{text-align:right}@media(max-width:520px){.page{padding:28px 16px}header h1{font-size:28px}li{grid-template-columns:1fr;gap:5px}li span:last-child{text-align:left}}
</style>
</head>
<body><main class="page"><header><p>WorldForge Studio · ${workspace.entities.length} Entities · ${workspace.relations.length} Relationen</p><h1>${escapeHtml(workspace.name)}</h1></header><section><h2>Entity-Index</h2><div class="index">${entities || "<p>Keine Entities</p>"}</div></section><section><h2>Relationsgraph</h2><ul>${relations || "<li>Keine Relationen</li>"}</ul></section></main></body>
</html>`;
}