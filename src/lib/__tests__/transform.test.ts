import { describe, it, expect } from "vitest";
import type { KeyboardRow, Screen } from "@/types/telegram";
import { validateFlowExport } from "../validation";

const sampleScreens: Screen[] = [
  {
    id: "s1",
    name: "Start",
    message_content: "Hello",
    keyboard: [
      { id: "r1", buttons: [{ id: "b1", text: "Go", linked_screen_id: "s2" }] },
    ],
    is_public: false,
  },
  {
    id: "s2",
    name: "Next",
    message_content: "Next step",
    keyboard: [{ id: "r2", buttons: [{ id: "b2", text: "Back", linked_screen_id: "s1" }] }],
    is_public: false,
  },
];

const exportFlow = (screens: Screen[], entry?: string) => ({
  version: "1.0",
  entry_screen_id: entry ?? screens[0]?.id,
  screens: screens.map((s) => ({
    id: s.id,
    name: s.name,
    message_content: s.message_content,
    keyboard: s.keyboard,
    is_public: s.is_public,
  })),
});

describe("transform/import-export", () => {
  it("exports a valid flow payload", () => {
    const payload = exportFlow(sampleScreens, "s1");
    expect(() => validateFlowExport(payload)).not.toThrow();
    expect(payload.entry_screen_id).toBe("s1");
    expect(payload.screens).toHaveLength(2);
  });

  it("rejects invalid callback_data length", () => {
    const badKeyboard: KeyboardRow[] = [
      { id: "r1", buttons: [{ id: "b1", text: "Bad", callback_data: "a".repeat(65) }] },
    ];
    const payload = exportFlow(
      [{ ...sampleScreens[0], keyboard: badKeyboard }],
      "s1"
    );
    expect(() => validateFlowExport(payload)).toThrow();
  });
});
