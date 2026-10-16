/**
 * What the business spends on and drives for. Client-safe: the forms use it.
 *
 * Each expense category carries the deduction it usually gets, which the form
 * fills in and Lukas can change. Those defaults follow how the business files:
 * the car is claimed by the standard mileage rate, which already stands in for
 * gas, washes, oil and repairs, so those are tracked at 0% (claiming them too
 * would count the car twice). Parking and tolls are the exception, deductible
 * on top. A meal with a client is 50%; a meal alone on a day trip isn't
 * deductible at all (only travel with an overnight stay is), so solo meals
 * default to 0 and an overnight trip's meals get set to 50 by hand.
 */

export const EXPENSE_CATEGORIES = [
  { value: "gas", label: "Gas", deductible: 0, hint: "Covered by the mileage deduction. Enter gallons and price so trips get priced." },
  { value: "vehicle", label: "Car upkeep", deductible: 0, hint: "Washes, oil, repairs: covered by the mileage deduction." },
  { value: "parking_tolls", label: "Parking & tolls", deductible: 100, hint: null },
  { value: "equipment", label: "Equipment", deductible: 100, hint: "Cameras, drones, lenses, rigging." },
  { value: "repairs", label: "Equipment repairs", deductible: 100, hint: null },
  { value: "software", label: "Software & cloud", deductible: 100, hint: "Subscriptions, APIs, hosting." },
  { value: "marketing", label: "Marketing & printing", deductible: 100, hint: null },
  { value: "supplies", label: "Office supplies", deductible: 100, hint: null },
  { value: "client_items", label: "For clients", deductible: 100, hint: "Flash drives, prints, gifts (gifts cap at $25 a person)." },
  { value: "meal_client", label: "Meal with a client", deductible: 50, hint: "50% deductible." },
  { value: "meal_travel", label: "Meal on the road", deductible: 0, hint: "Not deductible on a day trip. Set 50% if you stayed overnight." },
  { value: "travel", label: "Travel & lodging", deductible: 100, hint: "Bus, flights, hotels." },
  { value: "education", label: "Licenses & training", deductible: 100, hint: "FAA exams, courses." },
  { value: "clothing", label: "Uniform", deductible: 100, hint: "Only branded or work-only clothing." },
  { value: "other", label: "Other business", deductible: 100, hint: null },
  { value: "personal", label: "Personal", deductible: 0, hint: "Paid from the business account but not a business cost." },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["value"];

export function expenseCategory(value: string) {
  return EXPENSE_CATEGORIES.find((c) => c.value === value) ?? EXPENSE_CATEGORIES.find((c) => c.value === "other")!;
}

/** Personal spending is listed but isn't a cost of the business. */
export function isBusinessExpense(category: string): boolean {
  return category !== "personal";
}

export const TRIP_CATEGORIES = [
  { value: "shoot", label: "Shoot" },
  { value: "client", label: "Client meeting or drop-off" },
  { value: "outreach", label: "Outreach" },
  { value: "supplies", label: "Supplies run" },
  { value: "office", label: "Office & errands" },
  { value: "other", label: "Other" },
] as const;

export type TripCategory = (typeof TRIP_CATEGORIES)[number]["value"];

export function tripCategoryLabel(value: string): string {
  return TRIP_CATEGORIES.find((c) => c.value === value)?.label ?? "Other";
}
