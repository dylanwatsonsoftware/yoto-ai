import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CatalogueIndex } from "./index.js";

describe("catalogue SQLite index", () => {
  it("searches indexed playlist candidates and tombstones missing entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "idea-index-"));
    const index = new CatalogueIndex(join(root, "index.sqlite"));
    await index.initialize();
    await index.upsert([
      {
        id: "one",
        parentId: "root",
        path: "Content/Bluey Dance Mode.zip",
        title: "Bluey Dance Mode.zip",
        mimeType: "application/zip",
        size: 100,
        modifiedTime: "2026-01-01T00:00:00Z",
        checksum: "abc",
        candidate: true
      }
    ]);

    await expect(index.search("bluey")).resolves.toMatchObject([
      { id: "one", title: "Bluey Dance Mode.zip" }
    ]);

    await index.tombstoneMissing(["one"]);
    await expect(index.search("bluey")).resolves.toEqual([]);
  });

  it("reports status and rebuilds the disposable cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "idea-index-"));
    const index = new CatalogueIndex(join(root, "index.sqlite"));
    await index.initialize();

    await expect(index.status()).resolves.toMatchObject({ items: 0 });
    await index.rebuild();
    await expect(index.status()).resolves.toMatchObject({ items: 0 });
  });

  it("records incomplete windows and tombstones omissions after a complete scan", async () => {
    const root = await mkdtemp(join(tmpdir(), "idea-index-"));
    const index = new CatalogueIndex(join(root, "index.sqlite"));
    await index.initialize();
    await index.upsert([
      {
        id: "missing", parentId: "root", path: "Missing.zip",
        title: "Missing.zip", mimeType: "application/zip", size: 1,
        modifiedTime: "2026-01-01T00:00:00Z", checksum: null, candidate: true
      }
    ]);
    await index.setIncompleteWindows(["2025-01/2025-02"]);
    await expect(index.status()).resolves.toMatchObject({
      incompleteWindows: ["2025-01/2025-02"]
    });
    await index.completeScan([], "2026-07-24T00:00:00Z");
    await expect(index.search("missing")).resolves.toEqual([]);
    await expect(index.status()).resolves.toMatchObject({
      lastCompleteScan: "2026-07-24T00:00:00Z",
      incompleteWindows: []
    });
  });
});
