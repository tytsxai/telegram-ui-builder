import { describe, it, expect } from "vitest";
import { circularEdgesFromPaths, detectCircularReferences, findAllCircularReferences, findCircularEdges, findScreenReferences } from "../referenceChecker";
import type { Screen } from "@/types/telegram";

const makeScreen = (id: string, links: string[] = []): Screen => ({
  id,
  name: id.toUpperCase(),
  message_content: `${id} content`,
  keyboard: [
    {
      id: `${id}-row`,
      buttons: links.map((target, idx) => ({
        id: `${id}-btn-${idx}`,
        text: `to ${target}`,
        linked_screen_id: target,
      })),
    },
  ],
  is_public: false,
});

describe("referenceChecker", () => {
  const screens: Screen[] = [
    makeScreen("a", ["b"]),
    makeScreen("b", ["c"]),
    makeScreen("c", ["a"]), // closes the cycle
    makeScreen("d", []),
  ];

  it("finds screen references", () => {
    const refs = findScreenReferences("b", screens);
    expect(refs).toHaveLength(1);
    expect(refs[0].screenId).toBe("a");
    expect(refs[0].buttonText).toContain("b");
  });

  it("detects circular references from a start node", () => {
    const result = detectCircularReferences("a", screens);
    expect(result.hasCircle).toBe(true);
    // path should include a -> b -> c -> a
    expect(result.path).toContain("a");
    expect(result.path).toContain("b");
    expect(result.path).toContain("c");
  });

  it("collects all cycles", () => {
    const cycles = findAllCircularReferences(screens);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    const paths = cycles.flatMap((c) => c.path);
    expect(paths).toContain("a");
    expect(paths).toContain("b");
    expect(paths).toContain("c");
  });

  it("maps cycles to edge identifiers", () => {
    const cycles = findAllCircularReferences(screens);
    const edges = circularEdgesFromPaths(cycles);
    expect(edges.has("a->b")).toBe(true);
    expect(edges.has("b->c")).toBe(true);
    expect(edges.has("c->a")).toBe(true);
  });

  it("derives circular edges directly from screens", () => {
    const edges = findCircularEdges(screens);
    expect(edges.has("a->b")).toBe(true);
    expect(edges.has("b->c")).toBe(true);
    expect(edges.has("c->a")).toBe(true);
    expect(edges.has("d->a")).toBe(false);
  });
});
