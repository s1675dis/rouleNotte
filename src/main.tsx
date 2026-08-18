import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouletteRecorder } from "./RouletteRecorder";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouletteRecorder />
  </StrictMode>,
);
