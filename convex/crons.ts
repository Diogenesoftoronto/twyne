import { cronJobs, makeFunctionReference } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Runtime opt-in: incomplete or disabled server config performs no DB/network work.
// An explicit reference avoids editing generated API files before codegen/deployment.
crons.cron(
  "export observed traction to Not Organic",
  "20 4 * * *",
  makeFunctionReference<"action">("traction:exportDay"),
  {},
);

// Abandoned live-generation rows. Hourly is plenty: nothing reads them after
// the run that wrote them, so they cost only the space they sit in.
crons.interval(
  "sweep stale generation streams",
  { hours: 1 },
  internal.streamSweep.sweepStaleStreams,
  {},
);

// Dormant accounts still holding a collection in its old single-document
// shape. Active accounts migrate themselves on their next write, so this only
// ever has the stragglers to do. Retire it once `backfillRemaining` reads zero.
crons.interval(
  "backfill single-document collections",
  { minutes: 10 },
  internal.collectionBackfill.backfillCollections,
  {},
);

// Writers' custom domains waiting on DNS or a certificate. Each run is one
// indexed read per status; domains back off on their own (`nextCheckAt`).
crons.interval(
  "check pending custom domains",
  { minutes: 1 },
  internal.customDomains.scheduleDueChecks,
  {},
);

export default crons;
