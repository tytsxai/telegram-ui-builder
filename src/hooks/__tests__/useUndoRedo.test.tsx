import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useUndoRedo } from "../useUndoRedo";

describe("useUndoRedo", () => {
  it("supports undo and redo with capped history", () => {
    const { result } = renderHook(() => useUndoRedo<number>(0, { maxHistorySize: 2 }));

    act(() => result.current.setState(1));
    act(() => result.current.setState(2));
    act(() => result.current.setState(3));

    // history should cap at 2 past items
    expect(result.current.historySize).toBe(2);

    act(() => result.current.undo());
    expect(result.current.state).toBe(2);

    act(() => result.current.undo());
    expect(result.current.state).toBe(1);

    // further undo should be no-op
    act(() => result.current.undo());
    expect(result.current.state).toBe(1);

    act(() => result.current.redo());
    expect(result.current.state).toBe(2);
  });
});
