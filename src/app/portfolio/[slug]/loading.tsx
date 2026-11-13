/**
 * Agent pages get their own (blank white) loading screen. Without it, the
 * root src/app/loading.tsx (the admin app's dark leads skeleton) flashed for
 * a moment while the page streamed in.
 */
export default function PortfolioLoading() {
  return <div className="min-h-screen bg-white" />;
}
