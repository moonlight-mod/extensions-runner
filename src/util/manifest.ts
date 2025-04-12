import { z } from "zod";

// https://stackoverflow.com/a/78709590
const GitHashSchema = z.custom<string>((val) => {
  return typeof val === "string" ? /^[a-f0-9]+$/i.test(val) : false;
});

export type BuildManifest = z.infer<typeof BuildManifestSchema>;
export const BuildManifestSchema = z.object({
  repository: z.string().url(),
  commit: GitHashSchema,
  scripts: z.string().array().optional(),
  output: z.string().optional()
});

export const ExtensionManifestSchema = z.object({
  id: z.string(),
  apiLevel: z.number().optional(),
  version: z.string().optional(),
  meta: z.object({
    name: z.string(),
    source: z.string()
  })
});

export type BuildState = {
  version: string;
  manifest: BuildManifest;
};
export type BuildStates = Partial<Record<string, BuildState>>;

export type BuildGroupState = {
  scripts: string[];
  output: Partial<Record<string, string>>;
};

export type BuildGroupResult = z.infer<typeof BuildGroupResultSchema>;
export const BuildGroupResultSchema = z.object({
  versions: z.record(z.string(), z.string())
});

export const defaultScripts = ["build"];
export const currentApiLevel = 2;

// Simple compare function for the manifest diffing
export function compare<T>(old?: T, current?: T) {
  if (old == null || current == null) return old != current;
  if (typeof old === "string" || typeof current === "string") return old !== current;
  // This would be used on arrays, so positioning is fine
  return JSON.stringify(old) !== JSON.stringify(current);
}
