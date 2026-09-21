import type { RequestHandler } from "@qwik.dev/router";
import { relayProviderRequest } from "../../../utils/provider-relay.server";

export const onPost: RequestHandler = async ({ request, send }) => {
  send(await relayProviderRequest(request));
};
