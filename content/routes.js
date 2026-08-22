const HOME_PATH_PATTERN = /^\/home\/?$/;
const PROFILE_PATH_PATTERN = /^\/(?:(?<locale>[a-z]{2}(?:-[a-z]{2})?)\/)?users\/(?<userId>[1-9]\d*)\/profile\/?$/i;

export function parseRoute(pathname = location.pathname) {
  if (typeof pathname !== "string") {
    return null;
  }

  if (HOME_PATH_PATTERN.test(pathname)) {
    return { name: "home" };
  }

  const match = PROFILE_PATH_PATTERN.exec(pathname);

  if (!match) {
    return null;
  }

  const userId = Number(match.groups.userId);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return null;
  }

  return {
    locale: match.groups.locale?.toLowerCase() || null,
    name: "profile",
    userId,
  };
}

export function isHomeRoute(pathname = location.pathname) {
  return parseRoute(pathname)?.name === "home";
}

export function getProfileRoute(pathname = location.pathname) {
  const route = parseRoute(pathname);
  return route?.name === "profile" ? route : null;
}
