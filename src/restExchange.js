import { madridTodayKey, restOfferExpired } from "./exchangeDeadline.js";

export function canRespondToRestOffer(offer) {
  if (offer.status !== "open" || offer.isOwn) return false;
  if (restOfferExpired(offer)) return false;
  return true;
}

export function restPortalProcedure(offer, proposal) {
  const isSwap = offer.kind === "swap";
  const shouldSubmit = isSwap || (offer.kind === "give" ? offer.isOwn : proposal.isOwn);
  const portalDate = (value) => {
    const [year, month, day] = String(value || "").split("-");
    return year && month && day ? `${day}/${month}/${year}` : "—";
  };
  if (isSwap) {
    return {
      url: "https://portal.cpevalencia.com/#User,ViewNoray,15",
      label: "Abrir intercambio de descansos",
      instruction: `En el portal, indica TENGO: ${portalDate(offer.isOwn ? offer.offeredDate : proposal.offeredDate)}; CAMBIO CON: chapa ${proposal.counterpartChapa}; TIENE: ${portalDate(offer.isOwn ? proposal.offeredDate : offer.offeredDate)}.`
    };
  }
  return {
    url: "https://portal.cpevalencia.com/#User,ViewNoray,24",
    label: "Abrir cesión de descansos",
    instruction: shouldSubmit
      ? `Quien cede el descanso debe indicar en el portal TENGO: ${portalDate(offer.kind === "give" ? offer.offeredDate : proposal.offeredDate)}; CEDO A: chapa ${proposal.counterpartChapa}.`
      : "El compañero que cede el descanso debe presentar la petición en el portal oficial. La app no realiza la cesión."
  };
}
