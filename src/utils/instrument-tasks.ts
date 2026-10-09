import { makeFunctionReference } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import type {
  InstrumentTaskRequest,
  InstrumentTaskView,
} from "./instrument-tasks-model";
export const instrumentTaskRefs = {
  queue: makeFunctionReference<
    "mutation",
    { [K in keyof InstrumentTaskRequest]: InstrumentTaskRequest[K] },
    Id<"instrumentTasks">
  >("instrumentTasks:queue"),
  list: makeFunctionReference<
    "query",
    { folioId: string },
    InstrumentTaskView[]
  >("instrumentTasks:list"),
  cancel: makeFunctionReference<
    "mutation",
    { taskId: Id<"instrumentTasks"> },
    null
  >("instrumentTasks:cancel"),
  feedback: makeFunctionReference<
    "mutation",
    {
      taskId: Id<"instrumentTasks">;
      verdict: "useful" | "not-useful";
      comment: string;
    },
    null
  >("instrumentTasks:saveFeedback"),
};
export function safeInstrumentTaskError(error: unknown): string {
  const data =
    error && typeof error === "object" && "data" in error
      ? error.data
      : undefined;
  // Only known, content-free messages from our public validation boundary.
  if (
    typeof data === "string" &&
    /^(Sign in with Not Organic|Reconnect your Not Organic|Sync this folio|Choose one to three|Choose each resource|Account deletion|Task not found|Feedback needs|Feedback is limited|Too many tasks queued|This request id belongs|Request id must|Folio id must|Task instruction must|Selected text must|Source id must|Resource URI must|Resource label must)/.test(
      data,
    )
  )
    return data;
  return "The task desk could not reach your account. Reconnect or try again; an unacknowledged queue request keeps the same request id.";
}
