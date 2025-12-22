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

  it("saves the latest data on unmount even if debounce is pending", () => {
    const onSave = vi.fn();

    const { rerender, unmount } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          interval: 500,
          storageKey: "autosave_unmount",
        }),
      { initialProps: { data: { text: "draft" } } }
    );

    rerender({ data: { text: "final" } });
    unmount();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("autosave_unmount")).toBe(
      JSON.stringify({ text: "final" })
    );
  });

  it("persists changes before unload and warns when dirty", () => {
    const onSave = vi.fn();

    const { rerender } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          interval: 500,
          storageKey: "autosave_unload",
        }),
      { initialProps: { data: { text: "start" } } }
    );

    rerender({ data: { text: "editing" } });

    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);

    expect(onSave).toHaveBeenCalledTimes(0);
    expect(localStorage.getItem("autosave_unload")).toBe(
      JSON.stringify({ text: "editing" })
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it("persists changes when the document becomes hidden", () => {
    const onSave = vi.fn();

    const { rerender } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          interval: 500,
          storageKey: "autosave_hidden",
        }),
      { initialProps: { data: { text: "start" } } }
    );

    rerender({ data: { text: "editing" } });

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("autosave_hidden")).toBe(
      JSON.stringify({ text: "editing" })
    );
  });

  it("clears pending timers when data changes rapidly", async () => {
    const onSave = vi.fn();
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    const { rerender } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          interval: 100,
          storageKey: "autosave_debounce",
        }),
      { initialProps: { data: { text: "first" } } }
    );

    rerender({ data: { text: "second" } });
    rerender({ data: { text: "third" } });

    await act(async () => {
      vi.advanceTimersByTime(120);
    });

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(localStorage.getItem("autosave_debounce")).toBe(
      JSON.stringify({ text: "third" })
    );

    clearTimeoutSpy.mockRestore();
  });

  it("uses sendBeacon on beforeunload when configured", () => {
    const onSave = vi.fn();
    const sendBeaconSpy = vi.fn().mockReturnValue(true);

    Object.defineProperty(navigator, "sendBeacon", {
      value: sendBeaconSpy,
      configurable: true,
    });

    const { rerender } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          interval: 500,
          storageKey: "autosave_beacon",
          beaconUrl: "https://example.com/save",
          beaconPayload: () => "payload",
        }),
      { initialProps: { data: { text: "start" } } }
    );

    rerender({ data: { text: "editing" } });

    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);

    expect(sendBeaconSpy).toHaveBeenCalledTimes(1);
    expect(sendBeaconSpy).toHaveBeenCalledWith("https://example.com/save", "payload");
  });

  it("swallows sendBeacon errors during beforeunload", () => {
    const onSave = vi.fn();
    const sendBeaconSpy = vi.fn().mockReturnValue(true);

    Object.defineProperty(navigator, "sendBeacon", {
      value: sendBeaconSpy,
      configurable: true,
    });

    const { rerender } = renderHook(
      ({ data }) =>
        useAutoSave({
          data,
          onSave,
          interval: 500,
          storageKey: "autosave_beacon_error",
          beaconUrl: "https://example.com/save",
          beaconPayload: () => {
            throw new Error("payload failure");
          },
        }),
      { initialProps: { data: { text: "start" } } }
    );

    rerender({ data: { text: "editing" } });

    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    expect(() => window.dispatchEvent(event)).not.toThrow();
  });

  it("handles localStorage failures gracefully", () => {
    const onSave = vi.fn();
    const setItemSpy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("write failure");
    });
    const removeItemSpy = vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("remove failure");
    });

    const { result } = renderHook(() =>
      useAutoSave({ data: { text: "x" }, onSave, enabled: false, storageKey: "autosave_errors" })
    );

    expect(() => result.current.saveToLocalStorage()).not.toThrow();
    expect(() => result.current.clearLocalStorage()).not.toThrow();

    setItemSpy.mockRestore();
    removeItemSpy.mockRestore();
  });

  it("returns null when restore encounters malformed data", () => {
    const storageKey = "autosave_corrupt";

    localStorage.setItem(storageKey, "{bad-json");
    localStorage.setItem(`${storageKey}_timestamp`, `${Date.now()}`);

    const { result } = renderHook(() =>
      useAutoSave({ data: {}, onSave: vi.fn(), enabled: false, storageKey })
    );

    expect(result.current.restoreFromLocalStorage()).toBeNull();
  });

  it("skips persistence when storageKey is empty", () => {
    const { result } = renderHook(() =>
      useAutoSave({ data: { text: "x" }, onSave: vi.fn(), enabled: false, storageKey: "" })
    );

    expect(() => result.current.saveToLocalStorage()).not.toThrow();
    expect(() => result.current.clearLocalStorage()).not.toThrow();
    expect(result.current.restoreFromLocalStorage()).toBeNull();
  });

  it("does not warn on beforeunload when data is already saved", () => {
    const onSave = vi.fn();
    const { result } = renderHook(() =>
      useAutoSave({ data: { text: "ready" }, onSave, enabled: false, storageKey: "autosave_clean" })
    );

    result.current.saveToLocalStorage();

    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("returns null when no snapshot exists", () => {
    const { result } = renderHook(() =>
      useAutoSave({ data: {}, onSave: vi.fn(), enabled: false, storageKey: "missing_snapshot" })
    );

    expect(result.current.restoreFromLocalStorage()).toBeNull();
  });
});
