// Match the installed Playwright action deadline, not a rendering speed budget.
// Accessibility must scan the actual target; performance has its own gate.
export const MOUNT_TIMEOUT_MS = 30_000;

export async function awaitAccessibilityMount(page, selector) {
  try {
    await page.waitForSelector(selector, { state: "attached", timeout: MOUNT_TIMEOUT_MS });
    return true;
  } catch (error) {
    if (error?.name === "TimeoutError") return false;
    throw error;
  }
}
