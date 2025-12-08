import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAutoSave } from "../useAutoSave";

describe("useAutoSave", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists changes and triggers the provided onSave callback", async () => {
    const onSave = vi.fn();

    const { rerender } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          interval: 100,
          storageKey: "autosave_draft",
        }),
      { initialProps: { data: { text: "hello" } } }
    );

    rerender({ data: { text: "changed" } });

    await act(async () => {
      vi.advanceTimersByTime(120);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("autosave_draft")).toBe(
      JSON.stringify({ text: "changed" })
    );
    expect(localStorage.getItem("autosave_draft_timestamp")).toBeTruthy();
  });

  it("restores recent data and clears expired snapshots", () => {
    const storageKey = "guide_persist";
    const now = Date.now();

    localStorage.setItem(storageKey, JSON.stringify({ step: 2 }));
    localStorage.setItem(`${storageKey}_timestamp`, `${now}`);

    const { result } = renderHook(() =>
      useAutoSave({ data: {}, onSave: vi.fn(), enabled: false, storageKey })
    );

    expect(result.current.restoreFromLocalStorage()).toEqual({ step: 2 });

    localStorage.setItem(storageKey, JSON.stringify({ step: 3 }));
    localStorage.setItem(
      `${storageKey}_timestamp`,
      `${now - 2 * 60 * 60 * 1000}`
    );

    expect(result.current.restoreFromLocalStorage()).toBeNull();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});
