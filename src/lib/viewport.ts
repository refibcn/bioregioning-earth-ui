// Shared mobile breakpoint for client-side JS (nav hamburger, sidebar-hide, gallery filter
// collapse, ontology card click-through). CSS can't import this constant, so every media query
// that needs to match it uses the literal 767px/768px directly with a comment pointing back here
// — keep the two in sync if this ever changes.
export const MOBILE_BREAKPOINT = 768;

export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;
}
