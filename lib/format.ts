const nf1 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("it-IT");
const monthYear = new Intl.DateTimeFormat("it-IT", { month: "short", year: "numeric" });
const fullDate = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric" });

export const fmtRating = (n: number | null | undefined) => (n == null ? "–" : nf1.format(n));
export const fmtInt = (n: number | null | undefined) => (n == null ? "–" : nf0.format(n));
export const fmtPct = (share: number) => `${Math.round(share * 100)}%`;
export const fmtMonthYear = (iso: string | null | undefined) => (iso ? monthYear.format(new Date(iso)) : "–");
export const fmtDate = (iso: string | null | undefined) => (iso ? fullDate.format(new Date(iso)) : "Data non disponibile");
export const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;
