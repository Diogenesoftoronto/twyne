import { $, component$, useSignal, type QRL } from "@qwik.dev/core";
import { useTranslate } from "gt-qwik";

/**
 * Product views for the landing walkthroughs. They are drawn from the Twyne
 * Publishing prototypes (twyne-publishing-lab/prototypes) with the same cast
 * and sample content, and they are interactive in the small ways the
 * prototypes are: a fix changes the passage, the count and the button
 * together. Nothing here talks to a server or stores anything.
 *
 * Interface chrome goes through the landing dictionary. The sample documents
 * (the Fieldnote changelog, Marsh Lane's notice, Ines Calder's novel) are
 * English-language publications, so they stay in English and carry
 * `lang="en"`.
 */

export interface JourneyViewProps {
  /** Moves the walkthrough to its next step, for buttons that would. */
  onAdvance$?: QRL<() => void>;
}

const reduceMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The thin product bar every view sits under. */
const Bar = ({ crumbs, who }: { crumbs: string[]; who?: string }) => (
  <div class="jv-bar">
    <span class="jv-bar__mark">Twyne</span>
    <span class="jv-bar__crumbs" lang="en">
      {crumbs.map((crumb, index) => (
        <span key={index} class={index === crumbs.length - 1 ? "is-here" : ""}>
          {crumb}
        </span>
      ))}
    </span>
    {who && <span class="jv-bar__who">{who}</span>}
  </div>
);

const Chip = ({
  tone = "plain",
  children,
}: {
  tone?: "plain" | "ok" | "warn" | "rule";
  children: string | number;
}) => <span class={`jv-chip jv-chip--${tone}`}>{children}</span>;

/* ───────────────────────── Fieldnote ───────────────────────── */

