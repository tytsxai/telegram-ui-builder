import { RuntimeConfigReport } from "@/lib/runtimeConfig";

type RuntimeConfigErrorProps = {
  report: RuntimeConfigReport;
};

const RuntimeConfigError = ({ report }: RuntimeConfigErrorProps) => {
  const blockingIssues = report.issues.filter((issue) => issue.level === "error");

  const handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-lg w-full rounded-xl border border-border bg-card text-card-foreground shadow-sm p-6 space-y-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Configuration error</h1>
          <p className="text-sm text-muted-foreground">
            This deployment is missing required runtime configuration.
          </p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <ul className="list-disc pl-5 space-y-1">
            {blockingIssues.map((issue, index) => (
              <li key={`${issue.message}-${index}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
        <div className="text-xs text-muted-foreground">
          Expected env: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY.
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReload}
            className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
};

export default RuntimeConfigError;
