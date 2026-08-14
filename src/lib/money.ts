/** Renders minor units in the venue's own currency: 110000, "PHP" → "₱1,100". */
export function formatMoney(minorUnits: number, currency = "PHP") {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minorUnits / 100);
}
