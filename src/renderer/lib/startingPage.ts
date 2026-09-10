/** Prefer the application entry route over framework error templates and unrouted views. */
export function startingPage<T extends { route: string | null; name: string }>(pages: T[]): T | undefined {
  return pages.find(page => page.route === '/')
    ?? pages.find(page => page.route && !/[:{[(*]/.test(page.route) && !/error|not.?found/i.test(page.name))
    ?? pages.find(page => !/error|not.?found/i.test(page.name))
    ?? pages[0]
}
