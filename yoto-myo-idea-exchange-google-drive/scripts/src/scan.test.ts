import { describe, expect, it } from "vitest";
import { mergeParentScan, type ParentScanItem } from "./scan.js";

function item(
  id: string,
  modifiedTime: string,
  mimeType = "application/zip"
): ParentScanItem {
  return {
    id,
    parentId: "parent",
    path: `MYO/Content/${id}.zip`,
    title: `${id}.zip`,
    mimeType,
    size: 1,
    modifiedTime,
    checksum: null
  };
}

describe("capped Drive parent scans", () => {
  it("rejects folder-only windows as proof of a complete all-child scan", () => {
    expect(() =>
      mergeParentScan({
        parentId: "parent",
        responseCap: 100,
        directListingWasCapped: true,
        directItems: [item("recent", "2026-02-01T00:00:00.000Z")],
        requiredScope: "all-children",
        coverageStart: "2025-01-01T00:00:00.000Z",
        coverageEnd: "2027-01-01T00:00:00.000Z",
        windows: [
          {
            start: "2025-01-01T00:00:00.000Z",
            end: "2027-01-01T00:00:00.000Z",
            scope: "folders",
            items: []
          }
        ]
      })
    ).toThrow("all-children");
  });

  it("unions an older ZIP returned by complete all-child windows", () => {
    const result = mergeParentScan({
      parentId: "parent",
      responseCap: 100,
      directListingWasCapped: true,
      directItems: [item("recent", "2026-02-01T00:00:00.000Z")],
      requiredScope: "all-children",
      coverageStart: "2025-01-01T00:00:00.000Z",
      coverageEnd: "2027-01-01T00:00:00.000Z",
      windows: [
        {
          start: "2025-01-01T00:00:00.000Z",
          end: "2026-01-01T00:00:00.000Z",
          scope: "all-children",
          items: [item("old", "2025-12-19T07:39:06.466Z")]
        },
        {
          start: "2026-01-01T00:00:00.000Z",
          end: "2027-01-01T00:00:00.000Z",
          scope: "all-children",
          items: [item("recent", "2026-02-01T00:00:00.000Z")]
        }
      ]
    });

    expect(result.map((entry) => entry.id).sort()).toEqual(["old", "recent"]);
  });
});
