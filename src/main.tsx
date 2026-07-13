import { createRoot } from "react-dom/client";
import "./index.css";
import { installEdgeProxy } from "./shared/utils/edgeProxy";
import { captureAttribution } from "./shared/utils/attribution";

installEdgeProxy();
captureAttribution();

const root = createRoot(document.getElementById("root")!);

void import("./App.tsx").then(({ default: App }) => {
  root.render(<App />);
});
