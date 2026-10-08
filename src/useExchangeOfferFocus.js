import { useEffect, useRef, useState } from "react";
import { exchangeOfferFromHash } from "./navigation.js";

const emptyFilters = { search: "", group: "", kind: "", date: "" };

export default function useExchangeOfferFocus(routeTab, panelRef, loading, tab, setTab, visible, setFilters) {
  const [offerId, setOfferId] = useState("");
  const focusedRef = useRef("");

  useEffect(() => {
    const followHash = () => {
      const route = exchangeOfferFromHash(window.location.hash);
      const nextId = route?.tab === routeTab ? route.offerId : "";
      setOfferId(nextId);
      if (!nextId) return;
      focusedRef.current = "";
      setTab("board");
      setFilters({ ...emptyFilters });
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    followHash();
    window.addEventListener("hashchange", followHash);
    return () => window.removeEventListener("hashchange", followHash);
  }, [routeTab, panelRef, setTab, setFilters]);

  useEffect(() => {
    if (!offerId || loading || tab !== "board" || focusedRef.current === offerId) return;
    const panel = panelRef.current;
    const card = Array.from(panel?.querySelectorAll("[data-offer-id]") || [])
      .find((item) => item.dataset.offerId === offerId);
    (card || panel)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (card) card.focus({ preventScroll: true });
    focusedRef.current = offerId;
  }, [offerId, loading, tab, visible, panelRef]);

  return offerId;
}
