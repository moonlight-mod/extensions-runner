import { groupDir } from "../../util/env.js";
import { MiniGroupResultSchema, type MiniGroupResult, type MiniGroupState } from "../../util/manifest.js";
import * as fs from "node:fs/promises";
import path from "node:path";

export function getGroupDir() {
  if (groupDir == null) throw new Error("Group directory not set");
  return groupDir;
}

export async function readGroupState(): Promise<MiniGroupState> {
  const groupStatePath = path.join(getGroupDir(), "state.json");
  const groupStateStr = await fs.readFile(groupStatePath, "utf8");
  return JSON.parse(groupStateStr);
}

export async function readGroupResult() {
  const groupResultPath = path.join(getGroupDir(), "result.json");
  const groupResultStr = await fs.readFile(groupResultPath, "utf8");
  return MiniGroupResultSchema.parse(JSON.parse(groupResultStr));
}

export async function writeGroupResult(result: MiniGroupResult) {
  const groupResultPath = path.join(getGroupDir(), "result.json");
  await fs.writeFile(groupResultPath, JSON.stringify(result));
}
