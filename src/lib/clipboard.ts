/**
 * Copies text from inside a tap handler, before the same tap hands off to
 * Messages. Has to start synchronously in the gesture: iOS only lets a page
 * write the clipboard during a user tap. Fails quietly — the text still goes
 * out, you'd just type the second message yourself.
 */
export function copyInTap(text: string | null | undefined): void {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
    return;
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  try {
    document.execCommand("copy");
  } catch {}
  el.remove();
}
