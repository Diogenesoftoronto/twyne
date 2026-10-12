// Run in a new task-owned Playwriter CLI session. Never select an existing app tab.
const origin = "http://127.0.0.1:5196";
if (state.page && !state.page.isClosed() && !state.page.url().startsWith(origin + "/")) {
  throw new Error("Refusing to steer a non-fixture tab.");
}
if (!state.page || state.page.isClosed()) {
  state.page = await browser.newPage();
  await state.page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(origin + "/")) return route.continue();
    state.blocked.push(url);
    return route.abort();
  });
  state.page.on("request", (request) => state.requests.push({ url: request.url(), type: request.resourceType() }));
}
state.requests = [];
state.blocked = [];
await state.page.setViewportSize({ width: state.fixtureWidth ?? 1280, height: 860 });
await state.page.goto(origin + "/?profile=" + (state.profile ?? "original"));
console.log(await getLatestLogs({ page: state.page, sinceLastCall: true }));
console.log(await snapshot({ page: state.page, search: /Actual Source|ready|Invalid/ }));
