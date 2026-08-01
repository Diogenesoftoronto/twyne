import type { RequestHandler } from "@builder.io/qwik-city";
import { relayTinkerRequest } from "../../../../utils/tinker-relay.server";

export const onGet: RequestHandler = async ({ request, send }) => {
  send(await relayTinkerRequest(request, "models"));
};
