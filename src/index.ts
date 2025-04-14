import { buildMode } from "./util/env.js";

import run from "./modes/run/index.js";
import runFetch from "./modes/group/fetch.js";
import runBuild from "./modes/group/build.js";

console.log("Current mode:", buildMode ?? "none");

switch (buildMode) {
  case "fetch": {
    await runFetch();
    break;
  }

  case "build": {
    await runBuild();
    break;
  }

  default: {
    await run();
    break;
  }
}
