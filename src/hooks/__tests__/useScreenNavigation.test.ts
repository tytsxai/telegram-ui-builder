import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import type { Screen } from "@/types/telegram";
import { isEntrySet, useScreenNavigation } from "../chat/useScreenNavigation";

const noop = () => {};

describe("useScreenNavigation", () => {
  const entry: Screen = { id: "entry", name: "Entry", message_content: "hi", keyboard: [], is_public: false };
  const other: Screen = { id: "other", name: "Other", message_content: "next", keyboard: [], is_public: false };

  beforeEach(() => {
    localStorage.clear();
  });

  it("auto selects the only screen as entry when none is set", () => {
    const { result, rerender } = renderHook(
      ({ screens }: { screens: Screen[] }) => useScreenNavigation(screens, noop, async () => {}),
      { initialProps: { screens: [] as Screen[] } }
    );

    rerender({ screens: [entry] });

    expect(isEntrySet(result.current.entryScreenId, [entry])).toBe(true);
  });

  it("clears stale entry when the screen no longer exists", () => {
    const { result, rerender } = renderHook(
      ({ screens }: { screens: Screen[] }) => useScreenNavigation(screens, noop, async () => {}),
      { initialProps: { screens: [entry, other] } }
    );

    act(() => {
      result.current.handleSetEntry(entry.id);
    });

    rerender({ screens: [other] });

    expect(result.current.entryScreenId).toBeNull();
    expect(isEntrySet(result.current.entryScreenId, [other])).toBe(false);
  });
});
