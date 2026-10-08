import { supabase } from "./supabaseClient.js";

export async function getRestExchange({ token }) {
  if (!supabase || !token) return { offers: [], proposals: [] };
  const { data, error } = await supabase.rpc("app_cpe_rest_exchange_list", { p_token: token });
  if (error) throw error;
  return data || { offers: [], proposals: [] };
}

export async function publishRestExchange({ token, kind, offeredDate = null, wantedDate = null }) {
  const { data, error } = await supabase.rpc("app_cpe_rest_exchange_publish", {
    p_token: token, p_kind: kind, p_offered_date: offeredDate, p_wanted_date: wantedDate
  });
  if (error) throw error;
  return data;
}

export async function updateRestExchange({ token, offerId, kind, offeredDate = null, wantedDate = null }) {
  const { data, error } = await supabase.rpc("app_cpe_rest_exchange_update", {
    p_token: token, p_offer_id: offerId, p_kind: kind,
    p_offered_date: offeredDate, p_wanted_date: wantedDate
  });
  if (error) throw error;
  return data;
}

export async function getRestExchangeMessages({ token, proposalId }) {
  const { data, error } = await supabase.rpc("app_cpe_rest_exchange_messages", {
    p_token: token, p_proposal_id: proposalId
  });
  if (error) throw error;
  return data || [];
}

export async function getExchangeThreads({ token }) {
  const { data, error } = await supabase.rpc("app_cpe_exchange_threads", { p_token: token });
  if (error && !["PGRST202", "42883"].includes(error.code)) throw error;
  if (error) {
    // A Git preview can use the current database before its branch migration is applied.
    const [rests, vacations] = await Promise.all([
      getRestExchange({ token }), getVacationExchange({ token })
    ]);
    const restThreads = (rests.proposals || []).flatMap((proposal) => {
      const offer = (rests.offers || []).find((item) => item.id === proposal.offerId);
      if (!offer) return [];
      return [{ type: "rest", proposalId: proposal.id, offerId: offer.id,
        counterpartName: offer.isOwn ? proposal.proposerName : offer.ownerName,
        counterpartChapa: proposal.counterpartChapa || null, status: proposal.status,
        offerStatus: offer.status, offered: offer.isOwn ? offer.offeredDate : proposal.offeredDate,
        wanted: offer.isOwn ? offer.wantedDate : offer.offeredDate,
        createdAt: proposal.createdAt, lastAt: proposal.createdAt, lastMessage: null, unread: 0 }];
    });
    const vacationThreads = (vacations.proposals || []).flatMap((proposal) => {
      const offer = (vacations.offers || []).find((item) => item.id === proposal.offerId);
      if (!offer) return [];
      return [{ type: "vacation", proposalId: proposal.id, offerId: offer.id,
        counterpartName: offer.isOwn ? proposal.proposerName : offer.ownerName,
        counterpartChapa: proposal.counterpartChapa || null, status: proposal.status,
        offerStatus: offer.status, offered: offer.isOwn ? offer.offeredStart : offer.wantedStart,
        offeredEnd: offer.isOwn ? offer.offeredEnd : offer.wantedEnd,
        wanted: offer.isOwn ? offer.wantedStart : offer.offeredStart,
        wantedEnd: offer.isOwn ? offer.wantedEnd : offer.offeredEnd,
        createdAt: proposal.createdAt, lastAt: proposal.createdAt, lastMessage: null, unread: 0 }];
    });
    return [...restThreads, ...vacationThreads].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }
  return data || [];
}

export async function touchDirectPresence({ token }) {
  if (!supabase || !token) return false;
  const { data, error } = await supabase.rpc("app_cpe_direct_touch", { p_token: token });
  if (error) throw error;
  return Boolean(data);
}

export async function getDirectDirectory({ token }) {
  const { data, error } = await supabase.rpc("app_cpe_direct_directory", { p_token: token });
  if (error) throw error;
  return data || [];
}

export async function getDirectThreads({ token }) {
  const { data, error } = await supabase.rpc("app_cpe_direct_threads", { p_token: token });
  if (error) throw error;
  return data || [];
}

export async function startDirectConversation({ token, chapa }) {
  const { data, error } = await supabase.rpc("app_cpe_direct_start", {
    p_token: token, p_chapa: chapa
  });
  if (error) throw error;
  return data;
}

export async function getDirectMessages({ token, conversationId }) {
  const { data, error } = await supabase.rpc("app_cpe_direct_messages", {
    p_token: token, p_conversation_id: conversationId
  });
  if (error) throw error;
  return data || [];
}

export async function sendDirectMessage({ token, conversationId, body }) {
  const { data, error } = await supabase.rpc("app_cpe_direct_send", {
    p_token: token, p_conversation_id: conversationId, p_body: body
  });
  if (error) throw error;
  return data;
}

