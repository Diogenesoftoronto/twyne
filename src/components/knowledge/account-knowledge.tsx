import {
  component$,
  useStore,
  useVisibleTask$,
  useStylesScoped$,
  $,
} from "@qwik.dev/core";
import {
  useAuth,
  hasAuthenticatedConvexIdentity,
} from "../../utils/auth-context";
import {
  accountKnowledgeSnapshot,
  subscribeAccountKnowledge,
  refreshAccountKnowledge,
  chooseAccountSource,
  chooseAccountSearchTool,
  chooseAccountModelTool,
  accountResources,
  readAccountResource,
  knowledgeSetupUrl,
  safeKnowledgeError,
  type AccountResource,
  type AccountKnowledgeSnapshot,
} from "../../utils/account-knowledge";

export const AccountKnowledge = component$(
  ({ compact = false }: { compact?: boolean }) => {
    const auth = useAuth();
    const state = useStore<{
      snapshot: AccountKnowledgeSnapshot;
      setup: string;
      resources: Record<string, AccountResource[]>;
      document: string;
      documentSource: string;
      documentUri: string;
      title: string;
      busy: string;
      error: string;
      alive: boolean;
      request: number;
    }>({
      snapshot: {
        account: null,
        sources: [],
        choices: {},
        loading: false,
        error: "",
      },
      setup: "",
      resources: {},
      document: "",
      documentSource: "",
      documentUri: "",
      title: "",
      busy: "",
      error: "",
      alive: false,
      request: 0,
    });
    useStylesScoped$(`
    .account-knowledge {font-family:var(--font-typewriter);font-size:.8rem;line-height:1.6;color:var(--color-ink);}
    header,.actions {display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;justify-content:space-between;}
    h2 {font-family:var(--font-display);font-size:1rem;margin:0;} p {max-width:65ch;margin:.4rem 0 .8rem;}
    .source {border-top:1px solid var(--color-paper-3);padding:.8rem 0;} .source-name {font-weight:600;overflow-wrap:anywhere;}
    .choices {display:flex;gap:.5rem 1rem;flex-wrap:wrap;margin-top:.3rem;} label {display:flex;gap:.4rem;align-items:center;cursor:pointer;}
    input {accent-color:var(--color-vermilion);} button,a {text-decoration:underline;text-underline-offset:3px;cursor:pointer;color:inherit;}
    button:disabled {opacity:.6;cursor:wait;} button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible {outline:2px solid var(--color-vermilion);outline-offset:3px;}
    .resources {padding:.5rem 0;display:flex;flex-direction:column;gap:.5rem;align-items:flex-start;} .reading {border-top:1px solid var(--color-paper-3);padding-top:.7rem;margin-top:.7rem;}
    pre {white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;max-height:24rem;overflow:auto;} .error {color:var(--color-ink);font-weight:600;} .coming {border-top:1px solid var(--color-paper-3);margin-top:.5rem;padding-top:.5rem;}
    @media (max-width:600px) {
      button,a {display:inline-flex;align-items:center;min-height:44px;padding:.45rem .2rem;}
      label {min-height:44px;min-width:0;overflow-wrap:anywhere;}
      label input {flex-shrink:0;}
      select {min-height:44px;max-width:100%;min-width:0;font-size:1rem;}
      .choices {gap:.25rem .8rem;}
    }
  `);
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup }) => {
      state.alive = true;
      state.setup = knowledgeSetupUrl(location.origin, location.pathname);
      const sync = () => {
        const next = accountKnowledgeSnapshot();
        const accountChanged = next.account !== state.snapshot.account;
        if (next.account !== state.snapshot.account) {
          state.request++;
          state.resources = {};
          state.document = "";
          state.error = "";
          state.busy = "";
        }
        state.resources = Object.fromEntries(
          Object.entries(state.resources).filter(
            ([id]) =>
              next.sources.some((source) => source.id === id) &&
              next.choices[id]?.resources,
          ),
        );
        if (
          state.documentSource &&
          !next.sources.some(
            (source) =>
              source.id === state.documentSource &&
              next.choices[source.id]?.resources,
          )
        )
          state.document = "";
        state.snapshot = next;
        if (accountChanged && next.account) void refreshAccountKnowledge();
      };
      sync();
      const unsubscribe = subscribeAccountKnowledge(sync);
      const refresh = () => {
        void refreshAccountKnowledge();
      };
      window.addEventListener("focus", refresh);
      refresh();
      cleanup(() => {
        state.alive = false;
        state.request++;
        unsubscribe();
        window.removeEventListener("focus", refresh);
      });
    });
    const list = $(async (id: string) => {
      const request = ++state.request,
        account = state.snapshot.account;
      state.busy = id;
      state.error = "";
      try {
        const resources = await accountResources(id);
        if (
          state.alive &&
          request === state.request &&
          account === state.snapshot.account
        )
          state.resources[id] = resources;
      } catch (error) {
        if (state.alive && request === state.request)
          state.error = safeKnowledgeError(error);
      } finally {
        if (state.alive && request === state.request) state.busy = "";
      }
    });
    const read = $(async (id: string, resource: AccountResource) => {
      const request = ++state.request,
        account = state.snapshot.account;
      state.busy = resource.uri;
      state.error = "";
      state.document = "";
      try {
        const document = await readAccountResource(id, resource.uri);
        if (
          state.alive &&
          request === state.request &&
          account === state.snapshot.account &&
          state.snapshot.choices[id]?.resources
        ) {
          state.documentSource = id;
          state.documentUri = resource.uri;
          state.title = `${state.snapshot.sources.find((source) => source.id === id)?.label}: ${resource.title || resource.name}`;
          state.document = document || "This resource contains no text.";
        }
      } catch (error) {
        if (state.alive && request === state.request)
          state.error = safeKnowledgeError(error);
      } finally {
        if (state.alive && request === state.request) state.busy = "";
      }
    });
    const signedIn = hasAuthenticatedConvexIdentity(auth.value);
    return (
      <section class="account-knowledge" aria-label="Account knowledge sources">
        <header>
          <h2>Account sources</h2>
          {signedIn && (
            <div class="actions">
              <button
                disabled={state.snapshot.loading}
                onClick$={() => refreshAccountKnowledge()}
              >
                {state.snapshot.loading
                  ? "Refreshing sources…"
                  : "Refresh sources"}
              </button>
              <a
                href={
                  state.setup || "https://id.notorganic.info/?view=knowledge"
                }
              >
                Manage sharing
              </a>
            </div>
          )}
        </header>
        <p>
          {compact
            ? "Choose what this draft can consult from your Not Organic account."
            : "Bring your notes, documentation, and research into Twyne. Share a connection in Not Organic, then choose how to use it here."}
        </p>
        {!signedIn ? (
          <p>
            Sign in with Not Organic to bring your account sources here.{" "}
            <a href="/settings/#account">Open account settings</a>
          </p>
        ) : (
          <>
            {(state.snapshot.error || state.error) && (
              <p class="error" role="alert">
                {state.snapshot.error || state.error}
              </p>
            )}
            {!state.snapshot.loading &&
              !state.snapshot.error &&
              state.snapshot.sources.length === 0 && (
                <p>
                  No sources shared with Twyne yet.{" "}
                  <a href={state.setup}>Share an account source</a>
                </p>
              )}
            <div aria-busy={state.snapshot.loading}>
              {state.snapshot.sources.map((source) => (
                <div class="source" key={source.id}>
                  <span class="source-name">{source.label}</span>
                  <div class="choices">
                    <label>
                      <input
                        type="checkbox"
                        checked={
                          state.snapshot.choices[source.id]?.research ?? false
                        }
                        disabled={!source.tools.length}
                        onChange$={(_, element) =>
                          chooseAccountSource(
                            source.id,
                            "research",
                            element.checked,
                          )
                        }
                      />
                      Research claims
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={
                          state.snapshot.choices[source.id]?.model ?? false
                        }
                        disabled={!source.tools.length}
                        onChange$={(_, element) =>
                          chooseAccountSource(
                            source.id,
                            "model",
                            element.checked,
                          )
                        }
                      />
                      Offer tools to editors
                    </label>
                    {source.resources_allowed && (
                      <label>
                        <input
                          type="checkbox"
                          checked={
                            state.snapshot.choices[source.id]?.resources ??
                            false
                          }
                          onChange$={(_, element) =>
                            chooseAccountSource(
                              source.id,
                              "resources",
                              element.checked,
                            )
                          }
                        />
                        Browse documents
                      </label>
                    )}
                  </div>
                  {source.tools.length > 0 && (
                    <p>
                      Approved tools:{" "}
                      {source.tools.map((tool) => tool.name).join(", ")}. Every
                      call asks you to review its name and arguments before
                      sending.
                    </p>
                  )}
                  {state.snapshot.choices[source.id]?.model && (
                    <div
                      class="choices"
                      aria-label={`Tools offered from ${source.label}`}
                    >
                      {source.tools.map((tool) => (
                        <label key={tool.name}>
                          <input
                            type="checkbox"
                            checked={
                              state.snapshot.choices[
                                source.id
                              ]?.modelTools?.includes(tool.name) ?? false
                            }
                            onChange$={(_, element) =>
                              chooseAccountModelTool(
                                source.id,
                                tool.name,
                                element.checked,
                              )
                            }
                          />
                          {tool.name}
                        </label>
                      ))}
                    </div>
                  )}
                  {state.snapshot.choices[source.id]?.research && (
                    <label>
                      Research tool{" "}
                      <select
                        value={
                          state.snapshot.choices[source.id]?.searchTool ?? ""
                        }
                        onChange$={(_, element) =>
                          chooseAccountSearchTool(source.id, element.value)
                        }
                      >
                        <option value="">Choose a tool</option>
                        {source.tools.map((tool) => (
                          <option key={tool.name} value={tool.name}>
                            {tool.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {state.snapshot.choices[source.id]?.research && (
                    <p>
                      To use these sources for claim checks, choose “Your MCP
                      servers” as the research provider in Settings.
                    </p>
                  )}
                  {state.snapshot.choices[source.id]?.resources && (
                    <div class="resources">
                      <button
                        disabled={state.busy === source.id}
                        onClick$={() => list(source.id)}
                      >
                        {state.busy === source.id
                          ? "Listing documents…"
                          : "List documents"}
                      </button>
                      {state.resources[source.id]?.map((resource) => {
                        return (
                          <button
                            key={resource.uri}
                            disabled={state.busy === resource.uri}
                            data-source={source.id}
                            data-uri={resource.uri}
                            data-name={resource.name}
                            data-title={resource.title}
                            onClick$={(_, element) =>
                              read(element.dataset.source!, {
                                uri: element.dataset.uri!,
                                name: element.dataset.name!,
                                title: element.dataset.title,
                              })
                            }
                          >
                            {state.busy === resource.uri
                              ? "Reading…"
                              : resource.title || resource.name}
                          </button>
                        );
                      })}
                      {state.resources[source.id]?.length === 0 && (
                        <span>No documents exposed by this source.</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {state.document && (
              <div class="reading">
                <header>
                  <strong>{state.title}</strong>
                  <button
                    onClick$={() => {
                      state.document = "";
                      state.request++;
                    }}
                  >
                    Close document
                  </button>
                </header>
                <p>
                  <code>{state.documentUri}</code>
                </p>
                <pre>{state.document}</pre>
              </div>
            )}
            <p>
              Choices apply to your account on this device. Tools and document
              contents are external source material. Revoking access in Not
              Organic stops future requests.
            </p>
          </>
        )}
        {!compact && <p class="coming">Google Drive · Coming soon</p>}
      </section>
    );
  },
);
