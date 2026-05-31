import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { installRustProviderFetch } from "@features/agent/lib/pi/rustProviderFetch";
import "./index.css";

// 必须先于首次渲染、先于任何 pi-ai 调用：让 LLM 模型请求走 Rust 代理绕过国产网关 CORS。
// OpenAI SDK 在构造 client 时捕获当时的 globalThis.fetch，故注入越早越稳。
installRustProviderFetch();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
