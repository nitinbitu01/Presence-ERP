import { createFileRoute } from "@tanstack/react-router";
import { PresenceChat } from "@/components/PresenceChat";

export const Route = createFileRoute("/_authenticated/ask")({
  ssr: false,
  component: AskPresenceRoute,
});

function AskPresenceRoute() {
  return (
    <div className="flex h-[calc(100vh-64px)] w-full flex-col p-4 md:p-6 max-w-4xl mx-auto">
      <PresenceChat />
    </div>
  );
}
