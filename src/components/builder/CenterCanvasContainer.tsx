import React from "react";
import { CenterCanvas } from "@/components/workbench/CenterCanvas";
import { useCenterCanvas } from "./BuilderProvider";

export const CenterCanvasContainer = React.memo(() => {
  const props = useCenterCanvas();
  return <CenterCanvas {...props} />;
});
