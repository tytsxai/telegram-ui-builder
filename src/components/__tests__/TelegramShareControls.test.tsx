import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SidebarLeft } from "../workbench/SidebarLeft";
import type { Screen } from "@/types/telegram";
import type { User } from "@supabase/supabase-js";

vi.mock("@/components/ui/select", () => {
  const Select = ({ value, onValueChange, children }: any) => (
    <div data-value={value} onClick={(e) => {
      const target = e.target as HTMLElement;
      const val = target.getAttribute?.("data-value");
      if (val && onValueChange) onValueChange(val);
    }}>
      {children}
    </div>
  );
  const SelectTrigger = ({ children }: any) => <button type="button">{children}</button>;
  const SelectValue = ({ placeholder }: any) => <span>{placeholder}</span>;
  const SelectContent = ({ children }: any) => <div>{children}</div>;
  const SelectItem = ({ value, children }: any) => <div data-value={value}>{children}</div>;
  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

const makeScreen = (id: string, name: string): Screen => ({
  id,
  name,
  message_content: `${name} content`,
  keyboard: [],
  is_public: false,
});

const baseUser = { id: "user-1" } as User;

const buildProps = (overrides: Partial<React.ComponentProps<typeof SidebarLeft>> = {}) => ({
  user: baseUser,
  screens: [makeScreen("s1", "Home")],
  currentScreenId: "s1",
  entryScreenId: null,
  pinnedIds: [],
  isLoading: false,
  isClearingScreens: false,
  shareLoading: false,
  hasUnsavedChanges: false,
  isOffline: false,
  onLogout: vi.fn(),
  onLoadScreen: vi.fn(),
  onNewScreen: vi.fn(),
  onSaveScreen: vi.fn(),
  onUpdateScreen: vi.fn(),
  onDeleteScreen: vi.fn(),
  onDeleteAllScreens: vi.fn(),
  onTogglePin: vi.fn(),
  onSetEntry: vi.fn(),
  onJumpToEntry: vi.fn(),
  onCopyOrShare: vi.fn(),
  onRotateShareLink: vi.fn(),
  onUnshareScreen: vi.fn(),
  onOpenImport: vi.fn(),
  onCopyJSON: vi.fn(),
  onExportJSON: vi.fn(),
  onExportFlow: vi.fn(),
  onOpenFlowDiagram: vi.fn(),
  ...overrides,
});

describe("SidebarLeft share controls", () => {
  it("disables share actions when entry is missing", () => {
    const props = buildProps({ entryScreenId: null });
    render(<SidebarLeft {...props} />);

    screen.getByText("未选择入口");
    expect((screen.getByText("生成/复制入口链接") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("刷新链接") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("取消公开") as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables and triggers share actions when entry is set", () => {
    const onCopyOrShare = vi.fn();
    const onRotateShareLink = vi.fn();
    const onUnshareScreen = vi.fn();
    const screens = [makeScreen("s1", "Home"), makeScreen("s2", "Secondary")];

    const props = buildProps({
      screens,
      currentScreenId: "s2",
      entryScreenId: "s1",
      onCopyOrShare,
      onRotateShareLink,
      onUnshareScreen,
    });

    render(<SidebarLeft {...props} />);

    fireEvent.click(screen.getByText("生成/复制入口链接"));
    fireEvent.click(screen.getByText("刷新链接"));
    fireEvent.click(screen.getByText("取消公开"));

    expect(onCopyOrShare).toHaveBeenCalledTimes(1);
    expect(onRotateShareLink).toHaveBeenCalledTimes(1);
    expect(onUnshareScreen).toHaveBeenCalledTimes(1);
  });
});
