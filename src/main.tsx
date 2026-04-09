import { createRoot } from "react-dom/client";
import "./index.css";
import { installEdgeProxy } from "./shared/utils/edgeProxy";

installEdgeProxy();

const root = createRoot(document.getElementById("root")!);

void import("./App.tsx").then(({ default: App }) => {
  root.render(<App />);
});
