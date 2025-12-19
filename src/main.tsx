import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { setSyncTelemetryPublisher, getSyncTelemetryPublisher } from "@/lib/syncTelemetry";
import RuntimeConfigError from "@/components/RuntimeConfigError";
import { getRuntimeConfigReport, logRuntimeConfigIssues } from "@/lib/runtimeConfig";
import { reportError } from "@/lib/errorReporting";
import { initErrorReporting } from "@/lib/errorReportingClient";

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

initErrorReporting();

const runtimeReport = getRuntimeConfigReport();
logRuntimeConfigIssues(runtimeReport);

if (typeof window !== "undefined" && import.meta.env.MODE !== "test") {
  window.addEventListener("error", (event) => {
    reportError(event.error ?? event.message, {
      source: "window_error",
      details: {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason, {
      source: "unhandled_rejection",
    });
  });
}

const root = createRoot(document.getElementById("root")!);
if (runtimeReport.hasBlockingIssues) {
  root.render(<RuntimeConfigError report={runtimeReport} />);
} else {
  root.render(<App />);
}
