export function recentPersonalOffers(offers = [], proposals = [], limit = 5) {
  const participating = offers.filter((offer) => offer.isOwn
    || proposals.some((proposal) => proposal.offerId === offer.id && proposal.isOwn));
  const active = participating.filter((offer) => offer.status === "open");
  const agreements = participating.filter((offer) => offer.status === "agreed")
    .sort((a, b) => {
      const acceptedAt = (offer) => proposals.find((proposal) => proposal.offerId === offer.id
        && proposal.status === "accepted")?.createdAt || offer.createdAt || "";
      return acceptedAt(b).localeCompare(acceptedAt(a));
    })
    .slice(0, limit);
  return [...active, ...agreements];
}

export function counterpartName(offer, proposal) {
  return (offer.isOwn ? proposal.proposerName : offer.ownerName)?.trim() || "Compañero";
}
