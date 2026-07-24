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

Before each search, incrementally scan known parents. If a child query reaches its cap, split it into non-overlapping modified-time windows until every window is below the cap. Record incomplete windows and do not call the scan complete while any remain. Revalidate the chosen Drive ID, parents, size, modified time, and checksum live before download.

To discard the cache:

```bash
npm run catalogue -- index rebuild --json
```

Drive is authoritative; the local index is disposable. A complete rescan tombstones indexed entries no longer returned.

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
