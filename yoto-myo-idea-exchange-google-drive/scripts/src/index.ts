import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

export interface CatalogueItem {
  id: string;
  parentId: string;
  path: string;
  title: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string;
  checksum: string | null;
  candidate: boolean;
}

function sqlValue(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function runSql(database: string, sql: string, json = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [...(json ? ["-json"] : []), database, sql];
    const child = spawn("sqlite3", args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `sqlite3 exited ${code}`));
    });
  });
}

export class CatalogueIndex {
  constructor(private readonly database: string) {}

  async initialize(): Promise<void> {
    await mkdir(dirname(this.database), { recursive: true, mode: 0o700 });
    await runSql(
      this.database,
      `PRAGMA journal_mode=WAL;
       CREATE TABLE IF NOT EXISTS items (
         id TEXT PRIMARY KEY,
         parent_id TEXT NOT NULL,
         path TEXT NOT NULL,
         title TEXT NOT NULL,
         mime_type TEXT NOT NULL,
         size INTEGER,
         modified_time TEXT NOT NULL,
         checksum TEXT,
         candidate INTEGER NOT NULL,
         tombstoned INTEGER NOT NULL DEFAULT 0
       );
       CREATE VIRTUAL TABLE IF NOT EXISTS item_search USING fts5(id UNINDEXED, title, path);
       CREATE TABLE IF NOT EXISTS scan_state (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL
       );`
    );
  }

  async status(): Promise<{
    items: number;
    candidates: number;
    tombstoned: number;
    lastCompleteScan: string | null;
    incompleteWindows: string[];
  }> {
    const output = await runSql(
      this.database,
      `SELECT
         COUNT(*) AS items,
         COALESCE(SUM(CASE WHEN candidate=1 AND tombstoned=0 THEN 1 ELSE 0 END),0) AS candidates,
         COALESCE(SUM(tombstoned),0) AS tombstoned,
         (SELECT value FROM scan_state WHERE key='last_complete_scan') AS lastCompleteScan,
         (SELECT value FROM scan_state WHERE key='incomplete_windows') AS incompleteWindows
       FROM items;`,
      true
    );
    const row = JSON.parse(output)[0] as Record<string, unknown>;
    return {
      items: Number(row.items),
      candidates: Number(row.candidates),
      tombstoned: Number(row.tombstoned),
      lastCompleteScan:
        typeof row.lastCompleteScan === "string" ? row.lastCompleteScan : null,
      incompleteWindows:
        typeof row.incompleteWindows === "string"
          ? (JSON.parse(row.incompleteWindows) as string[])
          : []
    };
  }

  async rebuild(): Promise<void> {
    await runSql(
      this.database,
      `BEGIN IMMEDIATE;
       DELETE FROM item_search;
       DELETE FROM items;
       DELETE FROM scan_state;
       COMMIT;
       VACUUM;`
    );
  }

  async upsert(items: CatalogueItem[]): Promise<void> {
    if (items.length === 0) return;
    const statements = items.flatMap((item) => [
      `INSERT INTO items
       (id,parent_id,path,title,mime_type,size,modified_time,checksum,candidate,tombstoned)
       VALUES (${[
         item.id,
         item.parentId,
         item.path,
         item.title,
         item.mimeType,
         item.size,
         item.modifiedTime,
         item.checksum,
         item.candidate ? 1 : 0,
         0
       ]
         .map(sqlValue)
         .join(",")})
       ON CONFLICT(id) DO UPDATE SET
         parent_id=excluded.parent_id,path=excluded.path,title=excluded.title,
         mime_type=excluded.mime_type,size=excluded.size,
         modified_time=excluded.modified_time,checksum=excluded.checksum,
         candidate=excluded.candidate,tombstoned=0;`,
      `DELETE FROM item_search WHERE id=${sqlValue(item.id)};`,
      `INSERT INTO item_search(id,title,path) VALUES
       (${sqlValue(item.id)},${sqlValue(item.title)},${sqlValue(item.path)});`
    ]);
    await runSql(
      this.database,
      `BEGIN IMMEDIATE;${statements.join("")}COMMIT;`
    );
  }

  async tombstoneMissing(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const values = ids.map(sqlValue).join(",");
    await runSql(
      this.database,
      `BEGIN IMMEDIATE;
       UPDATE items SET tombstoned=1 WHERE id IN (${values});
       DELETE FROM item_search WHERE id IN (${values});
       COMMIT;`
    );
  }

  async completeScan(seenIds: string[], completedAt = new Date().toISOString()): Promise<void> {
    const keep = seenIds.length
      ? `id NOT IN (${seenIds.map(sqlValue).join(",")})`
      : "1=1";
    await runSql(
      this.database,
      `BEGIN IMMEDIATE;
       UPDATE items SET tombstoned=1 WHERE ${keep};
       DELETE FROM item_search WHERE id IN (SELECT id FROM items WHERE tombstoned=1);
       INSERT INTO scan_state(key,value) VALUES
         ('last_complete_scan',${sqlValue(completedAt)}),
         ('incomplete_windows','[]')
       ON CONFLICT(key) DO UPDATE SET value=excluded.value;
       COMMIT;`
    );
  }

  async setIncompleteWindows(windows: string[]): Promise<void> {
    await runSql(
      this.database,
      `INSERT INTO scan_state(key,value)
       VALUES ('incomplete_windows',${sqlValue(JSON.stringify(windows))})
       ON CONFLICT(key) DO UPDATE SET value=excluded.value;`
    );
  }

  async search(query: string): Promise<CatalogueItem[]> {
    const terms = query
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term.replaceAll('"', '""')}"*`)
      .join(" ");
    if (!terms) return [];
    const output = await runSql(
      this.database,
      `SELECT i.id,i.parent_id AS parentId,i.path,i.title,
              i.mime_type AS mimeType,i.size,i.modified_time AS modifiedTime,
              i.checksum,i.candidate
       FROM item_search s JOIN items i ON i.id=s.id
       WHERE item_search MATCH ${sqlValue(terms)}
         AND i.tombstoned=0 AND i.candidate=1
       ORDER BY bm25(item_search), i.title LIMIT 50;`,
      true
    );
    if (!output.trim()) return [];
    return (JSON.parse(output) as Array<Record<string, unknown>>).map(
      (item) =>
        ({
          ...item,
          candidate: Boolean(item.candidate)
        }) as unknown as CatalogueItem
    );
  }
}
