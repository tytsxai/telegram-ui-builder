import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe(":focus-visible global styles", () => {
  it("defines a 2px outline in the base stylesheet", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/:focus-visible\s*{[^}]*outline:\s*2px\s+solid\s+hsl\(var\(--ring\)\)/s);
  });
});

