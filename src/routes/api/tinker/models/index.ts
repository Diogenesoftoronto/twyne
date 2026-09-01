import type { RequestHandler } from "@qwik.dev/router";
import { relayTinkerRequest } from "../../../../utils/tinker-relay.server";

export const onGet: RequestHandler = async ({ request, send }) => {
  send(await relayTinkerRequest(request, "models"));
};
