import { registerPlugin } from "../core/plugins.ts";
import { assetPlugin } from "./assets.ts";
import { rulesBasicPlugin } from "./rules-basic.ts";
import { timelinePlugin } from "./timeline.ts";

registerPlugin(rulesBasicPlugin);
registerPlugin(timelinePlugin);
registerPlugin(assetPlugin);