import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { setSyncTelemetryPublisher, getSyncTelemetryPublisher } from "@/lib/syncTelemetry";

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

createRoot(document.getElementById("root")!).render(<App />);
