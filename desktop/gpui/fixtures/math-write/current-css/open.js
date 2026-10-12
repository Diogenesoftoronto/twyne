if (state.page && !state.page.isClosed())
  throw new Error("Use a new owned fixture tab/session.");
state.requests = [];
state.blocked = [];
state.page = await browser.newPage();
await state.page.route("**/*", (route) => {
  const url = route.request().url();
  if (url.startsWith("http://127.0.0.1:5197/")) return route.continue();
  state.blocked.push(url);
  return route.abort();
});
state.page.on("request", (request) =>
  state.requests.push({ url: request.url(), type: request.resourceType() }),
);
await state.page.setViewportSize({ width: 1280, height: 860 });
await state.page.goto("http://127.0.0.1:5197/?profile=original");
console.log(await getLatestLogs({ page: state.page, sinceLastCall: true }));
console.log(
  await snapshot({ page: state.page, search: /Actual Source|ready|Invalid/ }),
);
