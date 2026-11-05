'use client';

/**
 * The "?" button is hidden until the Helper (the walkthrough) is built (owner decision, 2026-11-05): a button that does nothing only teaches
 * teachers to ignore it. The tour target `data-tour="help"` stays in the page, hidden, so the Helper can show it without touching any screen.
 * To bring the button back, render the visible control here instead of the hidden span.
 */
export function HelpButton() {
  return <span data-tour="help" hidden />;
}
