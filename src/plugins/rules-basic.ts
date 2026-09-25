import { z, type ZodType } from "zod";
import type { WorldForgePlugin } from "../core/plugins";

export const rulesBasicPlugin: WorldForgePlugin = {
  id: "worldforge.rules-basic",
  version: "1.0.0",
  apiVersion: "1",
  capabilities: ["schemas", "validators", "editors", "exporters"],
  schemas: [
    {
      type: "basic-rule",
      version: 1,
      label: "Grundregel",
      schema: z.object({ statement: z.string().min(1), rationale: z.string().optional() }) as unknown as ZodType<Record<string, unknown>>,
    },
  ],
  validators: [
    {
      id: "basic-rule.statement",
      types: ["basic-rule"],
      validate: entity => entity.data.statement ? [] : [{ severity: "error", message: "Regelaussage fehlt.", entityId: entity.id }],
    },
  ],
  editors: [
    { id: "basic-rule.fields", type: "basic-rule", fields: [{ key: "statement", label: "Regelaussage", control: "textarea" }, { key: "rationale", label: "Begruendung", control: "textarea" }] },
  ],
  exporters: [
    { format: "basic-rules-json", export: workspace => JSON.stringify(workspace.entities.filter(entity => entity.type === "basic-rule")) },
  ],
};