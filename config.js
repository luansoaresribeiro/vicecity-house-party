// Public settings for the site. Nothing secret goes here (this file is public).
// Real prices, capacity and sales deadline are enforced by the backend too.
window.PARTY = {
  // Supabase Edge Function that runs the backend. Empty = preview mode (sample guests, no payments).
  api: "https://xcbnfhhplfepacmvxcmv.supabase.co/functions/v1/party",
  capacity: 200,
  prices: { ladies: 20, guys: 40, door: 70 },
  // Wed Nov 18, 11:59 PM Miami time (EST = UTC-5)
  salesClose: "2026-11-18T23:59:59-05:00",
  // after online sales close, people text/call this number to request a ticket
  phone: "786-656-6926",
  // official YouTube video for the music button (just the ID after "v=" in the link). Empty = no music button.
  music: { youtubeId: "4DPCHufDWJQ", title: "Inner Light — Elderbrook & Bob Moses" },
};
