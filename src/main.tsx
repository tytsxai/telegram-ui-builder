import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { setSyncTelemetryPublisher, getSyncTelemetryPublisher } from "@/lib/syncTelemetry";
import RuntimeConfigError from "@/components/RuntimeConfigError";
import { getRuntimeConfigReport, logRuntimeConfigIssues } from "@/lib/runtimeConfig";
import { initErrorReporting } from "@/lib/errorReportingClient";

const normalizeGlobalBuffer = () => {
  const buffer = globalThis.Buffer as unknown;
  if (typeof buffer === "undefined") return;
  if (typeof buffer === "function") return;
  if (typeof buffer === "object" && buffer && typeof (buffer as { from?: unknown }).from === "function") {
    try {
      delete (globalThis as { Buffer?: unknown }).Buffer;
    } catch {
      (globalThis as { Buffer?: unknown }).Buffer = undefined;
    }
  }
};

if (!getSyncTelemetryPublisher()) {
  setSyncTelemetryPublisher((event) => {
    if (import.meta.env.DEV) {
      console.info("[Telemetry]", {
        scope: event.scope,
        state: event.status.state,
        requestId: event.status.requestId,
        message: event.status.message,
        at: event.status.at || Date.now(),
        userId: event.meta?.userId,
        action: event.meta?.action,
        targetId: event.meta?.targetId,
      });
    }
  });
}

normalizeGlobalBuffer();
initErrorReporting();

const runtimeReport = getRuntimeConfigReport();
logRuntimeConfigIssues(runtimeReport);

const root = createRoot(document.getElementById("root")!);
if (runtimeReport.hasBlockingIssues) {
  root.render(<RuntimeConfigError report={runtimeReport} />);
} else {
  root.render(<App />);
}
