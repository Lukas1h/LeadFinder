import { FinanceTabs } from "./FinanceTabs";

/** Revenue (from bookings), expenses and mileage, joined: see src/lib/finance. */
export default function FinancesLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="max-w-4xl mx-auto w-full px-6 py-10">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Finances</h1>
        <p className="text-sm text-muted-foreground mt-1">What the business makes, spends and drives.</p>
      </header>
      <FinanceTabs />
      {children}
    </main>
  );
}
