import { render } from "preact";
import { App } from "./App.tsx";
import { firstMapLoad } from "./map.ts";
import { onRouterProgress, routerReady } from "./routerClient.ts";
import { trackLaunch } from "./splash.ts";
import "./styles.css";

render(<App />, document.getElementById("app")!);

trackLaunch({
  graph: { onProgress: onRouterProgress, done: routerReady.then(() => undefined) },
  map: { done: firstMapLoad },
});
