import { createFileRoute } from "@tanstack/react-router";
import { SourceSelector } from "@/components/launch/SourceSelector";
import { TooltipProvider } from "@/components/ui/tooltip";

export const Route = createFileRoute("/source-selector")({
  component: SourceSelectorWindow,
});

function SourceSelectorWindow() {
  return (
    <TooltipProvider>
      <SourceSelector />
    </TooltipProvider>
  );
}
