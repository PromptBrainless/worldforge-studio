import { z, type ZodType } from "zod";
import type { Entity, ValidationFinding } from "./model";
export type SchemaRegistration = { type:string; version:number; schema:ZodType<Record<string,unknown>>; label:string };
export type WorldForgePlugin = { id:string; version:string; apiVersion:"1"; schemas:SchemaRegistration[]; validate?:(entity:Entity)=>ValidationFinding[] };
const registry = new Map<string, SchemaRegistration>();
export function registerPlugin(plugin:WorldForgePlugin) { if (plugin.apiVersion!=="1") throw new Error("Nicht unterstuetzte Plugin-API"); for (const schema of plugin.schemas) registry.set(schema.type,schema); }
export function schemaFor(type:string) { return registry.get(type); }
export function registeredSchemas() { return [...registry.values()]; }
registerPlugin({ id:"worldforge.core", version:"1.0.0", apiVersion:"1", schemas:[
  {type:"world",version:1,label:"Welt",schema:z.object({description:z.string().optional()}) as unknown as ZodType<Record<string,unknown>>},
  {type:"region",version:1,label:"Region",schema:z.object({description:z.string().optional()}) as unknown as ZodType<Record<string,unknown>>},
  {type:"location",version:1,label:"Ort",schema:z.object({description:z.string().optional()}) as unknown as ZodType<Record<string,unknown>>},
  {type:"character",version:1,label:"Figur",schema:z.object({role:z.string().optional(),goals:z.string().optional()}) as unknown as ZodType<Record<string,unknown>>},
  {type:"faction",version:1,label:"Fraktion",schema:z.object({purpose:z.string().optional()}) as unknown as ZodType<Record<string,unknown>>},
  {type:"campaign",version:1,label:"Kampagne",schema:z.object({summary:z.string().optional()}) as unknown as ZodType<Record<string,unknown>>},
  {type:"quest",version:1,label:"Quest",schema:z.object({objectives:z.string().optional()}) as unknown as ZodType<Record<string,unknown>>},
  {type:"dialogue",version:1,label:"Dialog",schema:z.object({nodes:z.string().optional()}) as unknown as ZodType<Record<string,unknown>>},
  {type:"event",version:1,label:"Ereignis",schema:z.object({trigger:z.string().optional(),actions:z.string().optional()}) as unknown as ZodType<Record<string,unknown>>},
  {type:"knowledge",version:1,label:"Wissen",schema:z.object({body:z.string().optional(),references:z.string().optional()}) as unknown as ZodType<Record<string,unknown>>},
  {type:"rule-set",version:1,label:"Regelwerk",schema:z.object({rules:z.string().optional()}) as unknown as ZodType<Record<string,unknown>>},
  {type:"asset",version:1,label:"Asset",schema:z.object({uri:z.string().optional(),mediaType:z.string().optional()}) as unknown as ZodType<Record<string,unknown>>},
]});
