/**
 * Housekeeping for the two live-generation tables.
 *
 * Both are scratch space: a row exists so a browser can watch an answer being
 * written, and the browser deletes it once the finished thing is filed. A tab
 * closed mid-generation never gets to do that, so the row stays behind holding
 * half a note nobody will ever read.
 *
 * Nothing depends on these rows outliving the generation that made them, so the
 * sweep is free to be blunt: anything that has not been touched in an hour is
 * from a run that is over one way or another.
 */
import { internalMutation } from "./_generated/server";

/** Comfortably longer than any generation, short enough to stay tidy. */
const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Bounded so the sweep is always one small transaction. If a backlog ever
 * exceeds this, the next run takes the next slice — the cron is far more
 * frequent than the backlog could grow.
 */
const MAX_PER_RUN = 200;

export const sweepStaleStreams = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_AFTER_MS;
    let deleted = 0;

    const interviews = await ctx.db
      .query("dossierInterviewStreams")
      .withIndex("by_updatedAt", (q) => q.lt("updatedAt", cutoff))
      .take(MAX_PER_RUN);
    for (const row of interviews) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }

    const notes = await ctx.db
      .query("personaNoteStreams")
      .withIndex("by_updatedAt", (q) => q.lt("updatedAt", cutoff))
      .take(MAX_PER_RUN);
    for (const row of notes) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }

    return { deleted };
  },
});
