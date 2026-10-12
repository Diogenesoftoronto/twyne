The local steering adapter executes only the original failure guards from
`src/utils/background-research.ts:381`, with the original `MIN_DRAFT_CHARS = 120`
and `ResearchCommandResult` interface. The text supplied by the native host is
normalized with the exact editor route expression
`text.replace(/\s+/g, " ").trim()`. It is not parsed as HTML.

`build-helper.ts` locates these declarations and the `await runOnce(...)`
boundary with the TypeScript AST. It checks the function/interface/constant,
ordered guard conditions and failure returns, rejects extra statements or a
changed boundary, and copies the original guard span without changing it.
The generated adapter has no runtime imports. Its settings loader is always
async `null`, `passInFlight` is always false, and both provider inspection and
fallthrough beyond the guards throw. It cannot return research success.

`capture-source.ts` independently executes the original TypeScript-erased
guard prefix in an isolated Node VM, using the same actual offline inputs.
Provider inspection, research and network tripwires remain at zero. The
checked observations cover guard priority, JavaScript whitespace (including
NEL's exclusion), the 120 UTF-16-unit boundary, astral text, and literal text
that must not be treated as HTML. Packaged-helper tests additionally reject
invalid wire types and show that request fields cannot override offline
settings or start a pass.

Reproduce without Devenv, Cargo, a browser, or research requests:

```sh
rtk proxy bun desktop/gpui/tools/build-helper.ts
rtk proxy bun desktop/gpui/fixtures/steering-offline/capture-source.ts --check
rtk proxy bun test desktop/gpui/tools/semantic-worker.test.ts --test-name-pattern 'offline steering'
rtk proxy bun test desktop/gpui/tools/semantic-worker.test.ts
```

To deliberately refresh source observations after reviewing a source-contract
change, run `rtk proxy bun desktop/gpui/fixtures/steering-offline/capture-source.ts`.

These checks prove the extracted JavaScript guards and packaged local protocol.
They do not prove a browser/native interaction or the host's manuscript-text
projection, and do not enable providers, research, dictation, or durable storage
of a steering draft. The native host owns those separate boundaries.
