# Cast in the native desk

The host retains one Cast view across the Editorial Board, Room of Editors and
Full Analysis pages. Its scope is the current original folio ID, or the native
draft ID for older native files. Notes keep their original IDs and raw metadata;
the host supplies no inferred persona-mark anchors or provider capabilities.

Three mounted coordinator tests cover actual navigation and final-character
capture, folio/quit draft retention, a failed file write followed by the visible
desk retry action, rejected late acknowledgements, and a route boundary joining
the exact background save. Core store and standalone view tests cover their
separate contracts in [the Cast fixture](../cast/CONTRACT.md).

`check-native.py` allocates an isolated Xvfb display and sends mouse/key input
from a separate XTEST process. It explicitly activates the observed owned
Twyne window before typing; a focused textarea handle alone does not activate
a client on an X server without a window manager. Rendered observations supply
control bounds, actual platform activation and focus. AccessKit omits the
disabled property for enabled controls; the driver also exercises actual
New/Cancel activation rather than assuming that absence proves behavior.

The driver follows Board → Manager → Board → Full Analysis → Board, captures
an unblurred final keystroke before navigation, obstructs the real metadata
backup write, checks exact accepted disk bytes during failure, then drives
retry, File only and Ctrl-Q. It checks writer reply count, retained note and
foreign data, and the unchanged canonical manuscript. Screenshots, geometry,
logs and saved test records are written to the requested output directory.
The current [actual acceptance](native-acceptance.json) passes all nine checks,
including a clean focused-textarea Ctrl-Q exit after the narrow X11 platform
cleanup patch. Retained original/final manuscript files are byte-identical;
the final Cast record contains the filed reply and exact unblurred quit draft.
This records host behavior independently of the remaining Cast rendering work.

```sh
rtk proxy devenv shell -- rtk proxy cargo build --locked --offline --features ui-tests --manifest-path desktop/gpui/Cargo.toml --bin twyne-desktop
rtk proxy devenv shell -- rtk proxy python3 desktop/gpui/fixtures/host-cast/check-native.py --binary desktop/gpui/target/debug/twyne-desktop --fixture desktop/gpui/fixtures/marginalia/browser-manuscript.html --cast desktop/gpui/fixtures/cast/native-retained.json --cast-folio 'web/folio:café'
```

The retained fixture is explicitly authored test metadata. Capture-only loading
binds its outer scope to the temporary native folio copy while preserving row
folioId values, note IDs, unknown fields and the foreign scope. It is not
generated provider output or a production identity migration. Ordinary web
document exports do not back up the independent Cast store.

Original Cast symbol selection and metrics have their own
[bundled-font evidence](../fonts/cast-glyphs/README.md). The packaged helper uses
the original local `Intl` Filed date formatting; its executable check includes
the observed Toronto date, out-of-range Date behavior and malformed requests.
These checks do not prove pixel parity, other operating systems, actual file
dialogs, provider transactions, speech or persona-mark navigation.

The [current visual captures](visual/observations.json) retain native Board,
Manager and Full Analysis frames at1280/620px plus the original empty Board
and Manager. Capsule pills and raw glyphs are corrected; narrow action and
assistance wrapping, approximately4px first-card height and3px wide New-button
placement remain visible differences. Board compositor/provider states differ,
and there is no same-data original Analysis frame in this set. These frames
are inspectable partial visual evidence, separate from the nine host actions.
