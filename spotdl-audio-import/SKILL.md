---
name: spotdl-audio-import
description: Resolve an authorized Spotify song, album, or playlist to YouTube/YouTube Music matches with spotDL, obtain one consolidated confirmation, download MP3 audio, and create a validated Yoto playlist package. Use when a user asks to prepare Spotify-linked audio for Yoto.
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

1. Confirm the user has permission to copy every item.
2. Resolve the complete Spotify song, album, or playlist before downloading:

```bash
npm run import -- resolve --url "SPOTIFY_URL" --title "Playlist title" \
  --save-file /tmp/batch.spotdl --output /tmp/resolved.json
```

The command uses an isolated empty spotDL config so saved cookies or credentials cannot be inherited. Reject missing, ambiguous, or multiple plausible matches.
3. Produce one immutable batch preview:

```bash
npm run import -- preview --input /tmp/resolved.json \
  --destination "/absolute/package/path" \
  --permission "User confirmed permission to copy every listed item" \
  --output /tmp/spotdl-preview.json
```

4. Show the full preview once: every Spotify item, matched source, destination, permission statement, and the resulting Yoto playlist creation. Ask exactly one confirmation for the complete batch.
5. Only after the user explicitly confirms, mint the bound token:

```bash
npm run import -- confirm --preview /tmp/spotdl-preview.json
```

6. Use the returned token without editing the preview:

```bash
npm run import -- download --preview /tmp/spotdl-preview.json \
  --confirmation-token TOKEN \
  --download-dir /tmp/spotdl-download \
  --output "/absolute/package/path"
```

If any match changes, regenerate the preview and request one new batch confirmation. Never download before confirmation.

## Artwork and output

Do not transfer Spotify artwork. The CLI creates a deterministic neutral title cover and derives 16×16 RGBA PNG icons by center-cropping it. The result is `playlist-package.json` v1 plus local media. Pass that directory to `yoto-ai` for validation and publishing.

## Guardrails

- Accept only user-authorized copying.
- Bundle albums/playlists into one confirmation, never one prompt per track.
- Do not silently choose ambiguous matches or continue with missing tracks.
- Do not publish to Yoto; this skill only creates the portable package.
- Preserve stable Spotify source IDs for duplicate detection.
