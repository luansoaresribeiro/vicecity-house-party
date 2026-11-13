// Music: "Tap to enter" splash → the official YouTube video starts with sound.
// Phones and browsers never allow sound before the visitor taps, so the entry tap is that permission.
// YouTube's rules require the player to stay visible (min 200px tall), so it lives in the "Now playing" card.
(() => {
  const M = window.PARTY && window.PARTY.music;
  if (!M || !M.youtubeId) return;
  const $ = (id) => document.getElementById(id);
  const splash = $("splash"), btn = $("musicBtn");
  let player = null, ready = false, wantPlay = false, playing = false;

  $("nowPlaying").hidden = false;
  $("npTitle").textContent = M.title;
  btn.hidden = false;
  splash.hidden = false;
  document.body.classList.add("locked");

  function ui(on) {
    playing = on;
    btn.setAttribute("aria-pressed", on);
    btn.setAttribute("aria-label", on ? "Pause music" : "Play music");
  }
  function play() {
    wantPlay = true;
    if (!ready) return;
    try { player.unMute(); player.setVolume(80); player.playVideo(); } catch {}
  }
  function pause() {
    wantPlay = false;
    if (ready) try { player.pauseVideo(); } catch {}
  }

  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player("ytPlayer", {
      videoId: M.youtubeId,
      host: "https://www.youtube-nocookie.com",
      playerVars: { playsinline: 1, loop: 1, playlist: M.youtubeId, rel: 0, autoplay: 0 },
      events: {
        onReady: () => { ready = true; if (wantPlay) play(); },
        onStateChange: (e) => ui(e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING),
      },
    });
  };
  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  document.head.append(s);

  function enter() {
    if (splash.classList.contains("gone")) return;
    play();
    splash.classList.add("gone");
    document.body.classList.remove("locked");
    setTimeout(() => { splash.hidden = true; }, 600);
  }
  splash.addEventListener("click", enter);
  splash.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); enter(); } });
  $("enterBtn").focus({ preventScroll: true });
  btn.addEventListener("click", () => (playing ? pause() : play()));
})();
