const MOBILE_USER_AGENT_PATTERN = /android|iphone|ipad|ipod/i;

export function isMobileRuntime(userAgent?: string) {
  const currentUserAgent =
    userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent);

  return MOBILE_USER_AGENT_PATTERN.test(currentUserAgent);
}
