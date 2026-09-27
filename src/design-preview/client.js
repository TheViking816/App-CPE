// Isolated visual sandbox. No network client or production credentials.
const next = new Date(); next.setMonth(next.getMonth() + 1, 1);
const year = next.getFullYear(), month = next.getMonth() + 1;
export const day = (n) => `${year}-${String(month).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
export const session = { token: "visual-demo-only", chapa: "72000" };
export const descansos = { worker: { group: "A - V" }, months: [{ year, month, days: Array.from({ length: 28 }, (_, i) => ({ day: i + 1, code: [4, 9, 15, 22].includes(i + 1) ? "DS" : i === 19 ? "FS" : "" })) }] };
export const vacaciones = { recognized: true, year, totalDays: 7, rows: [{ inicio: `05/${String(month).padStart(2, "0")}/${year}`, fin: `11/${String(month).padStart(2, "0")}/${year}`, dias: 7 }] };
const base = { status: "open", professionalGroup: "CONDUCTOR 1a", ownerGroup: "A - V", restGroup: "A - V", createdAt: new Date().toISOString() };
export async function getRestExchange() { return { offers: [
  { ...base, id: "r1", kind: "swap", ownerName: "ÁLEX MARTÍNEZ", ownerChapa: "72000", isOwn: true, offeredDate: day(4), wantedDate: day(12) },
  { ...base, id: "r2", kind: "swap", ownerName: "LUCÍA FERRER", ownerChapa: "72001", offeredDate: day(12), wantedDate: day(9), ownerGroup: "C - N", professionalGroup: "G-DA · solo RTT" },
  { ...base, id: "r3", kind: "give", ownerName: "MARCOS VIDAL", ownerChapa: "72002", offeredDate: day(18), professionalGroup: "SIN-F · Pend. de formación" },
  { ...base, id: "r4", kind: "want", ownerName: "ELENA SOLER", ownerChapa: "72003", wantedDate: day(22) }
  ,{ ...base, id: "r5", kind: "swap", ownerName: "ÁLEX MARTÍNEZ", ownerChapa: "72000", isOwn: true, status: "agreed", offeredDate: day(15), wantedDate: day(21) }
], proposals: [{ id: "rp5", offerId: "r5", status: "accepted", proposerName: "ELENA SOLER", counterpartName: "ELENA SOLER", counterpartChapa: "72003", offeredDate: day(21) }] }; }
export async function getVacationExchange() { return { offers: [
  { ...base, id: "v1", ownerName: "ÁLEX MARTÍNEZ", ownerChapa: "72000", isOwn: true, offeredStart: day(5), offeredEnd: day(11), wantedStart: day(19), wantedEnd: day(25) },
  { ...base, id: "v2", ownerName: "LUCÍA FERRER", ownerChapa: "72001", offeredStart: day(19), offeredEnd: day(25), wantedStart: day(5), wantedEnd: day(11) },
  { ...base, id: "v3", ownerName: "MARCOS VIDAL", ownerChapa: "72002", offeredStart: day(16), offeredEnd: day(16), wantedStart: day(9), wantedEnd: day(9) }
  ,{ ...base, id: "v4", ownerName: "ÁLEX MARTÍNEZ", ownerChapa: "72000", isOwn: true, status: "agreed", offeredStart: day(5), offeredEnd: day(7), wantedStart: day(26), wantedEnd: day(28) }
], proposals: [{ id: "vp4", offerId: "v4", status: "accepted", proposerName: "ELENA SOLER", counterpartName: "ELENA SOLER", counterpartChapa: "72003" }] }; }
async function blocked() { throw new Error("Demostración visual: no se guardan cambios."); }
async function empty() { return []; }
export {
  blocked as cancelRestExchange, blocked as decideRestExchange, blocked as proposeRestExchange,
  blocked as publishRestExchange, blocked as updateRestExchange, blocked as withdrawRestExchange,
  blocked as cancelVacationExchange, blocked as decideVacationExchange, blocked as proposeVacationExchange,
  blocked as publishVacationExchange, blocked as updateVacationExchange, blocked as withdrawVacationExchange,
  blocked as sendRestExchangeMessage, blocked as sendVacationExchangeMessage, blocked as markExchangeThreadRead,
  blocked as deleteDirectConversation, blocked as markDirectRead, blocked as sendDirectMessage, blocked as startDirectConversation,
  empty as getRestExchangeMessages, empty as getVacationExchangeMessages, empty as getExchangeThreads,
  empty as getDirectDirectory, empty as getDirectMessages, empty as getDirectThreads
};
