import React from "react";
import { SidebarLeft } from "@/components/workbench/SidebarLeft";
import { useLeftPanel } from "./BuilderProvider";

export const LeftPanelContainer = React.memo(() => {
  const props = useLeftPanel();
  return <SidebarLeft {...props} />;
});
