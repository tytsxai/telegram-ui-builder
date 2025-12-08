import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import OnboardingGuide from "../OnboardingGuide";

describe("OnboardingGuide", () => {
  const storageKey = "telegram_ui_onboarding_done_v1_test";

  beforeEach(() => {
    localStorage.clear();
  });

  it("persists dismissal to localStorage", () => {
    const Wrapper = () => (
      <OnboardingGuide
        visible
        progress={{ template: false, preview: false, share: false }}
        onDismiss={() => {
          localStorage.setItem(storageKey, "1");
        }}
        onOpenTemplate={() => void 0}
        onTogglePreview={() => void 0}
        onShare={() => void 0}
      />
    );

    render(<Wrapper />);
    fireEvent.click(screen.getByText("跳过引导"));
    expect(localStorage.getItem(storageKey)).toBe("1");
  });

  it("reflects progress count", () => {
    render(
      <OnboardingGuide
        visible
        progress={{ template: true, preview: true, share: false }}
        onDismiss={() => void 0}
        onOpenTemplate={() => void 0}
        onTogglePreview={() => void 0}
        onShare={() => void 0}
      />
    );
    expect(screen.getByText("2/3 完成")).toBeTruthy();
  });
});
