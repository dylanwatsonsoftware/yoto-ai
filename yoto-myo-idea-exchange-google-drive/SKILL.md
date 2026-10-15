---
name: yoto-myo-idea-exchange-google-drive
description: Read-only exact-ID import and catalogue search from the single Yoto MYO Idea Exchange Google Drive root, using minimal ancestry validation for explicit selections and exhaustive scans only for discovery or cache refreshes. Use to find or import a shared MYO playlist and prepare a Yoto playlist package.
---

# Yoto MYO Idea Exchange Google Drive

Search only Drive root `12ueGfirgSd21B7ShXZiATmrZCl3J4OqI`. Never search another Drive location and never modify Drive.

## Runtime capabilities

This skill provides local catalogue/package commands, not Google Drive access.
Before importing, verify that the active agent has a supported authenticated
Drive integration for exact-ID metadata (including parents), child listings,
and binary downloads. Pi's built-in `read` reads local files; passing it a Drive
URL will fail. Generic web search/fetch does not provide the required Drive
metadata or downloads. If Drive access is missing, report that capability gap
once and continue only independent local/Yoto preparation. Do not invent a
connector or substitute public HTML scraping.

Read this file before executing its workflow. In Pi, load it with
`/skill:yoto-myo-idea-exchange-google-drive`; `$skill-name` is not Pi's explicit
skill-loading command. Check bundled CLI source when syntax is uncertain:
there is no `index find` command and no catalogue command that fetches Drive.

## Authorization and workflow selection

Treat an explicit request to use this skill as authorization for its routine
read-only Drive calls, listed local setup commands, temporary downloads,
extraction, and package creation. Do not ask for separate conversational
permission for those steps. If the execution environment itself requires an
approval, request the narrowest reusable approval once and do not repeat an
equivalent request. Batch independent Drive reads to reduce tool prompts.

Choose the narrowest workflow that satisfies the request:

- **Exact selection:** The user supplies exact Drive IDs/URLs, full paths, or
  otherwise unambiguously selects named items. Use the exact-selection
  workflow below. Do not refresh or search the catalogue.
- **Discovery:** The user asks to find, browse, or choose content without exact
  Drive IDs. Use the index and search workflow.
- **Website cache:** The user asks to refresh, rebuild, or publish the public
  catalogue. Use the website cache workflow.

## Setup

Check first and install or rebuild only what is missing:

```bash
npm ci
npm run build
brew install p7zip
brew install ffmpeg
```

SQLite 3 and `ffprobe` are required. ZIP uses the platform unzip tool; `.7z`
requires `7zz` or `7z`. Run the built `dist/cli.js` with Node 22 when `tsx`
cannot create its local IPC socket.

Do not run catalogue CLI extraction or package commands concurrently. They
share local SQLite initialization state and concurrent processes can fail with
`database is locked`. Keep those commands sequential; only independent Drive
downloads may use bounded concurrency.

## Exact-selection workflow

For every explicitly selected item:

1. Fetch live metadata for the selected Drive ID: ID, title, MIME type, size,
   modified time, checksum when available, and direct parent IDs.
2. Follow only its parent chain until reaching the configured root. Cache
   parent metadata by Drive ID and share it across all selections so common
   branches are fetched once. Reject an item if every available chain ends
   before the configured root. Do not recursively scan the root or unrelated
   branches merely to prove ancestry.
3. Revalidate the selected ID and metadata immediately before download.
4. List the selected item's immediate parent once for sibling reporting. If
   the result is capped or contains at least 100 entries, report the returned
   candidates as a capped, incomplete sibling listing. Do not run modified-time
   windows solely to complete sibling reporting for an already exact selection.
5. When the user explicitly selected a subset, proceed with only that subset,
   report visible siblings and excluded non-playlist content, and do not pause
   to ask the user to select again.
6. For an expanded selected folder, recursively enumerate only that folder's
   descendants. Completeness is required inside the selected folder because
   those files form the package; use the capped-listing window rules there if
   necessary.

Do not create or refresh the SQLite catalogue for an exact-selection import.

## Index and discovery workflow

Use the connected Google Drive tool read-only. On first use, recursively query children using Drive parent filters and a high result limit. Persist these fields in connector-result JSON: `id`, `parentId`, full `path`, `title`, `mimeType`, `size`, `modifiedTime`, checksum when available, and whether it is a playlist candidate.

Before ingesting, prove every entry’s indexed ancestry reaches the configured root. Reject anything else. These exhaustive rules apply to discovery, index refreshes, and website-cache work—not to immediate-parent sibling reporting for an exact selection.

```bash
npm run catalogue -- index refresh --input /tmp/drive-items.json --json
npm run catalogue -- index status --json
npm run catalogue -- search "bluey dance" --json
```

Before each search, incrementally scan known parents. Do not assume the
requested `top_k` is the connector's effective response cap: large folder
listings can be truncated below it without an explicit partial-result flag.
Preserve the previous complete snapshot as a comparison baseline. For any
direct listing at or above 100 entries, supplement it with parent-scoped
queries for **all child types**, split into contiguous, non-overlapping
modified-time windows until every window is below the observed response cap.
Folder-only windows are never proof of a complete parent scan because they
omit direct archives and other files. Union results by Drive ID and compare ID
sets, not only counts. If the connector cannot return every child type for a
window, record it as incomplete and do not replace the snapshot or public
cache. Preserve baseline entries while incomplete, but never treat the
baseline as proof that no older files are missing.

Save capped parent results as a scan manifest and validate the window coverage
before merging:

