import React from "react";
import { BottomPanel } from "@/components/workbench/BottomPanel";
import { useBottomPanel } from "./BuilderProvider";

export const BottomPanelContainer = React.memo(() => {
  const props = useBottomPanel();
  return <BottomPanel {...props} />;
});
