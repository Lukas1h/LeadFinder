import type { Agent, Listing } from "@/db/schema";
import { firstName, naturalStreetName } from "@/lib/sms";
import type { MarketNews } from "@/lib/marketStatus";
import type { FollowUpReason } from "./data";

/**
 * A text to start from for each reason on the Follow up page, in Lukas's
 * voice: casual, upbeat, short. It fills Messages; he edits and sends it.
 *
 * The rule these are written to: never "got any work for me?". Each one is
 * either about something of theirs (a listing, a sale) or says outright that
 * there's no rush. Only the two where the listing itself needs photos make an
 * offer, and it's the same offer his first texts make.
 *
 * The sale words follow the listing's status exactly ("under contract" unless
 * the MLS says pending, "closed" only once it has), because agents use them
 * precisely.
 */
export function suggestFollowUpText(input: {
  agent: Agent;
  reason: FollowUpReason;
  listing: Listing | null;
  address: string | null;
  /** For news: what happened, and whether it's a home he shot. */
  news?: { kind: MarketNews; shot: boolean };
  isClient: boolean;
}): string {
  const { agent, reason, listing, news, isClient } = input;
  const name = firstName(agent.name);
  const hey = name ? `Hey ${name}!` : "Hey there!";
  const street = naturalStreetName(listing?.address ?? input.address);
  const comingSoon = listing?.isComingSoon ?? false;

  switch (reason) {
    case "weak_photos":
      if (comingSoon) {
        return `${hey} Saw ${street ? `${street} is` : "your new one is"} coming soon. Do you have photos lined up for it yet? I'd love to shoot it for you if not!`;
      }
      return `${hey} Saw your new listing${street ? ` on ${street}` : ""}. If you want some professional photos taken for it I'd love to shoot it for you, I can get out there this week!`;

    case "samples":
      return `${hey} Just making sure those samples came through okay. No rush at all!`;

    case "just_listed":
      if (comingSoon) {
        return `${hey} Saw ${street ? `${street} is` : "you have one"} coming soon, congrats on the new listing! Do you have photos lined up for it yet?`;
      }
      return `${hey} Saw your new listing${street ? ` on ${street}` : ""} went live, it looks great! Congrats!`;

    case "news": {
      const what =
        news?.kind === "sold" ? "closed" : news?.kind === "pending" ? "went pending" : "went under contract";
      const home = street ?? "your listing";
      return `${hey} Saw ${home} ${what}, congrats!!${news?.shot ? " Glad I got to shoot that one!" : ""}`;
    }

    case "price_cut":
      return `${hey} Saw the price change${street ? ` on ${street}` : ""}. If you want to try some new photos to get fresh eyes on it, I'd love to shoot it for you!`;

    case "quiet":
      return isClient
        ? `${hey} Hope things are going great! Just checking in, I'm around whenever your next listing comes up.`
        : `${hey} Lukas here, the photographer. No rush on anything, just staying on your radar for whenever your next listing comes up. Hope things are going well!`;
  }
}
