/** Execute actual original pure functions, without importing Convex handlers. */
import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Schema } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { accountName, accountDisplayName, accountInitials } from "../../../../src/utils/account-display";
import { isAtprotoDid, isTid, parseAtUri, standardSitePublicationUrl, standardSiteDocumentUrl } from "../../../../src/utils/standard-site-paths";
import { publishViaMicropub } from "../../../../src/utils/micropub";

const root = resolve(import.meta.dir, "../../../..");
export const sourcePaths = [
  "convex/collaboration.ts", "convex/published.ts", "src/utils/account-display.ts",
  "src/utils/standard-site-paths.ts", "src/utils/micropub.ts", "src/utils/auth-context.tsx",
  "src/components/editor/extensions/remote-cursors.ts",
];

function extract(path: string, functions: string[], constants: string[] = [], bindings: Record<string, unknown> = {}) {
  const source = readFileSync(resolve(root, path), "utf8");
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const selected = tree.statements.filter(node => {
    if (ts.isFunctionDeclaration(node)) return !!node.name && functions.includes(node.name.text);
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && constants.includes(d.name.text));
    return false;
  });
  for (const name of functions) {
    if (!selected.some(n => ts.isFunctionDeclaration(n) && n.name?.text === name)) throw new Error(`Missing original function ${path}:${name}`);
  }
  const snippets = selected.map(node => node.getText(tree)).join("\n").replace(/^export\s+/gm, "");
  const js = ts.transpileModule(snippets, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(bindings), `${js}\nreturn {${[...functions, ...constants].join(",")}};`)(...Object.values(bindings)) as any;
}

export const collaboration = extract("convex/collaboration.ts", ["pickColor", "requireIdentity", "getCollaborator", "requireRole"], ["PRESENCE_COLORS"]);
export const publishing = extract("convex/published.ts", ["slugify", "sanitizeHtml"], [], { window: undefined });
export const micropub = extract("src/utils/micropub.ts", ["safeEndpoint"]);
export const clientAuth = extract("src/utils/auth-context.tsx", ["hasAuthenticatedConvexIdentity"]);
export const remote = extract("src/components/editor/extensions/remote-cursors.ts", ["buildDecorations"], [], { Decoration, DecorationSet, accountDisplayName });

export const names = [
  "Alice Wonderland", " Name a@b.co ", "alice@example.com", "Name\ta@b.co", "Name\u00a0a@b.co",
  "did:plc:private", "DID:plc:label", "", "\ufeff  Ada Lovelace \ufeff", "\u0085Ada\u0085",
  "écrivain 東京", "😀 Writer", "Anne\u2028Brontë", "Straße ß", "@x", "a@ b", "a@@b",
];
export const titles = [
  "Hello World", "Café & Crème: A Memoir", "ﬃ fullwidth ＡＢＣ ①", "ø ß æ œ", "İstanbul",
  "e\u0301 e\u1ab0", "東京 and English", "a".repeat(47) + " z", "a".repeat(48) + " z", "", "---",
  "The Sovereign Writer’s Desk", "\ufeff Ｋ Ｋ \ufeff", "ẞ Straße", "A\u0301\u034fB",
];
export const htmlCases = [
  "<p>東京 😀 café e\u0301</p>", "İ before <SCRIPT>alert(1)</SCRIPT><p>東京</p>",
  "<script>unterminated 東京", "<scripture>x</scripture><p>kept</p>", "<embedding>x</embedding><embed src='x'/>",
  "<p onclick=\"steal()\" onload='x' ONFOO = y>é東京</p>", "<p\u00a0onload=x>NBSP</p>",
  "<p\ufeffonload=x>BOM</p>", "<p\u0085onload=x>NEL</p>", "<p onÉ=x onſ=x on=x>marks</p>",
  "<ſcript>x</ſcript><a href='JavaScript:東京'>link</a>", "<script>a\n東京</script><style>x</style><iframe>x</iframe><object>x</object>",
  "<p onclick=\"unterminated>text", "<script><script>x</script>tail</script>", "<EMBEDTHING>keep</EMBEDTHING>",
];
export const endpoints = [
  "https://writer.example/micropub", " HTTPS://WRITER.EXAMPLE:443/a/../micropub ", "http://localhost:8080/micropub",
  "http://127.0.0.1:4000/micropub", "http://localhost.evil/micropub", "http://127.0.0.1.evil/micropub",
  "http://localhost@evil.example/micropub", "http://evil@localhost/micropub", "http://LOCALHOST/micropub",
  "http://[::1]/micropub", "http://127.1/micropub", "https://écrivain.example/micropub",
  "https://user:pass@example.com/micropub", "http://insecure.example/micropub", "not a URL", "ftp://localhost/x",
  "\ufeffhttps://writer.example\ufeff", "https://example.com/a?x=é#piece",
];
export const dids = ["did:plc:abc123", "did:web:example.com", "did:web:example.com:path", "did:PLC:upper", "did:plc:東京", "did:", "did:plc:abc\n", "did:plc:a%3Ab"];
export const tids = ["3k2vknq6z3p46", "2222222222222", "jk2vknq6z3p46x", "1k2vknq6z3p46", "3k2vknq6z3p4!", "3k2vknq6z3p46\n", "short"];

