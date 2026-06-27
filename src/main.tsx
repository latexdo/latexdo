import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import appIconUrl from "../build/icon.svg";
import App from "./App";
import { installBrowserApis } from "./browserApi";
import "./styles.css";

const favicon =
  document.querySelector<HTMLLinkElement>("link[rel='icon']") ??
  document.createElement("link");
favicon.rel = "icon";
favicon.type = "image/svg+xml";
favicon.href = appIconUrl;

if (!favicon.parentElement) {
  document.head.appendChild(favicon);
}

installBrowserApis();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
