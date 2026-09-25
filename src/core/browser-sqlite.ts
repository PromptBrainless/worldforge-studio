import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { SqliteWorkspaceStore } from "./sqlite-store";

const DATABASE_KEY = "worldforge.sqlite.v1";

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export async function openBrowserSqliteStore(storage: Storage = localStorage): Promise<SqliteWorkspaceStore> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = storage.getItem(DATABASE_KEY);
  const database = new SQL.Database(saved ? decodeBase64(saved) : undefined);
  return new SqliteWorkspaceStore(database, bytes => storage.setItem(DATABASE_KEY, encodeBase64(bytes)));
}

export async function readWorkspaceFromSqliteFile(bytes: Uint8Array) {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const store = new SqliteWorkspaceStore(new SQL.Database(bytes));
  try {
    return store.load();
  } finally {
    store.close();
  }
}