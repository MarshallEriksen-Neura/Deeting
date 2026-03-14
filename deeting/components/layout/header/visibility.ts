const HIDE_HEADER_PATH_PATTERN =
  /^\/(?:[A-Za-z]{2}(?:-[A-Za-z]{2})?\/)?(?:chat|docs|spec-agent|video)(?:\/|$)/

export function shouldHideGlobalHeader(pathname: string | null) {
  if (!pathname) {
    return false
  }

  return HIDE_HEADER_PATH_PATTERN.test(pathname)
}
