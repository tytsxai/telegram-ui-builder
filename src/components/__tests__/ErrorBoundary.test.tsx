import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ErrorBoundary, { getErrorBoundaryDisplayMessage } from "../ErrorBoundary";
import { reportError } from "@/lib/errorReporting";

vi.mock("@/lib/errorReporting", () => ({
  reportError: vi.fn(),
}));

vi.mock("@/lib/appUrl", () => ({
  getAppBaseUrl: () => "https://example.test/",
}));

describe("ErrorBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders children normally when no error", () => {
    render(
      <ErrorBoundary>
        <div>OK_CHILD</div>
      </ErrorBoundary>
    );

    expect(screen.getByText("OK_CHILD")).toBeTruthy();
  });

  it("displays error UI when child throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const Thrower = () => {
      throw new Error("BOOM");
    };

    render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>
    );

    expect(screen.getByText("出错了")).toBeTruthy();
    expect(screen.getByText("应用遇到了一个错误")).toBeTruthy();
    expect(screen.getByText("BOOM")).toBeTruthy();

    consoleError.mockRestore();
  });

  it("hides raw error messages in production display mode", () => {
    const error = new Error("token=secret&internal=detail");

    expect(getErrorBoundaryDisplayMessage(error, false)).toBe("应用发生未预期错误，请刷新或稍后重试");
    expect(getErrorBoundaryDisplayMessage(error, true)).toBe("token=secret&internal=detail");
  });

  it("getDerivedStateFromError sets hasError state", () => {
    type ErrorBoundaryClass = typeof ErrorBoundary & {
      getDerivedStateFromError: (error: Error) => { hasError: boolean; error: Error };
    };
    const state = (ErrorBoundary as ErrorBoundaryClass).getDerivedStateFromError(new Error("X"));
    expect(state.hasError).toBe(true);
    expect(state.error).toBeInstanceOf(Error);
  });

  it("componentDidCatch calls reportError", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const Thrower = () => {
      throw new Error("REPORT_ME");
    };

    render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>
    );

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "REPORT_ME" }),
      expect.objectContaining({
        source: "react_error_boundary",
        details: expect.objectContaining({
          componentStack: expect.any(String),
        }),
      })
    );

    consoleError.mockRestore();
  });

  it("handleReset resets error state", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    let shouldThrow = true;
    const Flaky = () => {
      if (shouldThrow) throw new Error("TEMP");
      return <div>RECOVERED</div>;
    };

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>
    );

    expect(screen.getByText("出错了")).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByText("尝试恢复"));

    expect(screen.getByText("RECOVERED")).toBeTruthy();

    consoleError.mockRestore();
  });

  it("uses custom fallback when provided", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const Thrower = () => {
      throw new Error("ANY");
    };

    render(
      <ErrorBoundary fallback={<div>MY_FALLBACK</div>}>
        <Thrower />
      </ErrorBoundary>
    );

    expect(screen.getByText("MY_FALLBACK")).toBeTruthy();
    expect(screen.queryByText("出错了")).toBeNull();

    consoleError.mockRestore();
  });
});
