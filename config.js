// Public settings for the site. Nothing secret goes here (this file is public).
// Real prices, capacity and deadlines are enforced by the backend too.
window.PARTY = {
  // Supabase Edge Function that runs the backend. Empty = preview mode (sample guests, no payments).
  api: "https://xcbnfhhplfepacmvxcmv.supabase.co/functions/v1/party",
  capacity: 200,
  // ticket prices by phase (USD). Girls have no door price.
  prices: {
    female: { online: 20, late: 35 },
    male: { online: 40, late: 55, door: 70 },
  },
  // Online price until Wed Nov 18, 11:59 PM Miami time (EST = UTC-5)
  salesClose: "2026-11-18T23:59:59-05:00",
  // Late tickets keep selling on the site until Fri Nov 20, 6 PM Miami time
  lateClose: "2026-11-20T18:00:00-05:00",
  // countdown bar shows up on its own from Tue Nov 17, 12:00 AM Miami time (only while payments are open)
  countdownStart: "2026-11-17T00:00:00-05:00",
  // after online sales close, people text/call this number to request a ticket
  phone: "786-656-6926",
  // official YouTube video for the music button (just the ID after "v=" in the link). Empty = no music button.
  music: { youtubeId: "4DPCHufDWJQ", title: "Inner Light — Elderbrook & Bob Moses" },
  // Team / sport options in the request form
  teams: ["Soccer", "Volleyball", "Tennis", "Basketball", "Baseball", "Softball", "Golf", "Track & Field", "Swimming", "Football"],
};
