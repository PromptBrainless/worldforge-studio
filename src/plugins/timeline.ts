import { z, type ZodType } from "zod";
import type { WorldForgePlugin } from "../core/plugins";

export const timelinePlugin: WorldForgePlugin = {
  id: "worldforge.timeline",
  version: "1.0.0",
  apiVersion: "1",
  capabilities: ["schemas", "validators", "editors", "migrations"],
  schemas: [
    {
      type: "timeline-event",
      version: 2,
      label: "Timeline-Ereignis",
      schema: z.object({ date: z.string().optional(), endDate: z.string().optional(), description: z.string().optional(), calendar: z.string().optional() }) as unknown as ZodType<Record<string, unknown>>,
    },
  ],
  validators: [
    {
      id: "timeline-event.date",
      types: ["timeline-event"],
      validate: entity => entity.data.date ? [] : [{ severity: "warning", message: "Timeline-Ereignis hat kein Datum.", entityId: entity.id }],
    },
  ],
  editors: [
    { id: "timeline-event.fields", type: "timeline-event", fields: [{ key: "date", label: "Datum", control: "date" }, { key: "endDate", label: "Enddatum", control: "date" }, { key: "description", label: "Beschreibung", control: "textarea" }, { key: "calendar", label: "Kalender", control: "text" }] },
  ],
  migrations: [
    { type: "timeline-event", fromVersion: 1, toVersion: 2, migrate: data => ({ ...data, calendar: data.calendar ?? "unspecified" }) },
  ],
};