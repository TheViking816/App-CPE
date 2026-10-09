import { vacationOfferExpired } from "./exchangeDeadline.js";
import { professionalGroupCode } from "./professionalGroups.js";

export function dateRangeKeys(start, end) {
  if (!start || !end || start > end) return [];
  const first = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return [];
  const keys = [];
  for (const day = new Date(first); day <= last && keys.length <= 31; day.setDate(day.getDate() + 1)) {
    keys.push(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`);
  }
  return keys.length <= 31 ? keys : [];
}

export function canRespondToVacationOffer(offer, userProfessionalGroup) {
  if (offer.status !== "open" || offer.isOwn) return false;
  if (vacationOfferExpired(offer)) return false;
  const ownerGroup = professionalGroupCode(offer.professionalGroup);
  const userGroup = professionalGroupCode(userProfessionalGroup);
  if (!ownerGroup || !userGroup || ownerGroup !== userGroup) return false;
  const offered = dateRangeKeys(offer.offeredStart, offer.offeredEnd);
  const wanted = dateRangeKeys(offer.wantedStart, offer.wantedEnd);
  return offered.length > 0 && offered.length === wanted.length;
}
