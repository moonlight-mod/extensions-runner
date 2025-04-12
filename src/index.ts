import { mode } from "./util/env.js";
import buildGroup from "./group.js";
import run from "./run.js";

console.log("Current mode:", mode ?? "none");

if (mode === "group") {
  await buildGroup();
} else {
  await run();
}
