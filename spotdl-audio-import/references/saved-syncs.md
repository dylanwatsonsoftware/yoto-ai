# Saved sync profiles

## Kids Favourites

- Recognize requests such as “sync Kids Favourites” as this profile.
- Spotify source: `https://open.spotify.com/playlist/5MAJOouCFVudM9ddVLTm1m`
- Spotify playlist ID: `5MAJOouCFVudM9ddVLTm1m`
- Yoto target title: `Kids Favourites`
- Yoto card ID: `e0q2m`
- Sync mode: append only songs missing from the live Yoto card. Preserve all
  existing songs, ordering, artwork, and metadata; never delete or reorder to
  mirror Spotify unless the user explicitly requests a separately supported
  operation.
- Layout: this is a song playlist. Append each missing song as one single-track
  Yoto chapter, continuing the existing order and navigation labels.
- Safety: verify the fixed card ID and source playlist on every run. Do not
  substitute another card or create a new card if either endpoint is missing.
- Confirmations: retain the normal consolidated download-batch confirmation
  and the final immutable Yoto append confirmation. The saved profile does not
  authorize future downloads or writes by itself.
