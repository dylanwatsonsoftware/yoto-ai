import { z } from "zod";

const displaySchema = z
  .object({
    icon16x16: z.string().regex(/^yoto:#[A-Za-z0-9_-]{43}$/).optional(),
    iconUrl16x16: z.string().url().startsWith("https://").optional()
  })
  .passthrough();

const trackUrlSchema = z.string().refine(
  (value) => value.startsWith("yoto:#") || value.startsWith("https://"),
  "Track URL must use yoto:# media or HTTPS"
);

const trackSchema = z.object({
  key: z.string().min(1),
  uid: z.string().min(1),
  title: z.string().min(1),
  trackUrl: trackUrlSchema,
  format: z.enum([
    "mp3",
    "aac",
    "alac",
    "flac",
    "pcm_s16le",
    "opus",
    "ogg",
    "x-m4a",
    "wav",
    "aiff",
    "mpeg",
    ""
  ]),
  type: z.enum(["audio", "stream"]),
  duration: z.number().nonnegative(),
  fileSize: z.number().int().nonnegative(),
  display: displaySchema
});

const chapterSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  tracks: z.array(trackSchema).min(1),
  defaultTrackDisplay: z.string(),
  defaultTrackAmbient: z.string(),
  display: displaySchema
});

export const playlistDraftSchema = z.object({
  title: z.string().min(1).max(140),
  content: z.object({
    chapters: z.array(chapterSchema).min(1),
    playbackType: z.enum(["linear", "interactive"]).optional(),
    config: z
      .object({
        autoadvance: z.enum(["next", "repeat", "none"]).optional(),
        onlineOnly: z.boolean().optional(),
        resumeTimeout: z.number().int().nonnegative().optional()
      })
      .optional()
  }),
  metadata: z
    .object({
      category: z
        .enum(["none", "stories", "music", "radio", "podcast", "sfx", "activities", "alarms"])
        .optional(),
      description: z.string().optional(),
      minAge: z.number().nonnegative().optional(),
      maxAge: z.number().nonnegative().optional(),
      source: z
        .object({
          description: z.string().min(1, "Source description is required"),
          permission: z.string().min(1, "Source permission is required")
        })
        .optional()
    })
    .passthrough()
}).superRefine((draft, context) => {
  if (!draft.metadata.source) {
    context.addIssue({
      code: "custom",
      path: ["metadata", "source"],
      message: "Source permission and description are required"
    });
  }
  const chapterKeys = new Set<string>();
  const trackKeys = new Set<string>();
  for (const [chapterIndex, chapter] of draft.content.chapters.entries()) {
    if (chapterKeys.has(chapter.key)) {
      context.addIssue({
        code: "custom",
        path: ["content", "chapters", chapterIndex, "key"],
        message: "Chapter keys must be unique"
      });
    }
    chapterKeys.add(chapter.key);
    for (const [trackIndex, track] of chapter.tracks.entries()) {
      if (trackKeys.has(track.key)) {
        context.addIssue({
          code: "custom",
          path: ["content", "chapters", chapterIndex, "tracks", trackIndex, "key"],
          message: "Track keys must be unique"
        });
      }
      trackKeys.add(track.key);
    }
  }
});

export type PlaylistDraft = z.infer<typeof playlistDraftSchema>;

export function validatePlaylistDraft(input: unknown): PlaylistDraft {
  return playlistDraftSchema.parse(input) as PlaylistDraft;
}
