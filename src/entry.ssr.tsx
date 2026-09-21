/**
 * WHAT IS THIS FILE?
 *
 * SSR entry point, in all cases the application is rendered outside the browser, this
 * entry point will be the common one.
 *
 * - Server (express, cloudflare...)
 * - npm run start
 * - npm run preview
 * - npm run build
 *
 */
import {
  renderToStream,
  type RenderToStreamOptions,
} from "@qwik.dev/core/server";
import Root from "./root";
import {
  browserLanguagesFromHeader,
  preferenceFromCookie,
  resolveAppLocale,
} from "./i18n/locale";

export default function (opts: RenderToStreamOptions) {
  const headers = (opts.serverData?.requestHeaders ?? {}) as Record<
    string,
    string
  >;
  const preference = preferenceFromCookie(headers.cookie);
  const locale = resolveAppLocale(
    preference,
    browserLanguagesFromHeader(headers["accept-language"]),
  );
  return renderToStream(
    <Root initialLocale={locale} initialPreference={preference} />,
    {
      ...opts,
      // Use container attributes to set attributes on the html tag.
      containerAttributes: {
        ...opts.containerAttributes,
        lang: locale,
      },
      serverData: {
        ...opts.serverData,
      },
    },
  );
}
