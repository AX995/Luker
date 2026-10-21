/**
 * Decides where a navigation request is handled.
 *
 * Only `http` and `https` URLs whose origin differs from the app origin can
 * leave the app. Every other scheme (`blob:`, `data:`, `about:blank`, …) — and
 * everything without an authority — stays in the page. Server redirects are
 * not routed here; the caller keeps them in the app.
 *
 * A page that is itself outside the app origin is a session the app admitted on
 * purpose — a server redirect into a sign-in page, for instance — and the
 * page's own navigations, form posts included, belong to that session. They
 * stay in the page regardless of the target and of the toggle, because the app
 * page is already off screen and the system browser would break the flow
 * mid-way. An empty or unknown current URL counts as the app page.
 */

export enum LinkRoute {
  InApp = 0,
  SystemBrowser = 1,
  Popup = 2,
}

/**
 * Process-wide copy of the "open external links in the system browser"
 * preference. The web UI writes it through the JavaScript bridge while the
 * navigation callbacks read it on every request, so it lives outside the web
 * settings.
 */
export class ExternalLinkSettings {
  private static openExternally: boolean = true;

  static isOpenExternally(): boolean {
    return ExternalLinkSettings.openExternally;
  }

  static setOpenExternally(value: boolean): void {
    ExternalLinkSettings.openExternally = value;
  }
}

const SCHEME_SEPARATOR: string = '://';

function isDigits(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const ch: string = value.charAt(i);
    if (ch < '0' || ch > '9') {
      return false;
    }
  }
  return true;
}

/**
 * Returns the lowercased `scheme://host[:port]` part of `raw`, with the scheme
 * default port dropped. Returns an empty string when `raw` has no `://`
 * separator or no authority.
 */
export function originOf(raw: string): string {
  if (raw.length === 0) {
    return '';
  }
  const lower: string = raw.toLowerCase();
  const schemeEnd: number = lower.indexOf(SCHEME_SEPARATOR);
  if (schemeEnd < 0) {
    return '';
  }
  const scheme: string = lower.substring(0, schemeEnd);
  const rest: string = lower.substring(schemeEnd + SCHEME_SEPARATOR.length);
  let authorityEnd: number = -1;
  for (let i = 0; i < rest.length; i++) {
    const ch: string = rest.charAt(i);
    if (ch === '/' || ch === '?' || ch === '#') {
      authorityEnd = i;
      break;
    }
  }
  let authority: string = authorityEnd < 0 ? rest : rest.substring(0, authorityEnd);
  const userInfoEnd: number = authority.lastIndexOf('@');
  if (userInfoEnd >= 0) {
    authority = authority.substring(userInfoEnd + 1);
  }
  if (authority.length === 0) {
    return '';
  }

  const colon: number = authority.lastIndexOf(':');
  const port: string = colon >= 0 ? authority.substring(colon + 1) : '';
  const hasPort: boolean = port.length > 0 && isDigits(port);
  const host: string = hasPort ? authority.substring(0, colon) : authority;
  const defaultPort: boolean = (scheme === 'http' && port === '80') ||
    (scheme === 'https' && port === '443');
  const effectivePort: string = hasPort && !defaultPort ? ':' + port : '';
  return scheme + SCHEME_SEPARATOR + host + effectivePort;
}

/** True when `raw` is an `http`/`https` URL outside the app origin. */
export function isExternal(raw: string, appOrigin: string): boolean {
  const origin: string = originOf(raw);
  if (origin.length === 0) {
    return false;
  }
  const schemeEnd: number = origin.indexOf(SCHEME_SEPARATOR);
  const scheme: string = origin.substring(0, schemeEnd);
  if (scheme !== 'http' && scheme !== 'https') {
    return false;
  }
  return origin !== appOrigin;
}

/**
 * Routes a main-frame navigation. `currentUrl` is the URL the main frame is on
 * right before this request; a frame that is already outside the app origin
 * keeps the request in the page so an admitted redirect session survives.
 * `routeNewWindow` deliberately takes no current URL: a new window starts from
 * the page that opened it and is not part of that session.
 */
export function routeTopLevelNavigation(
  url: string,
  currentUrl: string,
  appOrigin: string,
  openExternally: boolean,
): LinkRoute {
  const currentOrigin: string = originOf(currentUrl);
  if (currentOrigin.length > 0 && currentOrigin !== appOrigin) {
    return LinkRoute.InApp;
  }
  if (!isExternal(url, appOrigin)) {
    return LinkRoute.InApp;
  }
  return openExternally ? LinkRoute.SystemBrowser : LinkRoute.InApp;
}

export function routeNewWindow(
  url: string,
  hasWindowFeatures: boolean,
  appOrigin: string,
  openExternally: boolean,
): LinkRoute {
  if (hasWindowFeatures) {
    return LinkRoute.Popup;
  }
  return routeTopLevelNavigation(url, '', appOrigin, openExternally);
}
