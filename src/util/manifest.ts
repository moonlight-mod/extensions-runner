import { z } from "@zod/mini";

// https://stackoverflow.com/a/78709590
const GitHashSchema = z.custom<string>((val) => {
  return typeof val === "string" ? /^[a-f0-9]+$/i.test(val) : false;
});

export type BuildManifest = z.infer<typeof BuildManifestSchema>;
export const BuildManifestSchema = z.strictObject({
  repository: z.url(),
  commit: GitHashSchema,
  owners: z.optional(z.array(z.string())),
  scripts: z.optional(z.array(z.string())),
  output: z.optional(z.string())
});

export const ExtensionManifestSchema = z.object({
  id: z.string(),
  version: z.optional(z.string()),
  apiLevel: z.optional(z.number()),
  meta: z.optional(
    z.object({
      name: z.optional(z.string()),
      source: z.optional(z.string())
    })
  )
});

// This type shouldn't be changed as it's saved in extensions-dist
export type ExtensionState = {
  version?: string;
  manifest: BuildManifest;
};
export type BuildState = Record<string, ExtensionState>;

// This is passed into groups when fetching/building
export type MiniGroupState = {
  repository: string;
  commit: string;
  scripts: string[];
  outputs: Record<string, string>;
};

// This is a schema in case a build script tries to tamper with it
export type MiniGroupResult = z.infer<typeof MiniGroupResultSchema>;
export const MiniGroupResultSchema = z.strictObject({
  errors: z.array(
    z.discriminatedUnion([
      z.interface({ type: z.literal("cloneFailed"), err: z.string() }),
      z.interface({ type: z.literal("fetchFailed"), err: z.string() }),
      z.interface({ type: z.literal("installFailed"), err: z.string() }),
      z.interface({ type: z.literal("scriptFailed"), script: z.string(), err: z.string() }),
      z.interface({ type: z.literal("packageFailed"), ext: z.string(), err: z.string() })
    ])
  ),

  manifests: z.record(z.string(), ExtensionManifestSchema)
});

export const currentApiLevel = 2;
export const moonlightReviewers = [
  "44414597", // NotNite
  "1606710", // Cynosphere
  "42352565", // redstonekasi
  "48024900" // adryd325
];

// Simple compare function for the manifest diffing
export function hasChanged<T>(old?: T, current?: T) {
  if (old == null || current == null) return old != current;
  if (typeof old === "string" || typeof current === "string") return old !== current;
  // This would be used on arrays only, so positioning is fine
  return JSON.stringify(old) !== JSON.stringify(current);
}