export function capture<T>(run: () => T): { ok: true; value: T } | { ok: false } {
  try { return { ok: true, value: run() }; } catch { return { ok: false }; }
}

export async function sourceRole(role: string, status: string, allowed: string[], matchesScope = true) {
  const queries: Record<string, string>[] = [];
  const db = {
    query(table: string) {
      if (table !== "collaborators") throw new Error("Unexpected table");
      return {
        withIndex(index: string, filter: (q: any) => unknown) {
          if (index !== "by_lixId_userId") throw new Error("Unexpected index");
          const fields: Record<string, string> = {};
          const q = { eq(name: string, value: string) { fields[name] = value; return q; } };
          filter(q); queries.push(fields);
          return { async first() { return matchesScope ? { role, status } : null; } };
        },
      };
    },
  };
  try {
    await collaboration.requireRole({ db }, "lix-owned", "server-token-identifier", allowed);
    return { ok: true, queries };
  } catch (error) { return { ok: false, error: (error as Error).message, queries }; }
}

export function pmReference() {
  const schema = new Schema({ nodes: {
    doc: { content: "paragraph+" }, paragraph: { content: "inline*", group: "block" }, text: { group: "inline" },
    hard_break: { inline: true, group: "inline" }, note: { inline: true, atom: true, group: "inline" },
  } });
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("😀e\u0301"), schema.node("note"), schema.node("hard_break")]),
    schema.node("paragraph", null, schema.text("東京")),
  ]);
  const requested = [
    { userId: "end", displayName: "Name private@example.com", color: "#c1272d", cursorPos: doc.content.size, selectionAnchor: -2, selectionHead: 99 },
    { userId: "beyond", displayName: "Writer", color: "#e8a92c", cursorPos: 999 },
    { userId: "negative", displayName: "Writer", color: "#3b7dd8", cursorPos: -1 },
  ];
  const decorations = remote.buildDecorations({ doc }, requested).find().map((d: any) => ({ from: d.from, to: d.to, kind: d.from === d.to ? "widget" : "inline" }));
  return { document: doc.toJSON(), contentSize: doc.content.size, textContent: doc.textContent,
    textScalarCount: Array.from(doc.textContent).length, textUtf16Count: doc.textContent.length, requested, decorations,
    nativeScalarConversionImplemented: false };
}

