---
name: yoto-myo-idea-exchange-google-drive
description: Read-only search and import from the single Yoto MYO Idea Exchange Google Drive root, using a disposable local SQLite/FTS catalogue and flexible folder/archive layout detection. Use to find a shared MYO playlist and prepare a Yoto playlist package.
---

# Yoto MYO Idea Exchange Google Drive

Search only Drive root `12ueGfirgSd21B7ShXZiATmrZCl3J4OqI`. Never search another Drive location and never modify Drive.

## Setup

```bash
npm ci
npm run build
brew install p7zip
```

SQLite 3 is required. ZIP uses the platform unzip tool; `.7z` requires `7zz` or `7z`.

## Index workflow

Use the connected Google Drive tool read-only. On first use, recursively query children using Drive parent filters and a high result limit. Persist these fields in connector-result JSON: `id`, `parentId`, full `path`, `title`, `mimeType`, `size`, `modifiedTime`, checksum when available, and whether it is a playlist candidate.

Before ingesting, prove every entry’s indexed ancestry reaches the configured root. Reject anything else.

```bash
npm run catalogue -- index refresh --input /tmp/drive-items.json --json
npm run catalogue -- index status --json
npm run catalogue -- search "bluey dance" --json
```

Before each search, incrementally scan known parents. Do not assume the
requested `top_k` is the connector's effective response cap: large folder
listings can be truncated below it without an explicit partial-result flag.
Preserve the previous complete snapshot as a comparison baseline. For any
direct listing at or above 100 entries, supplement it with folder-only parent
queries split into non-overlapping modified-time windows until every window is
below the observed response cap, then union the results by Drive ID. Compare
the new snapshot with the baseline before export and report additions and
removals; never silently discard previous entries. Record incomplete windows
and do not call the scan complete while any remain. Revalidate the chosen
Drive ID, parents, size, modified time, and checksum live before download.

To discard the cache:

```bash
npm run catalogue -- index rebuild --json
```

Drive is authoritative; the local index is disposable. A complete rescan tombstones indexed entries no longer returned.

## Website cache workflow

Use this workflow when the user asks to refresh, rebuild, or update the public
MYO catalogue website. Keep Drive read-only and export only the allowlisted
public catalogue fields.

1. Preserve the previous complete snapshot and catalogue as comparison
   baselines, then recursively refresh root
   `12ueGfirgSd21B7ShXZiATmrZCl3J4OqI` using the connected Drive tool and the
   index rules above. Do not replace the current cache unless the new snapshot
   has no unresolved windows and the baseline comparison has been reviewed.
2. Write the complete connector snapshot to `/tmp/drive-items.json`. Include
   only `id`, `parentId`, `path`, `title`, `mimeType`, `size`, `modifiedTime`,
   and checksum. Include the root folder itself.
3. Treat `.zip` and `.7z` files as opaque albums. Never download or inspect
   their contents.
4. Detect selected covers using the package precedence rules. For archive
   albums, prefer an adjacent image with the same filename stem. Use a folder
   cover for an archive only when exactly one album is present in that folder.
5. Download only selected cover files into `/tmp/drive-covers`, naming each
   file `<DRIVE_ID>.<extension>`. Do not download audio.
6. Export the versioned JSON and normalized WebP thumbnails atomically:

```bash
npm run catalogue -- cache build \
  --input /tmp/drive-items.json \
  --covers /tmp/drive-covers \
  --output ../catalogue-site/public/catalogue \
  --json
```

7. Run both projects' tests, checks, and production build. Report album,
   collection, and cover counts. The generated cache is intended to be
   committed so Vercel can deploy it without Drive credentials.

The export preserves ordered path segments, parent and ancestor relationships,
collection nesting, and visible track names for expanded folders. It excludes
owners, emails, permissions, tokens, and account metadata. A failed export
must leave the previous complete cache unchanged.

## Nested-folder choices

Whenever a search result or selected item is inside a folder, list that folder's direct children before downloading. Identify every playlist candidate among them:

- `.zip` and `.7z` archives
- expanded playlist folders
- subfolders that may contain additional playlist candidates

Tell the user the candidate names, types, and sizes when available. If there is more than one candidate, pause and ask whether to:

1. import only the originally selected item;
2. combine all candidates;
3. choose a subset; or
4. inspect a subfolder.

Do not silently choose the first child or ignore sibling archives/folders. Do not download or package candidates until the user chooses. If the user's request already explicitly names a subset or says to use all items, honor that choice without asking again, but still report every discovered candidate and any excluded non-playlist content.

## Package discovery

Download the selected folder or archive into temporary storage only after live validation. Support expanded folders, `.zip`, and `.7z`. Validate archive entry paths before extraction and enforce 10,000 files and 2 GiB uncompressed limits.

Discover recursively:

- Prefer audio in `audio_files/`, otherwise accept supported audio anywhere, including the playlist root.
- Order leading filename numbers first; otherwise use natural filename order.
- Cover precedence, case-insensitive: `cover_image.*`, `cover.*`, `folder.*`.
- Icon precedence: `Icon 01.png`; numeric images inside `image_files/`; numeric images in the playlist root.
- Normalize leading zeros and exclude the selected cover from icons.
- Reject duplicate track positions and same-precedence icon conflicts.
- Derive missing icons from the cover with deterministic 16×16 center-crop/RGBA conversion. Generate a neutral cover when absent.

Build the portable package:

```bash
npm run catalogue -- package build \
  --input "/tmp/extracted-playlist" \
  --output "/absolute/package-path" \
  --title "Playlist title" \
  --source-id "DRIVE_ID" \
  --ancestry "/tmp/validated-parent-map.json" \
  --source-url "https://drive.google.com/..." \
  --permission "User confirmed permission to copy this package" \
  --json
```

Pass the output directory to `yoto-ai`. Never publish or modify Drive from this skill.
