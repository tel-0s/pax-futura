import { z } from "zod";

export const PolityCodeSchema = z.string().min(1);

export const HexColorSchema = z.string().regex(/^#?[0-9a-fA-F]{6}$/);

/**
 * One polity record holds everything the reference kept in four parallel,
 * inconsistently-keyed maps (polityOverrides, colors.json, internationalReputation,
 * countryTags) — the single map keyed by canonical code makes that desync
 * structurally impossible.
 */
export const PolitySchema = z.object({
  code: PolityCodeSchema,
  name: z.string().default(""),
  color: HexColorSchema.or(z.literal("")).default(""),
  aliases: z.array(z.string()).default([]),
  note: z.string().default(""),
  /** 0-100; null = never set by simulation (scenario default applies). */
  reputation: z.number().int().min(0).max(100).nullable().default(null),
  /** Ideology/identity tags; complete list, empty = no defining tags. */
  tags: z.array(z.string().max(32)).max(8).default([]),
  /** Emoji string or data-URL image (custom nations); empty = none. */
  flag: z.string().max(100_000).default(""),
});
export type Polity = z.infer<typeof PolitySchema>;