export const FieldnoteArrival = component$<JourneyViewProps>(
  ({ onAdvance$ }) => {
    const t = useTranslate();
    const post = useSignal(true);
    const voice = useSignal(true);
    const reply = useSignal(true);
    const carried =
      3 + Number(post.value) + Number(voice.value) + Number(reply.value);

    const locked = [
      {
        label: t("view.f1.app"),
        value: "Fieldnote, “A field notebook for ecologists.”",
      },
      { label: t("view.f1.blog"), value: t("view.f1.blogValue") },
      { label: t("view.f1.domain"), value: t("view.f1.domainValue") },
    ];
    const optional = [
      {
        id: "post",
        label: t("view.f1.post"),
        value: t("view.f1.postValue"),
        on: post,
      },
      {
        id: "voice",
        label: t("view.f1.voice"),
        value: t("view.f1.voiceValue"),
        on: voice,
      },
      {
        id: "reply",
        label: t("view.f1.reply"),
        value: "hello@fieldnote.app",
        on: reply,
      },
    ];

    return (
      <div class="jv">
        <Bar crumbs={["Publishing"]} who="maya@fieldnote.app" />
        <div class="jv-body">
          <p class="jv-title">{t("view.f1.title")}</p>
          <p class="jv-sub">{t("view.f1.sub")}</p>
          <fieldset class="jv-slip">
            <legend class="jv-kicker">{t("view.f1.slip")}</legend>
            {locked.map((row) => (
              <div key={row.label} class="jv-slip__row">
                <span class="jv-check is-locked" aria-hidden="true">
                  ✓
                </span>
                <span>
                  <span class="jv-slip__label">
                    {row.label} · {t("view.required")}
                  </span>
                  <span class="jv-slip__value">{row.value}</span>
                </span>
              </div>
            ))}
            {optional.map((row) => (
              <label key={row.id} class="jv-slip__row is-optional">
                <input
                  type="checkbox"
                  class="jv-checkbox"
                  checked={row.on.value}
                  onChange$={(_, el) => (row.on.value = el.checked)}
                />
                <span>
                  <span class="jv-slip__label">{row.label}</span>
                  <span
                    class={["jv-slip__value", row.on.value ? "" : "is-off"]}
                  >
                    {row.value}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <div class="jv-actions">
            <button
              type="button"
              class="jv-btn jv-btn--primary"
              onClick$={onAdvance$}
            >
              {t("view.f1.open")}
            </button>
            <span class="jv-muted" aria-live="polite">
              {t("view.f1.carried", { count: carried })}
            </span>
          </div>
        </div>
      </div>
    );
  },
);

export const FieldnoteDesk = component$<JourneyViewProps>(({ onAdvance$ }) => {
  const t = useTranslate();
  const active = useSignal(false);
  return (
    <div class="jv">
      <Bar crumbs={["Fieldnote", "Fieldnote Journal"]} who="ML" />
      <div class="jv-body jv-split">
        <div>
          <div class="jv-row-between">
            <p class="jv-title">Fieldnote Journal</p>
            <button
              type="button"
              class="jv-btn jv-btn--primary"
              onClick$={onAdvance$}
            >
              {t("view.f2.newPost")}
            </button>
          </div>
          <p class="jv-kicker jv-mt">{t("view.f2.posts")}</p>
          <ul class="jv-list">
            <li class="jv-list__item">
              <span>
                <span class="jv-list__title" lang="en">
                  What’s new in November: offline sightings
                </span>
                <span class="jv-list__meta">{t("view.f2.changelogMeta")}</span>
              </span>
              <Chip>{t("view.draft")}</Chip>
            </li>
            <li class="jv-list__item">
              <span>
                <span class="jv-list__title" lang="en">
                  Introducing Fieldnote
                </span>
                <span class="jv-list__meta">{t("view.f2.postMeta")}</span>
              </span>
              <Chip tone="ok">{t("view.f2.published")}</Chip>
            </li>
          </ul>
        </div>
        <aside class="jv-side">
          <dl class="jv-facts">
            <div>
              <dt>{t("view.f2.address")}</dt>
              <dd>
                fieldnote.app/blog <Chip tone="ok">{t("view.linked")}</Chip>
              </dd>
            </div>
            <div>
              <dt>{t("view.f2.feed")}</dt>
              <dd>/blog/feed.xml</dd>
            </div>
          </dl>
          <div class="jv-card">
            <p class="jv-kicker">{t("view.f2.styleBook")}</p>
            <p class="jv-card__body">
              {active.value
                ? t("view.f2.voiceActive")
                : t("view.f2.voiceDraft")}
            </p>
            {active.value ? (
              <Chip tone="ok">{t("view.f2.active")}</Chip>
            ) : (
              <button
                type="button"
                class="jv-btn"
                onClick$={() => (active.value = true)}
              >
                {t("view.f2.switchOn")}
              </button>
            )}
          </div>
          <p class="jv-kicker jv-mt">{t("view.f2.templates")}</p>
          <p class="jv-muted">{t("view.f2.templateList")}</p>
        </aside>
      </div>
    </div>
  );
});

type Finding = "open" | "fixed" | "kept";

export const FieldnoteReleaseCheck = component$<JourneyViewProps>(
  ({ onAdvance$ }) => {
    const t = useTranslate();
    const term = useSignal<Finding>("open");
    const banned = useSignal<Finding>("open");
    const left =
      Number(term.value === "open") + Number(banned.value === "open");

    const card = (
      state: Finding,
      kind: string,
      title: string,
      body: string,
      fix: string,
      onFix: QRL<() => void>,
      onKeep: QRL<() => void>,
    ) => (
      <div class={["jv-finding", state !== "open" ? "is-done" : ""]}>
        <div class="jv-row-between">
          <span class="jv-kicker">{kind}</span>
          <Chip tone="rule">{t("view.rule")}</Chip>
        </div>
        <p class="jv-finding__title">{title}</p>
        {state === "open" ? (
          <>
            <p class="jv-finding__body">{body}</p>
            <div class="jv-actions jv-actions--tight">
              <button type="button" class="jv-btn" onClick$={onFix}>
                {fix}
              </button>
              <button type="button" class="jv-link" onClick$={onKeep}>
                {t("view.keepOnPurpose")}
              </button>
            </div>
          </>
        ) : (
          <p class="jv-finding__body">
            ✓ {state === "fixed" ? t("view.fixed") : t("view.keptOnPurpose")}
          </p>
        )}
      </div>
    );

    return (
      <div class="jv">
        <Bar crumbs={["Fieldnote Journal", "What’s new in November"]} />
        <div class="jv-body jv-split jv-split--check">
          <aside class="jv-panel">
            <p class="jv-count" aria-live="polite">
              {left > 0
                ? t("view.f3.toFix", { count: left })
                : t("view.f3.ready")}
            </p>
            <p class="jv-muted">
              {left > 0 ? t("view.f3.toFixSub") : t("view.f3.readySub")}
            </p>
            <p class="jv-kicker jv-mt">{t("view.f3.mustFix")}</p>
            {card(
              term.value,
              t("view.f3.term"),
              t("view.f3.termTitle"),
              t("view.f3.termBody"),
              t("view.f3.termFix"),
              $(() => {
                term.value = "fixed";
              }),
              $(() => {
                term.value = "kept";
              }),
            )}
            {card(
              banned.value,
              t("view.f3.banned"),
              t("view.f3.bannedTitle"),
              t("view.f3.bannedBody"),
              t("view.f3.bannedFix"),
              $(() => {
                banned.value = "fixed";
              }),
              $(() => {
                banned.value = "kept";
              }),
            )}
            <p class="jv-kicker jv-mt">{t("view.prefer")}</p>
            <div class="jv-finding jv-finding--prefer">
              <div class="jv-row-between">
                <span class="jv-kicker">{t("view.f3.voice")}</span>
                <Chip tone="rule">Jev .81</Chip>
              </div>
              <p class="jv-finding__title">{t("view.f3.voiceTitle")}</p>
              <p class="jv-finding__body">{t("view.f3.voiceBody")}</p>
            </div>
            <p class="jv-fine">{t("view.f3.pinned")}</p>
            <button
              type="button"
              class="jv-btn jv-btn--primary"
              disabled={left > 0}
              onClick$={onAdvance$}
            >
              {t("view.f3.publish")}
            </button>
          </aside>
          <article class="jv-page" lang="en">
            <p class="jv-page__meta">{t("view.f3.docMeta")}</p>
            <p class="jv-page__title">
              What’s new in November: offline sightings
            </p>
            <p>
              <b>What changed.</b> Fieldnote now saves sightings{" "}
              {banned.value === "fixed" ? null : (
                <>
                  <span
                    class={[
                      "jv-mark",
                      banned.value === "open" ? "jv-mark--must" : "",
                    ]}
                  >
                    seamlessly
                  </span>{" "}
                </>
              )}
              when you have no signal, and files them when you are back in
              range. Each one keeps the time and place you spoke it, not the
              time it uploaded.
            </p>
            <p>
              <b>Who it is for.</b> Anyone who logs in marshes, forests or on
              the water. You do not need to change a setting. If you{" "}
              <span
                key={term.value}
                class={[
                  "jv-mark",
                  term.value === "open" ? "jv-mark--must" : "",
                  term.value === "fixed" ? "jv-flash" : "",
                ]}
              >
                {term.value === "fixed" ? "sign in" : "log in"}
              </span>{" "}
              on a second phone, both phones share the same queue.
            </p>
            <p>
              <b>What to do.</b> Update the app from your store.{" "}
              <span class="jv-mark jv-mark--prefer">
                If a sighting looks wrong after it files, open it, correct the
                species or place, and the weather for that hour is fetched again
                so the log stays accurate for later export.
              </span>{" "}
              Write to hello@fieldnote.app with anything we got wrong.
            </p>
          </article>
        </div>
      </div>
    );
  },
);

type ReleaseState = "ready" | "publishing" | "checking" | "live";

export const FieldnoteRelease = component$<JourneyViewProps>(() => {
  const t = useTranslate();
  const state = useSignal<ReleaseState>("ready");
  const share = useSignal(true);

  const publish = $(() => {
    if (state.value !== "ready") return;
    if (reduceMotion()) {
      state.value = "live";
      return;
    }
    state.value = "publishing";
    setTimeout(() => (state.value = "checking"), 700);
    setTimeout(() => (state.value = "live"), 1500);
  });

  return (
    <div class="jv">
      <Bar crumbs={["Fieldnote Journal", "What’s new in November"]} who="ML" />
      <div class="jv-body jv-split">
        <div>
          <p class="jv-title">{t("view.f4.title")}</p>
          <div class="jv-preview" lang="en">
            <span class="jv-preview__url">
              fieldnote.app/blog/whats-new-in-november
            </span>
            <div class="jv-preview__page">
              <span class="jv-preview__brand">Fieldnote Journal</span>
              <span class="jv-preview__title">
                What’s new in November: offline sightings
              </span>
              <span class="jv-preview__text">
                Fieldnote now saves sightings when you have no signal, and files
                them when you are back in range.
              </span>
            </div>
          </div>
          <p class="jv-field-label">{t("view.f4.address")}</p>
          <p class="jv-field" lang="en">
            <span class="jv-muted">fieldnote.app/blog/</span>
            whats-new-in-november
          </p>
          <label class="jv-toggle-row">
            <input
              type="checkbox"
              class="jv-checkbox"
              checked={share.value}
              disabled={state.value !== "ready"}
              onChange$={(_, el) => (share.value = el.checked)}
            />
            <span>{t("view.f4.bluesky")}</span>
          </label>
          <div class="jv-actions" aria-live="polite">
            {state.value === "live" ? (
              <span class="jv-status jv-status--ok">
                ● {t("view.live")} · {t("view.f4.liveAt")}
              </span>
            ) : (
              <button
                type="button"
                class="jv-btn jv-btn--primary"
                disabled={state.value !== "ready"}
                onClick$={publish}
              >
                {state.value === "ready"
                  ? t("view.f4.publishNow")
                  : state.value === "publishing"
                    ? `${t("view.f4.publishing")}…`
                    : `${t("view.f4.checking")}…`}
              </button>
            )}
          </div>
        </div>
        <aside class="jv-side">
          <div class="jv-card">
            <p class="jv-kicker">{t("view.f4.checked")}</p>
            <p class="jv-card__body">{t("view.f4.checkedValue")}</p>
            <p class="jv-muted">{t("view.f4.checkedNote")}</p>
          </div>
          <div class="jv-card">
            <p class="jv-kicker">{t("view.f4.where")}</p>
            <ul class="jv-bullets">
              <li>fieldnote.app/blog</li>
              <li>{t("view.f4.feed")}</li>
              <li>{t("view.f4.discovery")}</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
});

/* ───────────────────────── Marsh Lane ───────────────────────── */

type Proposal = "proposed" | "kept" | "dropped";

export const MarshStyleBook = component$<JourneyViewProps>(() => {
  const t = useTranslate();
  const rule1 = useSignal<Proposal>("proposed");
  const rule2 = useSignal<Proposal>("proposed");
  const active = useSignal(false);

  const rules = [
    {
      key: "r1",
      state: rule1,
      strength: t("view.must"),
      from: t("view.m1.fromPieces", { count: 9 }),
      text: t("view.m1.rule1"),
      source: "Why we are closing the east boardwalk",
      quote: "We know many of you walk it daily.",
    },
    {
      key: "r2",
      state: rule2,
      strength: t("view.prefer"),
      from: t("view.m1.fromPieces", { count: 6 }),
      text: t("view.m1.rule2"),
      source: "Spring count: 212 volunteers, 61 species",
      quote: "At the north pond, two great crested grebes…",
    },
  ];

  return (
    <div class="jv">
      <Bar
        crumbs={["Marsh Lane Land Trust", "Style book"]}
        who={t("view.m1.who")}
      />
      <div class="jv-body">
        <div class="jv-row-between">
          <p class="jv-title">{t("view.m1.title")}</p>
          <Chip tone={active.value ? "ok" : "plain"}>
            {active.value ? t("view.m1.active") : t("view.m1.notActive")}
          </Chip>
        </div>
        <p class="jv-sub">{t("view.m1.learned")}</p>
        <div class="jv-split jv-split--even">
          <div>
            <p class="jv-kicker">{t("view.m1.voice")}</p>
            {rules.map((rule) => (
              <div
                key={rule.key}
                class={[
                  "jv-proposal",
                  rule.state.value === "dropped" ? "is-dropped" : "",
                ]}
              >
                <p class="jv-proposal__meta">
                  <Chip tone="warn">{rule.strength}</Chip> {rule.from}
                </p>
                <p class="jv-proposal__text">{rule.text}</p>
                <p class="jv-proposal__quote" lang="en">
                  <i>{rule.source}</i>: “{rule.quote}”
                </p>
                {rule.state.value === "proposed" ? (
                  <div class="jv-actions jv-actions--tight">
                    <button
                      type="button"
                      class="jv-btn"
                      disabled={active.value}
                      onClick$={() => (rule.state.value = "kept")}
                    >
                      {t("view.m1.keep")}
                    </button>
                    <button
                      type="button"
                      class="jv-link"
                      disabled={active.value}
                      onClick$={() => (rule.state.value = "dropped")}
                    >
                      {t("view.m1.drop")}
                    </button>
                  </div>
                ) : (
                  <p class="jv-muted">
                    {rule.state.value === "kept"
                      ? `✓ ${t("view.m1.kept")}`
                      : t("view.m1.dropped")}
                  </p>
                )}
              </div>
            ))}
          </div>
          <div>
            <p class="jv-kicker">{t("view.m1.terms")}</p>
            <table class="jv-table">
              <thead>
                <tr>
                  <th scope="col">{t("view.m1.use")}</th>
                  <th scope="col">{t("view.m1.insteadOf")}</th>
                </tr>
              </thead>
              <tbody lang="en">
                <tr>
                  <td>Marsh Lane</td>
                  <td>Marshlane, MLLT</td>
                </tr>
                <tr>
                  <td>wetland</td>
                  <td>swamp, except in quotes</td>
                </tr>
                <tr>
                  <td>volunteer</td>
                  <td>vol</td>
                </tr>
              </tbody>
            </table>
            <p class="jv-kicker jv-mt">{t("view.m1.bannedPhrases")}</p>
            <p class="jv-tags" lang="en">
              <span>“leverage”</span>
              <span>“stakeholders”</span>
              <span>“game-changer”</span>
            </p>
          </div>
        </div>
        <div class="jv-actions" aria-live="polite">
          {active.value ? (
            <span class="jv-status jv-status--ok">
              ✓ {t("view.m1.activated")}
            </span>
          ) : (
            <button
              type="button"
              class="jv-btn jv-btn--primary"
              onClick$={() => (active.value = true)}
            >
              {t("view.m1.activate")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

type Approval = "requested" | "approved" | "changes";

export const MarshReview = component$<JourneyViewProps>(() => {
  const t = useTranslate();
  const state = useSignal<Approval>("requested");
  return (
    <div class="jv">
      <Bar
        crumbs={["Marsh Lane", "Notes from the Marsh", "Boardwalk reopens"]}
        who={t("view.m2.who")}
      />
      <div class="jv-body jv-split jv-split--check">
        <aside class="jv-panel">
          <p class="jv-title jv-title--sm">{t("view.m2.asks")}</p>
          <p class="jv-quote" lang="en">
            “Dates confirmed with the township this morning.”
          </p>
          <dl class="jv-facts jv-facts--grid">
            <div>
              <dt>{t("view.m2.revision")}</dt>
              <dd>4</dd>
            </div>
            <div>
              <dt>{t("view.m2.goesTo")}</dt>
              <dd>Notes from the Marsh, marshlane.org/news</dd>
            </div>
            <div>
              <dt>{t("view.m2.checkedAgainst")}</dt>
              <dd>Style book v1 · Blog post v1</dd>
            </div>
            <div>
              <dt>{t("view.m2.releaseCheck")}</dt>
              <dd>{t("view.m2.passed")}</dd>
            </div>
          </dl>
          <div aria-live="polite">
            {state.value === "requested" ? (
              <div class="jv-actions jv-actions--stack">
                <button
                  type="button"
                  class="jv-btn jv-btn--primary"
                  onClick$={() => (state.value = "approved")}
                >
                  {t("view.m2.approve")}
                </button>
                <button
                  type="button"
                  class="jv-btn"
                  onClick$={() => (state.value = "changes")}
                >
                  {t("view.m2.askChanges")}
                </button>
              </div>
            ) : (
              <p
                class={[
                  "jv-status",
                  state.value === "approved"
                    ? "jv-status--ok"
                    : "jv-status--warn",
                ]}
              >
                {state.value === "approved"
                  ? `✓ ${t("view.m2.approved")}`
                  : t("view.m2.changes")}
              </p>
            )}
          </div>
        </aside>
        <article class="jv-page" lang="en">
          <p class="jv-page__meta">{t("view.m2.docMeta")}</p>
          <p class="jv-page__title">The boardwalk reopens on December 6</p>
          <p>
            The east boardwalk closes for the last time on Friday and reopens on
            Saturday, December 6, from 8 a.m. The new deck sits 40 centimetres
            higher, above the spring flood line.
            {state.value === "changes" && (
              <span class="jv-margin-note">Tomás: {t("view.m2.note")}</span>
            )}
          </p>
          <p>
            “We used to call it the swamp walk,” said Ellen Marsh, who has lived
            on Marsh Lane for 52 years. “Now my grandchildren can do it in
            rubber boots.”
          </p>
          <p>
            The heron cam moves to the new viewing platform the same week. See
            the route on the reserve map.
          </p>
        </article>
      </div>
    </div>
  );
});

export const MarshPublications = component$<JourneyViewProps>(() => {
  const t = useTranslate();
  const live = useSignal(false);
  const paused = useSignal(false);
  return (
    <div class="jv">
      <Bar
        crumbs={["Marsh Lane Land Trust", "Publications"]}
        who={t("view.m3.who")}
      />
      <div class="jv-body">
        <p class="jv-title">{t("view.m3.title")}</p>
        <p class="jv-kicker jv-mt">{t("view.m3.ready")}</p>
        <ul class="jv-list">
          <li class="jv-list__item">
            <span>
              <span class="jv-list__title" lang="en">
                The boardwalk reopens on December 6
              </span>
              <span class="jv-list__meta">
                Notes from the Marsh · June Park · {t("view.m3.approvedBy")}
              </span>
            </span>
            <span aria-live="polite">
              {live.value ? (
                <Chip tone="ok">{t("view.live")}</Chip>
              ) : (
                <button
                  type="button"
                  class="jv-btn jv-btn--primary"
                  onClick$={() => (live.value = true)}
                >
                  {t("view.m3.publish")}
                </button>
              )}
            </span>
          </li>
          <li class="jv-list__item">
            <span>
              <span class="jv-list__title" lang="en">
                Annual Report 2026: foreword
              </span>
              <span class="jv-list__meta">
                Annual Report · Ada Brennan · {t("view.m3.approvedBy")}
              </span>
            </span>
            <span aria-live="polite">
              {paused.value ? (
                <Chip tone="warn">{t("view.m3.paused")}</Chip>
              ) : (
                <button
                  type="button"
                  class="jv-btn"
                  onClick$={() => (paused.value = true)}
                >
                  {t("view.m3.publish")}
                </button>
              )}
            </span>
          </li>
        </ul>
        <table class="jv-table jv-mt">
          <thead>
            <tr>
              <th scope="col">{t("view.m3.publication")}</th>
              <th scope="col">{t("view.m3.address")}</th>
              <th scope="col">{t("view.m3.styleBook")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <span class="jv-swatch jv-swatch--green" aria-hidden="true" />
                Notes from the Marsh
              </td>
              <td>
                marshlane.org/news <Chip tone="ok">{t("view.linked")}</Chip>
              </td>
              <td>v1</td>
            </tr>
            <tr>
              <td>
                <span class="jv-swatch jv-swatch--green" aria-hidden="true" />
                Annual Report
              </td>
              <td>
                reports.marshlane.org{" "}
                <Chip tone="warn">{t("view.m3.connecting")}</Chip>
              </td>
              <td>v1</td>
            </tr>
            <tr>
              <td>
                <span class="jv-swatch jv-swatch--red" aria-hidden="true" />
                Press
              </td>
              <td>
                marshlane.org/press <Chip tone="ok">{t("view.linked")}</Chip>
              </td>
              <td>{t("view.m3.pressRules")}</td>
            </tr>
          </tbody>
        </table>
        <p class="jv-note">{t("view.m3.accent")}</p>
      </div>
    </div>
  );
});

type DomainState = "waiting" | "checking" | "linked";

export const MarshDomain = component$<JourneyViewProps>(() => {
  const t = useTranslate();
  const state = useSignal<DomainState>("waiting");
  const linked = state.value === "linked";

  const check = $(() => {
    if (state.value !== "waiting") return;
    if (reduceMotion()) {
      state.value = "linked";
      return;
    }
    state.value = "checking";
    setTimeout(() => (state.value = "linked"), 900);
  });

  const rows = [
    { title: t("view.m4.c1"), note: t("view.m4.c1Ok"), ok: true },
    { title: t("view.m4.c2"), note: t("view.m4.c2Ok"), ok: true },
    {
      title: t("view.m4.c3"),
      note: linked ? t("view.m4.c3Ok") : t("view.m4.c3Wait"),
      ok: linked,
    },
    {
      title: t("view.m4.c4"),
      note: linked ? t("view.m4.c4Ok") : t("view.m4.c4Wait"),
      ok: linked,
    },
  ];

  return (
    <div class="jv">
      <Bar
        crumbs={["Marsh Lane", "Annual Report", "Address"]}
        who="Ada · owner"
      />
      <div class="jv-body">
        <div class="jv-row-between">
          <p class="jv-title">{t("view.m4.title")}</p>
          <Chip tone={linked ? "ok" : "warn"}>
            {linked ? t("view.linked") : t("view.m4.waiting")}
          </Chip>
        </div>
        <p class="jv-sub">{t("view.m4.sub")}</p>
        <ol class="jv-checks">
          {rows.map((row, index) => (
            <li key={index} class={row.ok ? "is-ok" : "is-waiting"}>
              <span class="jv-checks__mark" aria-hidden="true">
                {row.ok ? "✓" : "…"}
              </span>
              <span>
                <span class="jv-checks__title">{row.title}</span>
                <span class="jv-checks__note">{row.note}</span>
              </span>
            </li>
          ))}
        </ol>
        <p class="jv-fine" lang="en">
          https://reports.marshlane.org/.well-known/site.standard.publication
        </p>
        <div class="jv-actions" aria-live="polite">
          {linked ? (
            <span class="jv-status jv-status--ok">
              ✓ {t("view.m4.linkedNote")}
            </span>
          ) : (
            <button
              type="button"
              class="jv-btn jv-btn--primary"
              disabled={state.value === "checking"}
              onClick$={check}
            >
              {state.value === "checking"
                ? t("view.m4.checking")
                : t("view.m4.checkNow")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

/* ───────────────────────── The Orchard at Low Water ───────────────────────── */

export const OrchardReadiness = component$<JourneyViewProps>(
  ({ onAdvance$ }) => {
    const t = useTranslate();
    const names = useSignal(false);
    const front = useSignal(false);
    const frozen = useSignal(false);
    const ready = 4 + Number(names.value) + Number(front.value);

    return (
      <div class="jv">
        <Bar crumbs={["Library", "The Orchard at Low Water"]} who="IC" />
        <div class="jv-body">
          <p class="jv-kicker">{t("view.i1.meta")}</p>
          <p class="jv-title" lang="en">
            The Orchard at Low Water
          </p>
          <p class="jv-sub">{t("view.i1.intro")}</p>
          <p class="jv-count jv-count--sm" aria-live="polite">
            {t("view.i1.lookReady", { count: ready })}
          </p>
          <ul class="jv-ready">
            <li class="is-ok">
              <span class="jv-ready__label">{t("view.i1.chapters")}</span>
              <span>{t("view.i1.chaptersValue")}</span>
            </li>
            <li class="is-ok">
              <span class="jv-ready__label">{t("view.i1.length")}</span>
              <span>{t("view.i1.lengthValue")}</span>
            </li>
            <li class={names.value ? "is-ok" : "is-look"}>
              <span class="jv-ready__label">{t("view.i1.names")}</span>
              <span>
                {names.value
                  ? t("view.i1.namesFixed")
                  : t("view.i1.namesValue")}
                {!names.value && (
                  <button
                    type="button"
                    class="jv-btn jv-btn--inline"
                    disabled={frozen.value}
                    onClick$={() => (names.value = true)}
                  >
                    {t("view.i1.namesFix")}
                  </button>
                )}
              </span>
            </li>
            <li class="is-look">
              <span class="jv-ready__label">{t("view.i1.notes")}</span>
              <span>{t("view.i1.notesValue")}</span>
            </li>
            <li class="is-ok">
              <span class="jv-ready__label">{t("view.i1.proof")}</span>
              <span>{t("view.i1.proofValue")}</span>
            </li>
            <li class={front.value ? "is-ok" : "is-look"}>
              <span class="jv-ready__label">{t("view.i1.front")}</span>
              <span>
                {front.value
                  ? t("view.i1.frontFixed")
                  : t("view.i1.frontValue")}
                {!front.value && (
                  <button
                    type="button"
                    class="jv-btn jv-btn--inline"
                    disabled={frozen.value}
                    onClick$={() => (front.value = true)}
                  >
                    {t("view.i1.frontFix")}
                  </button>
                )}
              </span>
            </li>
          </ul>
          <div class="jv-actions" aria-live="polite">
            {frozen.value ? (
              <>
                <span class="jv-status jv-status--ok">
                  ✓ {t("view.i1.frozen")}
                </span>
                <button type="button" class="jv-btn" onClick$={onAdvance$}>
                  {t("walk.next")} →
                </button>
              </>
            ) : (
              <button
                type="button"
                class="jv-btn jv-btn--primary"
                onClick$={() => (frozen.value = true)}
              >
                {t("view.i1.freeze")}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  },
);

export const OrchardReaders = component$<JourneyViewProps>(() => {
  const t = useTranslate();
  const invite = useSignal(true);
  const panel = useSignal(false);
  const pilot = useSignal(false);
  const created = useSignal(false);
  return (
    <div class="jv">
      <Bar crumbs={["The Orchard at Low Water", "Test readers"]} who="IC" />
      <div class="jv-body">
        <div class="jv-row-between">
          <p class="jv-title">{t("view.i2.title")}</p>
          <Chip>{t("view.i2.meta")}</Chip>
        </div>
        <div class="jv-split jv-split--even">
          <section>
            <p class="jv-kicker">1 · {t("view.i2.ask")}</p>
            <p class="jv-muted">{t("view.i2.askMeta")}</p>
            <ol class="jv-questions">
              <li>{t("view.i2.q1")}</li>
              <li>{t("view.i2.q2")}</li>
              <li>{t("view.i2.q3")}</li>
            </ol>
            <p class="jv-fine">
              {t("view.i2.excerpts")} · {t("view.i2.wholeBook")}
            </p>
            <p class="jv-fine">{t("view.i2.excerptNote")}</p>
          </section>
          <section>
            <p class="jv-kicker">2 · {t("view.i2.who")}</p>
            <label class="jv-option">
              <input
                type="checkbox"
                class="jv-checkbox"
                checked={invite.value}
                disabled={created.value}
                onChange$={(_, el) => (invite.value = el.checked)}
              />
              <span>
                <span class="jv-option__title">{t("view.i2.invite")}</span>
                <span class="jv-option__note">{t("view.i2.inviteNote")}</span>
              </span>
            </label>
            <label class="jv-option">
              <input
                type="checkbox"
                class="jv-checkbox"
                checked={panel.value}
                disabled={created.value}
                onChange$={(_, el) => (panel.value = el.checked)}
              />
              <span>
                <span class="jv-option__title">{t("view.i2.panel")}</span>
                <span class="jv-option__note">{t("view.i2.panelNote")}</span>
              </span>
            </label>
            <label class="jv-option">
              <input
                type="checkbox"
                class="jv-checkbox"
                checked={pilot.value}
                disabled={created.value}
                onChange$={(_, el) => (pilot.value = el.checked)}
              />
              <span>
                <span class="jv-option__title">{t("view.i2.pilot")}</span>
                <span class="jv-option__note">{t("view.i2.pilotNote")}</span>
              </span>
            </label>
          </section>
        </div>
        <div class="jv-actions" aria-live="polite">
          {created.value ? (
            <span class="jv-status jv-status--ok">
              ✓ {t("view.i2.created")}
            </span>
          ) : (
            <button
              type="button"
              class="jv-btn jv-btn--primary"
              disabled={!invite.value && !panel.value}
              onClick$={() => (created.value = true)}
            >
              {t("view.i2.create")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

const KEEP_READING = [
  { ch: 1, mean: 4.3, n: 12 },
  { ch: 2, mean: 4.1, n: 12 },
  { ch: 3, mean: 4.0, n: 12 },
  { ch: 4, mean: 3.1, n: 12 },
  { ch: 5, mean: 3.6, n: 12 },
  { ch: 6, mean: 3.9, n: 12 },
  { ch: 7, mean: 4.1, n: 7 },
];

export const OrchardReaderNotes = component$<JourneyViewProps>(() => {
  const t = useTranslate();
  const decision = useSignal<"open" | "revised" | "kept">("open");
  return (
    <div class="jv">
      <Bar crumbs={["The Orchard at Low Water", "Test readers"]} who="IC" />
      <div class="jv-body">
        <div class="jv-row-between">
          <p class="jv-title">{t("view.i3.title")}</p>
          <span class="jv-pair">
            <Chip>{t("view.i3.readers")}</Chip>
            <Chip>{t("view.i3.simulated")}</Chip>
          </span>
        </div>
        <div class="jv-split jv-split--notes">
          <aside class="jv-panel">
            <p class="jv-kicker">{t("view.i3.keepReading")}</p>
            <table class="jv-table jv-table--chart">
              <thead>
                <tr>
                  <th scope="col">{t("view.i3.chapter")}</th>
                  <th scope="col">{t("view.i3.mean")}</th>
                  <th scope="col">n</th>
                </tr>
              </thead>
              <tbody>
                {KEEP_READING.map((row) => (
                  <tr key={row.ch} class={row.ch === 4 ? "is-dip" : ""}>
                    <td>{row.ch}</td>
                    <td>
                      <span
                        class="jv-bar-fill"
                        style={`--w: ${(row.mean / 5) * 100}%`}
                        aria-hidden="true"
                      />
                      {row.mean.toFixed(1)}
                    </td>
                    <td>{row.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p class="jv-fine">{t("view.i3.chartNote")}</p>
          </aside>
          <div>
            <article class="jv-page" lang="en">
              <p class="jv-page__meta">{t("view.i3.passageMeta")}</p>
              <p>
                The water came up through the orchard the way a rumour comes
                through a town, quietly and then everywhere.
              </p>
              <p>
                <span class="jv-mark jv-mark--reader">
                  Hal had already gone to Kingston by then, or he went the
                  following spring; nobody in the family could agree, and Mira,
                  who was nine, remembered it both ways.
                </span>{" "}
                Their mother kept the ledger anyway.
              </p>
            </article>
            <div class="jv-finding jv-finding--reader">
              <div class="jv-row-between">
                <span class="jv-kicker">{t("view.i3.noteKicker")}</span>
                <Chip>{t("view.i3.noteCount")}</Chip>
              </div>
              <p class="jv-finding__title">{t("view.i3.noteTitle")}</p>
              <p class="jv-finding__body" lang="en">
                “I went back two chapters to check if Hal was gone.”{" "}
                <span class="jv-muted">{t("view.i3.invited")}</span>
              </p>
              <p class="jv-finding__body" lang="en">
                “Wait, is this before or after Kingston?”{" "}
                <span class="jv-muted">{t("view.i3.panelReader")}</span>
              </p>
              <p class="jv-fine">{t("view.i3.source")}</p>
              <div aria-live="polite">
                {decision.value === "open" ? (
                  <div class="jv-actions jv-actions--tight">
                    <button
                      type="button"
                      class="jv-btn"
                      onClick$={() => (decision.value = "revised")}
                    >
                      {t("view.i3.revise")}
                    </button>
                    <button
                      type="button"
                      class="jv-link"
                      onClick$={() => (decision.value = "kept")}
                    >
                      {t("view.i3.deliberate")}
                    </button>
                  </div>
                ) : (
                  <p class="jv-status jv-status--ok">
                    ✓{" "}
                    {decision.value === "revised"
                      ? t("view.i3.revised")
                      : t("view.i3.kept")}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export const OrchardKdp = component$<JourneyViewProps>(() => {
  const t = useTranslate();
  const walk = useSignal(false);
  const rows = [
    [t("view.i4.format"), t("view.i4.formatValue")],
    [t("view.i4.interior"), t("view.i4.interiorValue")],
    [t("view.i4.cover"), t("view.i4.coverValue")],
    [t("view.i4.isbn"), t("view.i4.isbnValue")],
    [t("view.i4.price"), t("view.i4.priceValue")],
  ];
  const files = [
    ["orchard-interior-5.5x8.5.pdf", "312 pp · 1.9 MB"],
    ["orchard-cover-template.pdf", "12.03 × 8.75 in"],
    ["orchard.epub", "1.2 MB"],
    ["orchard-ebook-cover.jpg", "ebook"],
    ["kdp-details.txt", "copy and paste"],
  ];
  return (
    <div class="jv">
      <Bar crumbs={["The Orchard at Low Water", "Amazon KDP"]} who="IC" />
      <div class="jv-body jv-split">
        <div>
          <p class="jv-title">{t("view.i4.title")}</p>
          <ul class="jv-steps-done">
            {rows.map(([label, value]) => (
              <li key={label}>
                <span class="jv-checks__mark" aria-hidden="true">
                  ✓
                </span>
                <span class="jv-steps-done__label">{label}</span>
                <span class="jv-steps-done__value">{value}</span>
              </li>
            ))}
          </ul>
          <div class="jv-package">
            <div class="jv-row-between">
              <p class="jv-title jv-title--sm">{t("view.i4.ready")}</p>
            </div>
            <ul class="jv-files" lang="en">
              {files.map(([name, size]) => (
                <li key={name}>
                  <code>{name}</code>
                  <span class="jv-muted">{size}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              class="jv-btn"
              aria-expanded={walk.value}
              onClick$={() => (walk.value = !walk.value)}
            >
              {t("view.i4.walk")}
            </button>
          </div>
        </div>
        <aside class="jv-side">
          <div class="jv-card">
            <p class="jv-kicker">{t("view.i4.notChecked")}</p>
            <p class="jv-card__body">{t("view.i4.notCheckedBody")}</p>
          </div>
          {walk.value && (
            <div class="jv-card">
              <p class="jv-kicker">{t("view.i4.whereNow")}</p>
              <ol class="jv-bullets jv-bullets--numbered">
                <li>{t("view.i4.downloaded")}</li>
                <li>{t("view.i4.submitted")}</li>
                <li>{t("view.i4.onSale")}</li>
              </ol>
              <p class="jv-fine">{t("view.i4.youSay")}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
});
