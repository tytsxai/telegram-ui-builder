import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import TemplateFlowDiagram from "../TemplateFlowDiagram";
import { __getLatestProps } from "reactflow";

type MockNode = { id: string; data?: { label?: React.ReactNode }; position?: { x: number; y: number } };
type MockChange = { id: string; position?: { x: number; y: number } };
type MockReactFlowProps = {
  nodes?: MockNode[];
  children?: React.ReactNode;
  onInit?: (instance: { fitView: ReturnType<typeof vi.fn>; setCenter: ReturnType<typeof vi.fn> }) => void;
  onNodesChange?: (changes: MockChange[]) => void;
};

vi.mock("reactflow", () => {
  const MarkerType = { ArrowClosed: "arrowclosed" };
  const Position = { Right: "right", Left: "left" };
  const instance = { fitView: vi.fn(), setCenter: vi.fn() };
  let latestProps: MockReactFlowProps | null = null;

  const ReactFlow = (props: MockReactFlowProps) => {
    latestProps = props;
    React.useEffect(() => {
      props.onInit?.(instance);
    }, [props]);
    return (
      <div data-testid="reactflow">
        {props.nodes?.map((node) => (
          <div key={node.id} data-node-id={node.id}>
            {typeof node.data?.label === "string" ? node.data.label : node.data?.label}
          </div>
        ))}
        {props.children}
      </div>
    );
  };

  const useNodesState = (initial: MockNode[]) => {
    const [state, setState] = React.useState(initial);
    const onChange = React.useCallback((changes: MockChange[]) => {
      setState((prev: MockNode[]) =>
        prev.map((node) => {
          const change = changes.find((c) => c.id === node.id && c.position);
          if (change && change.position) {
            return { ...node, position: change.position };
          }
          return node;
        }),
      );
    }, []);
    return [state, setState, onChange] as const;
  };

  const useEdgesState = (initial: unknown[]) => {
    const [state, setState] = React.useState(initial);
    const onChange = React.useCallback(() => {}, []);
    return [state, setState, onChange] as const;
  };

  const Background = ({ children }: React.PropsWithChildren) => <div data-testid="background">{children}</div>;
  const Controls = ({ children }: React.PropsWithChildren) => <div data-testid="controls">{children}</div>;
  const MiniMap = ({ children }: React.PropsWithChildren) => <div data-testid="minimap">{children}</div>;

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

    const getLatestProps = __getLatestProps as unknown as () => MockReactFlowProps | null;
    expect(getLatestProps()?.nodes?.find((n) => n.id === "c")).toBeDefined();

    fireEvent.click(screen.getByLabelText("隐藏孤立"));

    await waitFor(() => {
      expect(getLatestProps()?.nodes?.find((n) => n.id === "c")).toBeUndefined();
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
      const getLatestProps = __getLatestProps as unknown as () => MockReactFlowProps | null;
      const props = getLatestProps();
      expect(props?.nodes?.find((n) => n.id === "home")?.position).toMatchObject({ x: 120, y: 80 });
    });
  });
});
