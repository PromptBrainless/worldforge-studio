import { z, type ZodType } from "zod";
import type { WorldForgePlugin } from "../core/plugins";

export const assetPlugin: WorldForgePlugin = {
  id: "worldforge.assets",
  version: "1.0.0",
  apiVersion: "1",
  capabilities: ["schemas", "validators", "editors"],
  schemas: [
    {
      type: "binary-asset",
      version: 1,
      label: "Datei-Asset",
      schema: z.object({ uri: z.string().min(1), mediaType: z.string().optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional() }) as unknown as ZodType<Record<string, unknown>>,
    },
  ],
  validators: [
    {
      id: "binary-asset.sha256",
      types: ["binary-asset"],
      validate: entity => entity.data.sha256 && !/^[a-f0-9]{64}$/i.test(String(entity.data.sha256)) ? [{ severity: "error", message: "Asset-SHA-256 ist ungueltig.", entityId: entity.id }] : [],
    },
  ],
  editors: [
    { id: "binary-asset.fields", type: "binary-asset", fields: [{ key: "uri", label: "Datei-URI", control: "url" }, { key: "mediaType", label: "Medientyp", control: "text" }, { key: "sha256", label: "SHA-256", control: "text" }] },
  ],
};