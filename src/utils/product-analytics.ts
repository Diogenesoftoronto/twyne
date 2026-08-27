import type { AiProviderType } from "../types";
import {
  APP_ERROR_CODES,
  type AppErrorCode,
} from "../types/application-errors";
import {
  capturePostHogEvent,
  maybeDisplayProgressSurvey,
} from "./posthog-context";
import { ANALYTICS_VERSION } from "./analytics-version";
import type { AnalyticsAuthMethod, AuthFlow } from "./auth-analytics";

export { ANALYTICS_VERSION } from "./analytics-version";

export type LandingCtaLocation = "header" | "hero" | "mid_page" | "footer";
export type LandingCtaDestination =
  | "onboarding"
  | "dossier"
  | "editor"
  | "pricing"
  | "sign_in"
  | "downloads";
export type SignInMethod = AnalyticsAuthMethod;
export type SignInProvider = "convex" | "atproto";
export type FolioAnalyticsSource =
  | "landing"
  | "editor"
  | "onboarding"
  | "import"
  | "sync"
  | "integration";
export type AnalyticsFolioType = "draft" | "notes" | "outline";
export type DraftMilestone =
  | "first_edit"
  | "100_words"
  | "500_words"
  | "1000_words"
  | "2500_words";
export type WordCountBucket =
  | "empty"
  | "1_99"
  | "100_499"
  | "500_999"
  | "1000_2499"
  | "2500_plus";
export type EditorialAction =
  | "persona_feedback"
  | "persona_reply"
  | "persona_rewrite"
  | "persona_analysis"
  | "room_synthesis"
  | "rubric_review"
  | "dossier_check"
  | "research";
export type EditorialActionSource =
  | "editor"
  | "dossier"
  | "analysis"
  | "background";
export type DraftExportFormat =
  | "pdf"
  | "markdown"
  | "html"
  | "txt"
  | "docx"
  | "twyne_backup";
export type DraftPublishDestination =
  | "twyne_share"
  | "twyne_blog"
  | "atproto"
  | "micropub"
  | "standard_site";
export type DossierMode = "first_run" | "refine";
export type AnalyticsAiProvider = AiProviderType | "hosted" | "none";
export type DeskAnalyticsRange = "7d" | "30d" | "90d" | "all";
export type DeskAnalyticsSection =
  | "activity"
  | "day_detail"
  | "cost"
  | "features"
  | "models"
  | "tokens"
  | "patterns"
  | "recent_work"
  | "data_controls";
export type UsageExportRowCountBucket =
  | "empty"
  | "1_9"
  | "10_99"
  | "100_999"
  | "1000_plus";
export type UsageDeletionScope =
  | "local"
  | "synchronized"
  | "local_and_synchronized";

export interface ProductAnalyticsEventMap {
  landing_cta_clicked: {
    location: LandingCtaLocation;
    destination: LandingCtaDestination;
  };
  sign_in_started: { method: SignInMethod; flow: AuthFlow };
  sign_in_completed: {
    provider: SignInProvider;
    method: SignInMethod;
    flow: AuthFlow;
  };
  sign_in_failed: {
    method: SignInMethod;
    flow: AuthFlow;
    error_code: AppErrorCode;
  };
  auth_session_restored: { provider: SignInProvider };
  folio_created: {
    source: FolioAnalyticsSource;
    folio_type: AnalyticsFolioType;
  };
  folio_opened: {
    source: FolioAnalyticsSource;
    folio_type: AnalyticsFolioType;
  };
  draft_milestone_reached: {
    milestone: DraftMilestone;
    word_count_bucket: WordCountBucket;
  };
  editorial_action_started: {
    action: EditorialAction;
    source: EditorialActionSource;
  };
  editorial_action_completed: {
    action: EditorialAction;
    source: EditorialActionSource;
  };
  editorial_action_failed: {
    action: EditorialAction;
    source: EditorialActionSource;
    error_code: AppErrorCode;
  };
  draft_exported: { format: DraftExportFormat };
  draft_published: { destination: DraftPublishDestination };
  dossier_completed: { mode: DossierMode };
  ai_settings_saved: {
    provider: AnalyticsAiProvider;
    feature_override_count: number;
  };
  desk_viewed: { signed_in: boolean; range: DeskAnalyticsRange };
  desk_section_opened: { section: DeskAnalyticsSection };
  usage_range_changed: { range: DeskAnalyticsRange };
  usage_exported: {
    format: "json" | "csv";
    row_count_bucket: UsageExportRowCountBucket;
  };
  usage_history_deleted: { scope: UsageDeletionScope };
  public_profile_stats_updated: { enabled_stat_count: number };
}

export type ProductEventName = keyof ProductAnalyticsEventMap;
export type ProductEventProperties<Event extends ProductEventName> =
  ProductAnalyticsEventMap[Event];
