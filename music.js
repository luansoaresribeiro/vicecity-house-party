// Music: "Tap to enter" splash → Inner Light starts with sound (phones never allow sound before a tap).
// The YouTube player is kept invisible (owner's choice); only a small "now playing" label shows.
// Keeps playing across tab/app switches and resumes from the same spot after a reload or a Stripe round-trip.
(() => {
  const M = window.PARTY && window.PARTY.music;
  if (!M || !M.youtubeId) return;
  const $ = (id) => document.getElementById(id);
  const splash = $("splash"), box = $("music"), btn = $("musicBtn");
  const KEY = "afterdark-music";
  let player = null, ready = false, wantPlay = false, playing = false;

  const saved = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || "{}"); } catch { return {}; } };
  const save = (patch) => { try { sessionStorage.setItem(KEY, JSON.stringify({ ...saved(), ...patch })); } catch {} };

  $("musicTitle").textContent = M.title.replace(" — ", " · ");
  box.hidden = false;
  splash.hidden = false;
  document.body.classList.add("locked");

  function ui(on) {
    playing = on;
    btn.setAttribute("aria-pressed", on);
    btn.setAttribute("aria-label", on ? "Pause music" : "Play music");
  }
  function play() {
    wantPlay = true; save({ on: true });
    if (!ready) return;
    try { player.unMute(); player.setVolume(80); player.playVideo(); } catch {}
  }
  function pause() {
    wantPlay = false; save({ on: false });
    if (ready) try { player.pauseVideo(); } catch {}
  }

  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player("ytPlayer", {
      videoId: M.youtubeId,
      host: "https://www.youtube-nocookie.com",
      playerVars: { playsinline: 1, loop: 1, playlist: M.youtubeId, rel: 0, autoplay: 0, controls: 0, start: Math.floor(saved().t || 0) },
      events: {
        onReady: () => { ready = true; if (wantPlay) play(); },
        onStateChange: (e) => ui(e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING),
      },
    });
  };
  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  document.head.append(s);

  // remember where the song is, so a reload / coming back from checkout continues from the same spot
  setInterval(() => { if (ready && playing) try { save({ t: player.getCurrentTime() }); } catch {} }, 2000);

  // back from another app or tab → keep the music going
  const resume = () => { if (wantPlay && !playing) play(); };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") setTimeout(resume, 300); });
  addEventListener("pageshow", (e) => { if (e.persisted) setTimeout(resume, 300); });
  addEventListener("focus", () => setTimeout(resume, 300));

  function enter() {
    if (splash.classList.contains("gone")) return;
    if (saved().on !== false) play(); // respect a pause from earlier in this visit
    splash.classList.add("gone");
    document.body.classList.remove("locked");
    setTimeout(() => { splash.hidden = true; }, 600);
  }
  splash.addEventListener("click", enter);
  splash.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); enter(); } });
  $("enterBtn").focus({ preventScroll: true });
  btn.addEventListener("click", () => (playing ? pause() : play()));

  // the label collapses once people scroll, so it never covers the form
  const compact = () => box.classList.toggle("compact", scrollY > 240);
  addEventListener("scroll", compact, { passive: true }); compact();
})();
