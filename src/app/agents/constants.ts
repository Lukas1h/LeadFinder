// "cold" is where every freshly-scraped/imported lead starts out, so with
// thousands of agents on file it dwarfs every other bucket — page.tsx
// fetches only this many of them by default (the rest load on demand via
// "View all", see getAllColdAgents in actions.ts), since shipping every
// one of them to the client just to render this many was the actual
// reason the page was slow, not the rendering itself.
//
// Lives in its own plain module (no "use client") rather than in
// AgentsList.tsx, where it originally lived — importing a named constant
// from a "use client" file into a Server Component silently resolved to
// undefined here (confirmed: .limit(undefined) drops the LIMIT clause
// entirely, so the "capped" query was quietly fetching all ~2,559 rows
// again). A plain shared module has no client/server boundary to cross.
export const COLD_INITIAL_LIMIT = 15;
