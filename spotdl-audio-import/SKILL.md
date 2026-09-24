---
name: spotdl-audio-import
description: Resolve an authorized Spotify song, album, or playlist to YouTube/YouTube Music matches with spotDL, run saved incremental Spotify-to-Yoto sync profiles, obtain one consolidated confirmation, download MP3 audio, and create a validated Yoto playlist package. Use when a user asks to prepare or sync Spotify-linked audio for Yoto, including a named saved sync such as Kids Favourites.
---

# spotDL Audio Import

Use the bundled CLI as the permission and execution boundary. spotDL downloads matched audio from YouTube/YouTube Music; it does not download audio from Spotify.

## Setup

Run from this skill directory:

```bash
npm ci
npm run build
python3 -m pip install -r requirements.txt
brew install ffmpeg
export SPOTDL_CONFIRMATION_SECRET="$(openssl rand -hex 32)"
```

On non-macOS systems install FFmpeg with the system package manager. Never provide browser cookies, Spotify credentials, a Spotify client secret, or authentication headers to spotDL.

## Workflow

1. When the user names a saved sync, read [references/saved-syncs.md](references/saved-syncs.md), use its exact Spotify source and Yoto card ID, and treat "sync" as append-only missing-song reconciliation. Do not infer mirroring, deletion, or reordering.
2. Confirm the user has permission to copy every item.
3. Resolve the complete Spotify song, album, or playlist before downloading:

```bash
npm run import -- resolve --url "SPOTIFY_URL" --title "Playlist title" \
  --save-file /tmp/batch.spotdl --output /tmp/resolved.json
```

The command uses an isolated empty spotDL config so saved cookies or credentials cannot be inherited. Reject missing, ambiguous, or multiple plausible matches.
4. For a saved sync, inspect the live target with `yoto-ai`, compare the full
   Spotify source against its tracks, and retain only missing songs. Stop if the
   fixed Yoto card cannot be verified; never substitute or create a target by
   title alone.
5. Produce one immutable batch preview:

```bash
npm run import -- preview --input /tmp/resolved.json \
  --destination "/absolute/package/path" \
  --permission "User confirmed permission to copy every listed item" \
  --output /tmp/spotdl-preview.json
```

6. Show the full preview once: every Spotify item, matched source, destination, permission statement, and the resulting Yoto playlist creation or append. Ask exactly one confirmation for the complete batch.
7. Only after the user explicitly confirms, mint the bound token:

```bash
npm run import -- confirm --preview /tmp/spotdl-preview.json
```

8. Use the returned token without editing the preview:

```bash
npm run import -- download --preview /tmp/spotdl-preview.json \
  --confirmation-token TOKEN \
  --download-dir /tmp/spotdl-download \
  --output "/absolute/package/path"
```

If any match changes, regenerate the preview and request one new batch confirmation. Never download before confirmation.
9. After packaging a saved sync, use `yoto-ai` to preview the append to the
   fixed card. Preserve its detected song-playlist layout and require the one
   final Yoto confirmation defined by that skill.

## Artwork and output

Do not transfer Spotify artwork. The CLI creates a deterministic neutral title cover and derives 16×16 RGBA PNG icons by center-cropping it. The result is `playlist-package.json` v1 plus local media. Pass that directory to `yoto-ai` for validation and publishing.

## Guardrails

- Accept only user-authorized copying.
- Bundle albums/playlists into one confirmation, never one prompt per track.
- Do not ask for separate conversational approval before routine setup,
  read-only inspection, metadata resolution, availability checks, or each CLI
  command. Run those steps autonomously. If the execution environment itself
  requires a tool permission prompt, request the narrowest reusable command
  prefix and avoid repeating an equivalent request.
- After the user confirms the immutable batch preview, treat that confirmation
  as authorization for every download and packaging command in that batch; do
  not ask again between commands or tracks.
- Do not silently choose ambiguous matches or continue with missing tracks.
- Do not publish to Yoto; this skill only creates the portable package.
- Preserve stable Spotify source IDs for duplicate detection.
