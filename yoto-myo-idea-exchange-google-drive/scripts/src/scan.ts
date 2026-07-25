export interface ParentScanItem {
  id: string;
  parentId: string;
  path: string;
  title: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string;
  checksum: string | null;
}

export type ParentScanScope = "all-children" | "archives" | "folders";

export interface ParentScanWindow {
  start: string;
  end: string;
  scope: ParentScanScope;
  items: ParentScanItem[];
}

export interface ParentScan {
  parentId: string;
  responseCap: number;
  directListingWasCapped: boolean;
  directItems: ParentScanItem[];
  requiredScope: Exclude<ParentScanScope, "folders">;
  coverageStart: string;
  coverageEnd: string;
  windows: ParentScanWindow[];
}

function validateItem(item: ParentScanItem, parentId: string): void {
  if (item.parentId !== parentId) {
    throw new Error(`Drive item ${item.id} is not a direct child of ${parentId}`);
  }
}

export function mergeParentScan(scan: ParentScan): ParentScanItem[] {
  if (!Number.isInteger(scan.responseCap) || scan.responseCap < 1) {
    throw new Error("responseCap must be a positive integer");
  }
  for (const item of scan.directItems) validateItem(item, scan.parentId);
  if (!scan.directListingWasCapped) {
    return [...new Map(scan.directItems.map((item) => [item.id, item])).values()];
  }
  if (scan.windows.length === 0) {
    throw new Error("A capped Drive listing requires complete modified-time windows");
  }

  const windows = [...scan.windows].sort((a, b) =>
    a.start.localeCompare(b.start)
  );
  let expectedStart = scan.coverageStart;
  const merged = new Map(scan.directItems.map((item) => [item.id, item]));
  for (const window of windows) {
    if (window.scope !== scan.requiredScope) {
      throw new Error(
        `A complete ${scan.requiredScope} scan cannot use ${window.scope} windows`
      );
    }
    if (window.start !== expectedStart || window.end <= window.start) {
      throw new Error("Scan windows must be contiguous and non-overlapping");
    }
    if (window.items.length >= scan.responseCap) {
      throw new Error(
        `Scan window ${window.start}/${window.end} reached the response cap`
      );
    }
    for (const item of window.items) {
      validateItem(item, scan.parentId);
      if (
        item.modifiedTime < window.start ||
        item.modifiedTime >= window.end
      ) {
        throw new Error(
          `Drive item ${item.id} falls outside its modified-time window`
        );
      }
      merged.set(item.id, item);
    }
    expectedStart = window.end;
  }
  if (expectedStart !== scan.coverageEnd) {
    throw new Error("Scan windows do not cover the requested time range");
  }
  return [...merged.values()];
}
