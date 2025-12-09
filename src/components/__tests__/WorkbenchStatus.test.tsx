import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { WorkbenchLayout } from "../workbench/WorkbenchLayout";

// simple stubs
const Stub = ({ label }: { label: string }) => <div>{label}</div>;

describe("Workbench status indicator", () => {
  it("shows offline and pending count", () => {
    render(
      <WorkbenchLayout
        leftPanel={<Stub label="left" />}
        rightPanel={<Stub label="right" />}
        centerCanvas={<Stub label="center" />}
        bottomPanel={<Stub label="bottom" />}
        pendingCount={3}
        unsaved
        lastSavedAt={"1分钟前"}
      />,
    );

    expect(screen.getByText(/待同步 3/)).toBeTruthy();
    expect(screen.getByText(/未保存/)).toBeTruthy();
  });
});

