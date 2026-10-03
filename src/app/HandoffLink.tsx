"use client";

import { logHandoff, type HandoffPayload } from "@/lib/handoff";

/**
 * An sms:/tel: link that logs the hand-off as it opens (see lib/handoff.ts).
 * The browser's own link navigation does the opening, so iOS treats it as the
 * direct result of the tap.
 */
export function HandoffLink({
  log,
  onClick,
  ...props
}: React.ComponentProps<"a"> & { log: HandoffPayload }) {
  return (
    <a
      {...props}
      onClick={(e) => {
        logHandoff(log);
        onClick?.(e);
      }}
    />
  );
}
