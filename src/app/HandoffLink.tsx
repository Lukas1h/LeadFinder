"use client";

import { handOff } from "@/lib/handoff";

/**
 * An sms:/tel: link that logs before it opens (see handOff). A real <a> so it
 * still works with Button asChild and long-press.
 */
export function HandoffLink({
  href,
  log,
  onDone,
  ...props
}: Omit<React.ComponentProps<"a">, "onClick" | "href"> & {
  href: string;
  log: () => Promise<unknown>;
  onDone?: () => void;
}) {
  return (
    <a
      {...props}
      href={href}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void handOff(href, log).then(onDone);
      }}
    />
  );
}
