import { component$, type PropFunction } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import type { AppError } from "../../types/application-errors";

export type ApplicationNoticeVariant = "error" | "warning" | "outage";

interface ApplicationNoticeProps {
  error: AppError;
  /**
   * Severity styling and live-region urgency. `error` (default) and `outage`
   * announce assertively as an alert; `warning` announces politely as a status.
   * Reserve `outage` for the application-wide connectivity banner.
   */
  variant?: ApplicationNoticeVariant;
  title?: string;
  compact?: boolean;
  recoveryLabel?: string;
  recoveryHref?: string;
  busy?: boolean;
  onRetry$?: PropFunction<() => void>;
  onRecovery$?: PropFunction<() => void>;
  onDismiss$?: PropFunction<() => void>;
}

interface VariantStyle {
  accent: string;
  tintPercent: number;
  role: "alert" | "status";
  live: "assertive" | "polite";
}

const VARIANT_STYLES: Record<ApplicationNoticeVariant, VariantStyle> = {
  error: {
    accent: "var(--color-vermilion)",
    tintPercent: 5,
    role: "alert",
    live: "assertive",
  },
  outage: {
    accent: "var(--color-vermilion)",
    tintPercent: 12,
    role: "alert",
    live: "assertive",
  },
  warning: {
    accent: "var(--color-mustard)",
    tintPercent: 10,
    role: "status",
    live: "polite",
  },
};

const TITLES: Record<AppError["code"], string> = {
  VALIDATION_FAILED: "Check the details",
  AUTHENTICATION_REQUIRED: "Sign in required",
  AUTHENTICATION_FAILED: "Sign-in could not be verified",
  PERMISSION_DENIED: "Access not available",
  NOT_FOUND: "No longer available",
  CONFLICT: "Something changed",
  RATE_LIMITED: "The room needs a moment",
  TIMEOUT: "The request took too long",
  NETWORK_UNAVAILABLE: "Connection interrupted",
  CONFIGURATION_ERROR: "Setup needs attention",
  PROVIDER_ERROR: "The room could not answer",
  MALFORMED_RESPONSE: "The response could not be read",
  INTERNAL_ERROR: "Twyne could not complete that",
};

export const ApplicationNotice = component$((props: ApplicationNoticeProps) => {
  const showRetry = props.error.recovery.canRetry && !!props.onRetry$;
  const showRecovery =
    !!props.recoveryLabel && (!!props.recoveryHref || !!props.onRecovery$);
  const variant = VARIANT_STYLES[props.variant ?? "error"];

  return (
    <section
      class={`border text-[var(--color-ink)] ${props.compact ? "p-2.5" : "p-3.5"}`}
      style={{
        borderRadius: "2px",
        borderColor: variant.accent,
        backgroundColor: `color-mix(in srgb, ${variant.accent} ${variant.tintPercent}%, var(--color-paper))`,
      }}
      role={variant.role}
      aria-live={variant.live}
      aria-atomic="true"
      data-app-error={props.error.code}
      data-variant={props.variant ?? "error"}
    >
      <div class="flex items-start gap-3">
        <span
          class="mt-0.5 text-base leading-none"
          style={{ fontFamily: "var(--font-display)", color: variant.accent }}
          aria-hidden="true"
        >
          !
        </span>
        <div class="min-w-0 flex-1">
          <p
            class={
              props.compact ? "text-xs font-semibold" : "text-sm font-semibold"
            }
            style={{ fontFamily: "var(--font-display)" }}
          >
            {props.title ?? TITLES[props.error.code]}
          </p>
          <p
            class={`mt-1 leading-relaxed text-[var(--color-ink-light)] ${
              props.compact ? "text-[0.7rem]" : "text-[0.8rem]"
            }`}
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {props.error.message}
          </p>

          {(showRetry || showRecovery) && (
            <div class="mt-3 flex flex-wrap items-center gap-2">
              {showRetry && (
                <button
                  type="button"
                  class="btn-press text-xs"
                  onClick$={() => props.onRetry$?.()}
                  disabled={props.busy}
                >
                  {props.busy ? "Trying again…" : "Try again"}
                </button>
              )}
              {showRecovery && props.recoveryHref && (
                <Link class="btn-paper text-xs" href={props.recoveryHref}>
                  {props.recoveryLabel}
                </Link>
              )}
              {showRecovery && !props.recoveryHref && (
                <button
                  type="button"
                  class="btn-paper text-xs"
                  onClick$={() => props.onRecovery$?.()}
                >
                  {props.recoveryLabel}
                </button>
              )}
            </div>
          )}

          {props.error.referenceId && (
            <p
              class="mt-2 break-all text-[0.6rem] tracking-[0.08em] text-[var(--color-ink-muted)]"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Reference {props.error.referenceId}
            </p>
          )}
          {props.error.recovery.retryAfterMs !== undefined && (
            <p
              class="mt-2 text-[0.65rem] text-[var(--color-ink-muted)]"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Try again in about{" "}
              {Math.max(1, Math.ceil(props.error.recovery.retryAfterMs / 1000))}{" "}
              seconds.
            </p>
          )}
        </div>
        {props.onDismiss$ && (
          <button
            type="button"
            class="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] focus-ring"
            onClick$={() => props.onDismiss$?.()}
            aria-label="Dismiss error"
          >
            Close
          </button>
        )}
      </div>
    </section>
  );
});
