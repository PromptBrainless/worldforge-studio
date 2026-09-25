import { z, type ZodType } from "zod";
import { EntityTypeSchema, type Entity, type ValidationFinding, type Workspace } from "./model.ts";
export type SchemaRegistration = { type:string; version:number; schema:ZodType<Record<string,unknown>>; label:string };
export type PluginCapability = "schemas" | "validators" | "editors" | "exporters" | "migrations";
export type ValidatorRegistration = { id:string; types?:string[]; validate:(entity:Entity)=>ValidationFinding[] };
export type EditorFieldRegistration = { key:string; label:string; control:"text"|"textarea"|"date"|"url" };
export type EditorRegistration = { id:string; type:string; fields:EditorFieldRegistration[] };
export type ExporterRegistration = { format:string; export:(workspace:Workspace)=>string|Uint8Array };
export type MigrationRegistration = { type:string; fromVersion:number; toVersion:number; migrate:(data:Record<string,unknown>)=>Record<string,unknown> };
export type WorldForgePlugin = { id:string; version:string; apiVersion:"1"; capabilities?:PluginCapability[]; schemas:SchemaRegistration[]; validators?:ValidatorRegistration[]; editors?:EditorRegistration[]; exporters?:ExporterRegistration[]; migrations?:MigrationRegistration[]; validate?:(entity:Entity)=>ValidationFinding[] };

const allCapabilities:PluginCapability[]=["schemas","validators","editors","exporters","migrations"];
const idPattern=/^[a-z0-9][a-z0-9._-]*$/;
const semverPattern=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export class PluginRegistry {
  private readonly plugins=new Map<string,WorldForgePlugin>();
  private readonly schemas=new Map<string,SchemaRegistration>();

  register(plugin:WorldForgePlugin) {
    if(plugin.apiVersion!=="1")throw new Error("Nicht unterstuetzte Plugin-API");
    if(!idPattern.test(plugin.id)||!semverPattern.test(plugin.version))throw new Error("Ungueltige Plugin-ID oder Version");
    if(this.plugins.has(plugin.id))throw new Error(`Plugin ${plugin.id} ist bereits registriert`);
    const inferred:PluginCapability[]=["schemas"];
    if(plugin.validate||plugin.validators?.length)inferred.push("validators");
    if(plugin.editors?.length)inferred.push("editors");
    if(plugin.exporters?.length)inferred.push("exporters");
    if(plugin.migrations?.length)inferred.push("migrations");
    const capabilities=new Set(plugin.capabilities??inferred);
    for(const capability of capabilities)if(!allCapabilities.includes(capability))throw new Error(`Unbekannte Plugin-Capability ${capability}`);
    const requireCapability=(capability:PluginCapability,present:boolean)=>{if(present&&!capabilities.has(capability))throw new Error(`Plugin ${plugin.id} deklariert die Capability ${capability} nicht`);};
    requireCapability("schemas",plugin.schemas.length>0);
    requireCapability("validators",Boolean(plugin.validate||plugin.validators?.length));
    requireCapability("editors",Boolean(plugin.editors?.length));
    requireCapability("exporters",Boolean(plugin.exporters?.length));
    requireCapability("migrations",Boolean(plugin.migrations?.length));

    const localTypes=new Set<string>();
    for(const schema of plugin.schemas){
      if(!EntityTypeSchema.safeParse(schema.type).success||schema.version<1||!schema.label.trim())throw new Error(`Ungueltiges Schema in Plugin ${plugin.id}`);
      if(localTypes.has(schema.type)||this.schemas.has(schema.type))throw new Error(`Schema-Typ ${schema.type} ist bereits registriert`);
      localTypes.add(schema.type);
    }
    for(const editor of plugin.editors??[]){
      if(!localTypes.has(editor.type)&&!this.schemas.has(editor.type))throw new Error(`Editor ${editor.id} verweist auf unbekannten Typ ${editor.type}`);
      if(!editor.id||editor.fields.some(field=>!field.key||!field.label||!["text","textarea","date","url"].includes(field.control)))throw new Error(`Ungueltige Editorfelder in ${editor.id}`);
    }
    const migrationKeys=new Set<string>();
    for(const migration of plugin.migrations??[]){
      const key=`${migration.type}:${migration.fromVersion}`;
      const schema=plugin.schemas.find(item=>item.type===migration.type)??this.schemas.get(migration.type);
      if(!schema)throw new Error(`Migration verweist auf unbekannten Typ ${migration.type}`);
      if(!Number.isInteger(migration.fromVersion)||!Number.isInteger(migration.toVersion)||migration.fromVersion<1||migration.toVersion<=migration.fromVersion||migrationKeys.has(key))throw new Error(`Ungueltiger oder doppelter Migrationsschritt ${key}`);
      if(migration.toVersion>schema.version)throw new Error(`Migration ${key} ueberschreitet Schema v${schema.version}`);
      migrationKeys.add(key);
    }

    this.plugins.set(plugin.id,plugin);
    for(const schema of plugin.schemas)this.schemas.set(schema.type,schema);
  }

  schemaFor(type:string) { return this.schemas.get(type); }
  registeredSchemas() { return [...this.schemas.values()]; }
  registeredPlugins() { return [...this.plugins.values()]; }
  editorsFor(type:string) { return [...this.plugins.values()].flatMap(plugin=>plugin.editors??[]).filter(editor=>editor.type===type); }
  exporterFor(format:string) { return [...this.plugins.values()].flatMap(plugin=>plugin.exporters??[]).find(exporter=>exporter.format===format); }
  validateEntity(entity:Entity) { return [...this.plugins.values()].flatMap(plugin=>[...(plugin.validate?.(entity)??[]),...(plugin.validators??[]).filter(validator=>!validator.types||validator.types.includes(entity.type)).flatMap(validator=>validator.validate(entity))]); }

  migrate(type:string,data:Record<string,unknown>,fromVersion:number,toVersion:number) {
    if(toVersion<fromVersion)throw new Error("Rueckwaertsmigrationen werden nicht automatisch ausgefuehrt");
    let version=fromVersion;
    let migrated=data;
    while(version<toVersion){
      const migration=[...this.plugins.values()].flatMap(plugin=>plugin.migrations??[]).find(item=>item.type===type&&item.fromVersion===version&&item.toVersion<=toVersion);
      if(!migration)throw new Error(`Keine Migration fuer ${type} v${version} gefunden`);
      migrated=migration.migrate(structuredClone(migrated));
      version=migration.toVersion;
    }
    return migrated;
  }
}

const registry = new PluginRegistry();
export function registerPlugin(plugin:WorldForgePlugin) { registry.register(plugin); }
export function schemaFor(type:string) { return registry.schemaFor(type); }
export function registeredSchemas() { return registry.registeredSchemas(); }
export function registeredPlugins() { return registry.registeredPlugins(); }
export function editorsFor(type:string) { return registry.editorsFor(type); }
export function exporterFor(format:string) { return registry.exporterFor(format); }
export function validateWithPlugins(entity:Entity) { return registry.validateEntity(entity); }
export function migrateSchemaData(type:string,data:Record<string,unknown>,fromVersion:number,toVersion:number) { return registry.migrate(type,data,fromVersion,toVersion); }
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
