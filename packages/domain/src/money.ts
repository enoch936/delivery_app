export type Money = Readonly<{ amountMinor: bigint; currency: string }>;

export function money(amountMinor: bigint, currency: string): Money {
  if (!Number.isInteger(Number(amountMinor)) || amountMinor < 0n) {
    throw new Error("Money amounts must be non-negative integer minor units.");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Currency must be a three-letter ISO code.");
  }
  return Object.freeze({ amountMinor, currency });
}

export function addMoney(...values: readonly Money[]): Money {
  if (values.length === 0) throw new Error("At least one monetary value is required.");
  const [first, ...rest] = values;
  if (!first) throw new Error("At least one monetary value is required.");
  return rest.reduce((sum, value) => {
    if (value.currency !== sum.currency) throw new Error("Cannot add different currencies.");
    return money(sum.amountMinor + value.amountMinor, sum.currency);
  }, first);
}

export function subtractMoney(total: Money, deduction: Money): Money {
  if (total.currency !== deduction.currency) throw new Error("Cannot subtract different currencies.");
  if (deduction.amountMinor > total.amountMinor) throw new Error("A money amount cannot become negative.");
  return money(total.amountMinor - deduction.amountMinor, total.currency);
}
