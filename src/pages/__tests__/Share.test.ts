import { describe, it, expect } from "vitest";
import { buildShareScreen } from "../Share";

const baseRow = {
  id: "screen-1",
  name: "Welcome",
  keyboard: [],
  message_content: "",
  share_token: "token-1",
  is_public: true,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-02T00:00:00Z",
  user_id: "user-1",
};

describe("Share page helpers", () => {
  it("preserves raw content when mapping Supabase rows", () => {
    const payload = JSON.stringify({
      type: "photo",
      caption: "hello world",
      photo: "https://example.com/image.jpg",
      parse_mode: "MarkdownV2",
    });
    const screen = buildShareScreen({ ...baseRow, message_content: payload });

    expect(screen.rawMessageContent).toBe(payload);
    expect(screen.message_content).toBe("hello world");
    expect(screen.message_type).toBe("photo");
    expect(screen.media_url).toBe("https://example.com/image.jpg");
  });
});