export async function markDirectRead({ token, conversationId }) {
  const { data, error } = await supabase.rpc("app_cpe_direct_mark_read", {
    p_token: token, p_conversation_id: conversationId
  });
  if (error) throw error;
  return data;
}

export async function deleteDirectConversation({ token, conversationId }) {
  const { data, error } = await supabase.rpc("app_cpe_direct_delete", {
    p_token: token, p_conversation_id: conversationId
  });
  if (error) throw error;
  return data;
}

export async function markExchangeThreadRead({ token, type, proposalId }) {
  const { data, error } = await supabase.rpc("app_cpe_exchange_mark_read", {
    p_token: token, p_type: type, p_proposal_id: proposalId
  });
  if (error) throw error;
  return data;
}

export async function sendRestExchangeMessage({ token, proposalId, body }) {
  const { data, error } = await supabase.rpc("app_cpe_rest_exchange_send_message", {
    p_token: token, p_proposal_id: proposalId, p_body: body
  });
  if (error) throw error;
  return data;
}

export async function getVacationExchange({ token }) {
  const { data, error } = await supabase.rpc("app_cpe_vacation_exchange_list", { p_token: token });
  if (error) throw error;
  return data || { offers: [], proposals: [] };
}

export async function publishVacationExchange({ token, offeredStart, offeredEnd, wantedStart, wantedEnd }) {
  const { data, error } = await supabase.rpc("app_cpe_vacation_exchange_publish", {
    p_token: token, p_offered_start: offeredStart, p_offered_end: offeredEnd,
    p_wanted_start: wantedStart, p_wanted_end: wantedEnd
  });
  if (error) throw error;
  return data;
}

export async function updateVacationExchange({ token, offerId, offeredStart, offeredEnd, wantedStart, wantedEnd }) {
  const { data, error } = await supabase.rpc("app_cpe_vacation_exchange_update", {
    p_token: token, p_offer_id: offerId, p_offered_start: offeredStart, p_offered_end: offeredEnd,
    p_wanted_start: wantedStart, p_wanted_end: wantedEnd
  });
  if (error) throw error;
  return data;
}

export async function proposeVacationExchange({ token, offerId }) {
  const { data, error } = await supabase.rpc("app_cpe_vacation_exchange_propose", {
    p_token: token, p_offer_id: offerId
  });
  if (error) throw error;
  return data;
}

export async function decideVacationExchange({ token, proposalId, accept }) {
  const { data, error } = await supabase.rpc("app_cpe_vacation_exchange_decide", {
    p_token: token, p_proposal_id: proposalId, p_accept: accept
  });
  if (error) throw error;
  return data;
}

export async function cancelVacationExchange({ token, offerId }) {
  const { data, error } = await supabase.rpc("app_cpe_vacation_exchange_cancel", {
    p_token: token, p_offer_id: offerId
  });
  if (error) throw error;
  return data;
}

export async function withdrawVacationExchange({ token, proposalId }) {
  const { data, error } = await supabase.rpc("app_cpe_vacation_exchange_withdraw", {
    p_token: token, p_proposal_id: proposalId
  });
  if (error) throw error;
  return data;
}

export async function getVacationExchangeMessages({ token, proposalId }) {
  const { data, error } = await supabase.rpc("app_cpe_vacation_exchange_messages", {
    p_token: token, p_proposal_id: proposalId
  });
  if (error) throw error;
  return data || [];
}

export async function sendVacationExchangeMessage({ token, proposalId, body }) {
  const { data, error } = await supabase.rpc("app_cpe_vacation_exchange_send_message", {
    p_token: token, p_proposal_id: proposalId, p_body: body
  });
  if (error) throw error;
  return data;
}

export async function proposeRestExchange({ token, offerId, offeredDate = null }) {
  const { data, error } = await supabase.rpc("app_cpe_rest_exchange_propose", {
    p_token: token, p_offer_id: offerId, p_offered_date: offeredDate
  });
  if (error) throw error;
  return data;
}

export async function decideRestExchange({ token, proposalId, accept }) {
  const { data, error } = await supabase.rpc("app_cpe_rest_exchange_decide", {
    p_token: token, p_proposal_id: proposalId, p_accept: accept
  });
  if (error) throw error;
  return data;
}

export async function cancelRestExchange({ token, offerId }) {
  const { data, error } = await supabase.rpc("app_cpe_rest_exchange_cancel", {
    p_token: token, p_offer_id: offerId
  });
  if (error) throw error;
  return data;
}

export async function withdrawRestExchange({ token, proposalId }) {
  const { data, error } = await supabase.rpc("app_cpe_rest_exchange_withdraw", {
    p_token: token, p_proposal_id: proposalId
  });
  if (error) throw error;
  return data;
}


