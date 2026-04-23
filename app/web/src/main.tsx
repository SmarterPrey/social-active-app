import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import "./index.css";

// Console greeting for curious engineers
if (typeof window !== "undefined") {
  console.log(
    "%c⬡ Social Active App",
    "color: #6b9fd4; font-size: 16px; font-weight: 700; font-family: Inter, system-ui, sans-serif"
  );
  console.log(
    "%cGraph-powered infrastructure exploration.",
    "color: #8899aa; font-size: 11px; font-family: Inter, system-ui, sans-serif"
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
