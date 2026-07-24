# Yoto CLI contracts

## Scopes

The login flow requests only:

- `family:library:view`
- `user:content:view`
- `user:content:manage`
- `user:icons:manage`

The two `manage` scopes support media and card publishing as well as icon
retrieval. The CLI exposes publishing only through a preview-bound,
single-confirmation workflow and exposes no delete commands.

The current dashboard may require enabling `family:library:manage` and
`user:content:manage` at application registration because those entries
automatically include the view and icon scopes.

Do not request `offline_access` unless the dashboard explicitly pre-approves
it. Yoto otherwise rejects the entire authorization with `access_denied`.
Without `offline_access`, store the access token in the OS keychain and ask the
user to sign in again after it expires.

Although Yoto documents `family:devices:view` as public, its authorization
server rejects it for this application because it has not been pre-approved.
Do not request it until Yoto enables it for the client.

## JSON output

Success:

```json
{ "ok": true, "data": {} }
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Description",
    "retryable": false
  }
}
```

Stable error codes are `AUTH_REQUIRED`, `AUTH_FAILED`, `CONFIG_ERROR`,
`VALIDATION_ERROR`, `NETWORK_ERROR`, `API_ERROR`, `NOT_FOUND`,
`UNSUPPORTED_OPERATION`, and `INTERNAL_ERROR`.

## Playlist drafts

Require:

- A title of 1–140 characters.
- At least one chapter and one track per chapter.
- Unique non-empty chapter and track keys supplied by the drafter.
- `audio` or `stream` track types and a documented Yoto media format.
- A `yoto:#...` media reference or HTTPS track URL.
- Non-negative duration and file size.
- `metadata.source.description` and `metadata.source.permission`.

Validation never uploads media, assigns a card ID, or publishes content.

## Publishing payload

- Treat an upload response containing only `uploadId` as pending. Save the ID
  and poll until Yoto returns both `transcodedSha256` and `transcodedInfo`.
- Refer to transcoded audio as `yoto:#<transcodedSha256>`.
- Use the transcode's duration, file size, channels, and format. Map `m4a` to
  the card schema value `x-m4a`.
- Map an icon upload's `displayIcon.mediaId` to
  `display.icon16x16: "yoto:#<mediaId>"`.
- Map a cover upload's `coverImage.mediaUrl` to `metadata.cover.imageL`.
- Attempt the final card mutation exactly once and retain its response body in
  any reported error. Never automatically retry that mutation.
