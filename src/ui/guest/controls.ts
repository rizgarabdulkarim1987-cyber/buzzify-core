/** Which of the floating guest controls a page shows; pure, so the rule is tested without a browser. */
export function guestControls(input: { locales: readonly string[]; feedbackEnabled: boolean; pathname: string }): { language: boolean; feedback: boolean } {
  // Path shape is /{tenant}/{locale}/...rest; the complaint form and the cart are screens of their own.
  const rest = input.pathname.split('/').slice(3);
  const ownScreen = rest[0] === 'cart' || rest.at(-1) === 'complaint';
  return { language: !ownScreen && input.locales.length > 1, feedback: !ownScreen && input.feedbackEnabled };
}