export async function buildReference() {
  const displayCases = [
    { user: { name: "Email a@b.co", handle: "ada" }, profile: null },
    { user: { name: "Ada" }, profile: { displayName: "Profile Poet", handle: "profile" } },
    { user: { name: "did:plc:private", handle: "private@example.com", email: "private@example.com" }, profile: { displayName: "", handle: "poet" } },
    { user: { name: "private@example.com", email: "contact@example.com" }, profile: null },
  ];
  const uriCases = [
    "at://did:plc:abc123/site.standard.publication/3k2vknq6z3p46", "at://did:plc:abc123/site.standard.document/3k2vknq6z3p46?x=1",
    "at://did:web:example.com/foo/3k2vknq6z3p46", "at://did:plc:abc123/foo/3k2vknq6z3p46/extra", "https://example.com/x",
  ];
  const forms = [];
  for (const [title, html] of [["  Café & 東京 ~*'  ", "<p>😀 e\u0301 + &</p>"], ["\ufeff \ufeff", "<p>empty title</p>"], ["\u0085Poet\u0085", "<p>literal NEL</p>"]]) {
    let request: any;
    const result = await publishViaMicropub({ endpoint: "https://writer.example/micropub", token: " fixture-only-token ", title, html }, async (url, init) => {
      request = { endpoint: String(url), method: init?.method, body: String(init?.body), headers: init?.headers };
      return new Response(null, { status: 201, headers: { location: "/posts/observed" } });
    });
    // Never retain a credential-like header, even this inert fixture token.
    const { authorization, ...publicHeaders } = request.headers;
    forms.push({ title, html, ...request, headers: publicHeaders, authorizationPresent: authorization === "Bearer fixture-only-token", result });
  }
  const authStates = [
    { user: null, provider: "convex", convexAuthenticated: true }, { user: { id: "caller-label" }, provider: "convex", convexAuthenticated: false },
    { user: { id: "caller-label" }, convexAuthenticated: true }, { user: { id: "server-session-label" }, provider: "convex", convexAuthenticated: true },
  ];
  const roles = [];
  for (const role of ["owner", "editor", "commenter"]) {
    for (const status of ["accepted", "pending", "rejected"]) {
      for (const allowed of [["owner"], ["owner", "editor"], ["owner", "editor", "commenter"]]) {
        roles.push({ role, status, allowed, observed: await sourceRole(role, status, allowed) });
      }
    }
  }
  const serverIdentity = await collaboration.requireIdentity({ auth: { async getUserIdentity() { return { tokenIdentifier: "server-token-identifier" }; } }, userId: "spoofed-caller" });
  let anonymousRejected = false;
  try { await collaboration.requireIdentity({ auth: { async getUserIdentity() { return null; } } }); } catch { anonymousRejected = true; }
  return {
    version: 2,
    method: "Direct original imports and unchanged TypeScript function declaration extraction; no registered Convex functions or network invoked.",
    sources: sourcePaths.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex") })),
    colors: ["writer_alpha", "writer_beta", "a", "unicode_writer_✨_東京", "😀", "user@example.com", "long".repeat(500)].map(userId => ({ userId, color: collaboration.pickColor(userId) })),
    palette: collaboration.PRESENCE_COLORS,
    names: names.map(input => ({ input, name: accountName(input) ?? null, initials: accountInitials(input) })),
    displays: displayCases.map(input => ({ ...input, displayName: accountDisplayName(input.user, input.profile) })),
    slugs: titles.map(input => ({ input, output: publishing.slugify(input) })),
    sanitizer: htmlCases.map(input => ({ input, output: publishing.sanitizeHtml(input) })),
    dids: dids.map(input => ({ input, valid: isAtprotoDid(input) })),
    tids: tids.map(input => ({ input, valid: isTid(input) })),
    uris: uriCases.map(input => ({ input, parsed: parseAtUri(input) })),
    urls: ["https://twyne.love", "https://reader.example/", "https://reader.example///"].map(origin => ({ origin,
      publication: standardSitePublicationUrl("did:web:example.com", "3k2vknq6z3p46", origin),
      document: standardSiteDocumentUrl("did:web:example.com", "3k2vknq6z3p46", "3k2vknq6z3p47", origin) })),
    micropubEndpoints: endpoints.map(input => ({ input, ...capture(() => micropub.safeEndpoint(input)) })),
    micropubForms: forms, clientAuth: authStates.map(state => ({ state, permits: clientAuth.hasAuthenticatedConvexIdentity(state) })),
    serverIdentity: { observed: serverIdentity, anonymousRejected, callerIdIgnored: serverIdentity.tokenIdentifier !== "spoofed-caller" },
    roles, wrongScope: await sourceRole("owner", "accepted", ["owner"], false), pm: pmReference(),
    proofLimits: { serverContextIsFixture: true, realAuthenticatedTransport: false, nativeCursorOverlay: false,
      browserDomSanitizer: false, providerCalls: false, sentInvites: false, published: false },
  };
}
