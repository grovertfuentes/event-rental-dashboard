import React from "react";
import ReactDOM from "react-dom/client";
import Dashboard from "./Dashboard";
import "./mobile.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <div className="terg-shell"><Dashboard /></div>
  </React.StrictMode>
);