```bash
npm run catalogue -- scan merge \
  --input /tmp/parent-scan.json \
  --output /tmp/parent-items.json \
  --json
```

Use `requiredScope: "all-children"` for a complete refresh. A deliberately
targeted archive-only repair may use `requiredScope: "archives"`, but its
result must not mark the parent or overall snapshot complete. Revalidate the
chosen Drive ID, parents, size, modified time, and checksum live before
download.

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
4. Detect selected covers using the package precedence rules. For expanded
   albums, search all descendants recursively for `cover_image.*`, `cover.*`,
   then `folder.*`; if none exists, use a fallback only when the album has
   exactly one descendant image. Never guess between multiple fallback images.
   For archive albums, prefer an adjacent image with the same filename stem.
   Use a folder cover for an archive only when exactly one album is present in
   that folder. Keep archives opaque and report when no external cover exists.
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

Whenever a discovered search result is inside a folder, list that folder's
direct children before downloading. For an exact selection, use the single
immediate-parent listing defined above. Identify visible playlist candidates:

- `.zip` and `.7z` archives
- expanded playlist folders
- subfolders that may contain additional playlist candidates

Tell the user the candidate names, types, and sizes when available. For a
discovery request with more than one candidate, pause and ask whether to:

1. import only the originally selected item;
2. combine all candidates;
3. choose a subset; or
4. inspect a subfolder.

Do not silently choose the first child or ignore sibling archives/folders in a
discovery request. Do not download or package discovery candidates until the
user chooses. If the request already explicitly names a subset or says to use
all items, honor that choice without asking again, report the candidates
returned by the single parent listing and any excluded non-playlist content,
then continue.

For a large discovery folder, write the complete candidate listing to a local
report and summarize it. If the connector reaches its response cap, use the
index workflow's non-overlapping modified-time windows before calling the
discovery scan complete. For an exact selection, do not claim completeness or
write a "complete" report from capped results; state the cap and continue with
the selected item.

## Package discovery

Download the selected folder or archive into temporary storage only after live validation. Support expanded folders, `.zip`, and `.7z`. Validate archive entry paths before extraction and enforce 10,000 files and 2 GiB uncompressed limits.

Discover recursively:

- Prefer audio in `audio_files/`, otherwise accept supported audio anywhere, including the playlist root.
- Order leading filename numbers first; otherwise use natural filename order.
- Cover precedence, case-insensitive: exact `cover_image.*`, `cover.*`,
  `folder.*`, then descriptive image names ending in `cover` or `cover image`.
- Icon precedence: `Icon 01.png`; numeric images inside `image_files/`; numeric images in the playlist root.
- Normalize leading zeros and exclude the selected cover from icons.
- Reject duplicate track positions and same-precedence icon conflicts.
- Derive missing icons from the cover with deterministic 16×16 center-crop/RGBA conversion. Generate a neutral cover when absent.

Before using a generated fallback, inspect the selected playlist recursively
for supplied artwork and inspect audio metadata for embedded artwork. Record
every generated fallback in the consolidated preview. If generation is still
needed, generate at most one image per playlist and reuse that image for the
cover and all derived track icons; never generate one image per track.

When combining multiple seasons into one Yoto playlist, preserve each season
as a separate ordered package so `yoto-ai` can append each package as its own
chapter. Do not flatten season-local numbering into one undifferentiated
chapter. Skip this extra split only when the source already contains an
unambiguous chapter structure that preserves the season boundaries.

When multiple selected sibling archives or folders each resolve to one audio
track and each item is a standalone story, episode, or song, preserve their
user-selected order in one package and pass it to `yoto-ai` with
`playlist preview-create --single-track-chapters`. Do not flatten those items
into one multi-track chapter. Keep the normal grouped layout when the files are
parts of one continuous story or album; decide from source structure and the
user's selection, not merely from the number of tracks.

Treat an obvious letter/number filename typo such as `1o.` for `10.` as a
duplicate-position error first. Keep Drive unchanged. When the user's exact
selection is already clear, normalize only the temporary local filename,
record the original and normalized names in the consolidated preview, and
otherwise ask before continuing.

Do not treat a leading numeric quantity as a track position merely because it
starts a filename. For example, `4,000 Mouse Trap...` is a title, not track 4.
When an incidental leading number collides with natural ordering, keep the
source unchanged, add a nonnumeric prefix only to the temporary staging name,
preserve its natural sort position, restore the original displayed title in
the package manifest, and record the normalization in the consolidated
preview.

Connected Drive downloads may return short-lived signed attachment URLs.
Consume them immediately without printing them, placing them in prompts, or
persisting them. Use bounded concurrency, preserve relative filenames, and
verify downloaded byte sizes against live Drive metadata before packaging.

If the connector rejects a selected file because of a documented download-size
limit, do not repeat the same fetch or attempt unsupported browser-download
workarounds. Use a supported authenticated download surface when one is
already available; otherwise report the exact affected item and expected size,
prepare everything else that can safely proceed, and ask the user to place only
that file in a specified local directory.

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

## Post-run improvement

After each run, review concrete friction, unnecessary work, repeated manual
steps, and recoverable failures. If the run reveals a durable improvement,
update this skill or its bundled scripts after the active operation is safely
finished, then validate the skill and any changed behavior. Keep revisions
small, evidence-based, and reusable; do not record secrets, account data,
user-specific content, temporary paths, or one-off service failures. Do not
change instructions or executable code in the middle of a confirmed publish
batch. If no reusable improvement is warranted, leave the skill unchanged.
Briefly report any post-run skill changes to the user.
