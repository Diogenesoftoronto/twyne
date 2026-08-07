import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

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

export default crons;
