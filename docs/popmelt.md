# Popmelt in Twyne

Popmelt 0.24.2 is installed as a development dependency, with React, React DOM, and Lucide React for its internal renderer. Twyne remains a Qwik application.

The Vite plugin starts the local project bridge. `src/components/dev/popmelt-dev.tsx` mounts the standalone DOM toolbar after the browser document is ready, connects Qwik navigation, and releases the toolbar on teardown or hot replacement. Production builds exclude this integration. The existing development commands are unchanged.

## Use it

Run your existing development server, for example:

```sh
rtk proxy bun run dev.frontend
```

Open the URL Vite reports (normally http://127.0.0.1:5173). Double-tap **Control** on Linux/Windows or **Command** on macOS to open the toolbar.

- **Chat (`C`)**: select an element and describe the change. **Control/Command+Enter** sends the pending annotations to the selected coding agent. Continue refining in the same thread.
- **Steer (`S`)**: preview spacing, type, color, and layout changes directly on the selected element, then send them to the agent to implement.
- **Imprint (`I`)**: review the project's accumulated design context.

Example: select the Tools board and write “Align these switches with the check selector and keep the existing paper colors.”

The selected Codex or Claude CLI must be installed and signed in. The first real annotation verifies the full agent handoff; installation diagnostics do not execute a coding request.

## Checks and limits

```sh
rtk proxy bun node_modules/@popmelt.com/core/dist/cli.mjs codex status
rtk proxy bun node_modules/@popmelt.com/core/dist/cli.mjs codex doctor
```

`doctor` can start this project's bridge. Check that its project root and project ID match Twyne, not merely that a service answers on the port.

Qwik uses Popmelt's experimental standalone DOM integration. It supports DOM annotations and style editing, but not React component hierarchy or library previews. Browser toolbar operation still needs a manual check.

Local annotations, screenshots, threads, and design memory live under `.popmelt/`, which is ignored by Git.

The separate personal Codex plugin is not installed by the project integration. It supplies ambient context and records project-bound conversations; adding it changes personal Codex configuration and requires a new session to activate.

Reference: https://www.npmjs.com/package/@popmelt.com/core
