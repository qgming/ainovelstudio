import * as React from "react"

const MOBILE_BREAKPOINT = 768

function getIsMobileViewport() {
  if (typeof window === "undefined") {
    return false
  }

  return window.innerWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(getIsMobileViewport)

  React.useEffect(() => {
    const onChange = () => {
      setIsMobile(getIsMobileViewport())
    }

    if (typeof window.matchMedia !== "function") {
      window.addEventListener("resize", onChange)
      setIsMobile(getIsMobileViewport())
      return () => window.removeEventListener("resize", onChange)
    }

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", onChange)
    setIsMobile(getIsMobileViewport())
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