export type ProductEventPayload<Event extends ProductEventName> =
  ProductEventProperties<Event> & {
    analytics_version: typeof ANALYTICS_VERSION;
  };

/**
 * The allowlist is also a runtime privacy boundary. TypeScript rejects unknown
 * properties for object literals, while this table drops them when an object
 * has been widened or arrives from untyped JavaScript.
 */
const PRODUCT_EVENT_PROPERTY_KEYS = {
  landing_cta_clicked: ["location", "destination"],
  sign_in_started: ["method", "flow"],
  sign_in_completed: ["provider", "method", "flow"],
  sign_in_failed: ["method", "flow", "error_code"],
  auth_session_restored: ["provider"],
  folio_created: ["source", "folio_type"],
  folio_opened: ["source", "folio_type"],
  draft_milestone_reached: ["milestone", "word_count_bucket"],
  editorial_action_started: ["action", "source"],
  editorial_action_completed: ["action", "source"],
  editorial_action_failed: ["action", "source", "error_code"],
  draft_exported: ["format"],
  draft_published: ["destination"],
  dossier_completed: ["mode"],
  ai_settings_saved: ["provider", "feature_override_count"],
  desk_viewed: ["signed_in", "range"],
  desk_section_opened: ["section"],
  usage_range_changed: ["range"],
  usage_exported: ["format", "row_count_bucket"],
  usage_history_deleted: ["scope"],
  public_profile_stats_updated: ["enabled_stat_count"],
} as const satisfies {
  [Event in ProductEventName]: readonly (keyof ProductAnalyticsEventMap[Event])[];
};

const SAFE_ERROR_CODES = new Set<string>(APP_ERROR_CODES);

export function buildProductEventPayload<Event extends ProductEventName>(
  event: Event,
  properties: ProductEventProperties<Event>,
): ProductEventPayload<Event> {
  const input = properties as unknown as Record<string, unknown>;
  const payload: Record<string, unknown> = {
    analytics_version: ANALYTICS_VERSION,
  };

  for (const key of PRODUCT_EVENT_PROPERTY_KEYS[event] as readonly string[]) {
    payload[key] = input[key];
  }

  // A caller using `any` must still never turn an exception message into an
  // analytics property. Only Twyne's stable, content-free error vocabulary is
  // allowed across this boundary.
  if (
    "error_code" in payload &&
    (typeof payload.error_code !== "string" ||
      !SAFE_ERROR_CODES.has(payload.error_code))
  ) {
    payload.error_code = "INTERNAL_ERROR";
  }

  return payload as unknown as ProductEventPayload<Event>;
}

export function usageExportRowCountBucket(
  count: number,
): UsageExportRowCountBucket {
  const rows = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (rows === 0) return "empty";
  if (rows < 10) return "1_9";
  if (rows < 100) return "10_99";
  if (rows < 1_000) return "100_999";
  return "1000_plus";
}

export async function captureProductEvent<Event extends ProductEventName>(
  event: Event,
  properties: ProductEventProperties<Event>,
): Promise<void> {
  await capturePostHogEvent(
    event,
    buildProductEventPayload(event, properties) as unknown as Record<
      string,
      unknown
    >,
  );
  if (event === "dossier_completed" || event === "draft_exported") {
    await maybeDisplayProgressSurvey(event);
  }
}

/** Count prose words without retaining or returning any draft content. */
export function countDraftWords(htmlOrText: string): number {
  const text = htmlOrText
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi, " ")
    .trim();

  if (!text) return 0;
  return text.split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token))
    .length;
}

function normalizedWordCount(count: number): number {
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

export function wordCountBucket(count: number): WordCountBucket {
  const words = normalizedWordCount(count);
  if (words === 0) return "empty";
  if (words < 100) return "1_99";
  if (words < 500) return "100_499";
  if (words < 1000) return "500_999";
  if (words < 2500) return "1000_2499";
  return "2500_plus";
}

const DRAFT_MILESTONES = [
  { count: 1, milestone: "first_edit" },
  { count: 100, milestone: "100_words" },
  { count: 500, milestone: "500_words" },
  { count: 1000, milestone: "1000_words" },
  { count: 2500, milestone: "2500_words" },
] as const satisfies readonly { count: number; milestone: DraftMilestone }[];

/** Return every milestone crossed by an upward word-count transition. */
export function crossedDraftMilestones(
  previous: number,
  current: number,
): DraftMilestone[] {
  const before = normalizedWordCount(previous);
  const after = normalizedWordCount(current);
  if (after <= before) return [];

  return DRAFT_MILESTONES.filter(
    ({ count }) => before < count && count <= after,
  ).map(({ milestone }) => milestone);
}
