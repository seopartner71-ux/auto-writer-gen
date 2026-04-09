import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installEdgeProxy } from "./shared/utils/edgeProxy";

// Route Edge Function calls through Beget proxy when accessed from Russia
installEdgeProxy();

createRoot(document.getElementById("root")!).render(<App />);
