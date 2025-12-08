import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import TemplateFlowDiagram from "../TemplateFlowDiagram";
import { __getLatestProps } from "reactflow";

vi.mock("reactflow", () => {
  const MarkerType = { ArrowClosed: "arrowclosed" };
  const Position = { Right: "right", Left: "left" };
  const instance = { fitView: vi.fn(), setCenter: vi.fn() };
  let latestProps: unknown = null;

  const ReactFlow = (props: any) => {
    latestProps = props;
    React.useEffect(() => {
      props.onInit?.(instance);
    }, [props]);
    return (
      <div data-testid="reactflow">
        {props.nodes?.map((node: any) => (
          <div key={node.id} data-node-id={node.id}>
            {typeof node.data?.label === "string" ? node.data.label : node.data?.label}
          </div>
        ))}
        {props.children}
      </div>
    );
  };

  const useNodesState = (initial: any) => {
    const [state, setState] = React.useState(initial);
    const onChange = React.useCallback((changes: any[]) => {
      setState((prev: any[]) =>
        prev.map((node) => {
          const change = changes.find((c) => c.id === node.id && (c as any).position);
          if (change && (change as any).position) {
            return { ...node, position: (change as any).position };
          }
          return node;
        }),
      );
    }, []);
    return [state, setState, onChange] as const;
  };

  const useEdgesState = (initial: any) => {
    const [state, setState] = React.useState(initial);
    const onChange = React.useCallback(() => {}, []);
    return [state, setState, onChange] as const;
  };

  const Background = ({ children }: any) => <div data-testid="background">{children}</div>;
  const Controls = ({ children }: any) => <div data-testid="controls">{children}</div>;
  const MiniMap = ({ children }: any) => <div data-testid="minimap">{children}</div>;

  return {
    __esModule: true,
    default: ReactFlow,
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    MarkerType,
    Position,
    __getLatestProps: () => latestProps,
  };
});

beforeAll(() => {
  // @ts-expect-error jsdom missing ResizeObserver
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const makeScreen = (id: string, links: string[] = []) => ({
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

describe("TemplateFlowDiagram", () => {
  beforeEach(() => {
    // Provide ResizeObserver for Radix UI internals
    // @ts-expect-error jsdom polyfill
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    localStorage.clear();
  });

  afterEach(() => {
    // @ts-expect-error cleanup
    delete global.ResizeObserver;
  });

  it("renders a cycle badge when screens form a loop", async () => {
    const screens = [makeScreen("a", ["b"]), makeScreen("b", ["a"])];
    render(
      <TemplateFlowDiagram
        screens={screens}
        currentScreenId="a"
        open
        onOpenChange={() => {}}
      />,
    );

    const badges = await screen.findAllByText("循环");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("hides isolated nodes when the toggle is enabled", async () => {
    const screens = [makeScreen("a", ["b"]), makeScreen("b"), makeScreen("c")];
    render(
      <TemplateFlowDiagram
        screens={screens}
        currentScreenId="a"
        open
        onOpenChange={() => {}}
      />,
    );

    expect((__getLatestProps as () => any)()?.nodes.find((n: any) => n.id === "c")).toBeDefined();

    fireEvent.click(screen.getByLabelText("隐藏孤立"));

    await waitFor(() => {
      expect((__getLatestProps as () => any)()?.nodes.find((n: any) => n.id === "c")).toBeUndefined();
    });
  });

  it("restores layout positions from localStorage when opened", async () => {
    const screens = [makeScreen("home")];
    localStorage.setItem("diagram_positions_anon", JSON.stringify([{ id: "home", x: 120, y: 80 }]));

    render(
      <TemplateFlowDiagram
        screens={screens}
        currentScreenId="home"
        open
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      const props: any = (__getLatestProps as () => any)();
      expect(props?.nodes.find((n: any) => n.id === "home")?.position).toMatchObject({ x: 120, y: 80 });
    });
  });
});
