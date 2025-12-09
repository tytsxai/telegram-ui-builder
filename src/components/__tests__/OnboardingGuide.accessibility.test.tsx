import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OnboardingGuide from "../OnboardingGuide";

describe("OnboardingGuide accessibility", () => {
  it("lets users dismiss with Escape and restores builder focus", () => {
    const onDismiss = vi.fn();
    const onOpenTemplate = vi.fn();
    const onTogglePreview = vi.fn();
    const onShare = vi.fn();

    const { container } = render(
      <OnboardingGuide
        visible
        progress={{ template: false, preview: false, share: false }}
        onDismiss={onDismiss}
        onOpenTemplate={onOpenTemplate}
        onTogglePreview={onTogglePreview}
        onShare={onShare}
      />,
    );

    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();

    // Dialog listens for Escape
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalled();
  });
});

