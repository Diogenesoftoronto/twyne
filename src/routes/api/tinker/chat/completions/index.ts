import type { RequestHandler } from "@builder.io/qwik-city";
import { relayTinkerRequest } from "../../../../../utils/tinker-relay.server";

export const onPost: RequestHandler = async ({ request, send }) => {
  send(await relayTinkerRequest(request, "chat/completions"));
};
