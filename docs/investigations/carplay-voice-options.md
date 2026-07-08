# Investigation: voice-driven quizzes in the car (Apple CarPlay)

*Researched 2026-07-08. Goal: let people run a quizmill practice session
hands-free while driving, ideally integrated with Apple CarPlay.*

## TL;DR

You cannot put a quiz UI on the CarPlay screen — Apple locks CarPlay to
entitlement-gated native app categories, and "games/trivia" is not one of
them. But you don't need the screen: shipped products (CarTrivia,
Drivetime/Drive.fm, Jeopardy's audio channel) prove the working pattern is
an **audio-first voice loop on the phone**, played through the car's
speakers, launched by Siri. And since **iOS 26.4 (March 2026)** there is a
brand-new CarPlay category — *voice-based conversational apps* (used by
ChatGPT, Gemini, Claude, Grok) — that finally offers a plausible, reviewed
path onto the CarPlay screen itself for a voice-primary quiz.

Recommended ladder: **(A)** a web "drive mode" to validate the UX →
**(B)** audio pack export (podcast-style) for zero-risk reach →
**(C)** a thin native iOS companion app with on-device speech (the
CarTrivia model, no Apple gatekeeping) → **(D)** apply for the iOS 26.4
voice-conversation CarPlay entitlement on top of C.

## Hard constraints found

1. **CarPlay is native-only and category-locked.** Apps need a per-category
   entitlement Apple approves individually: audio, communication, driving
   task, EV charging, fueling, navigation, parking, quick food ordering,
   plus (iOS 26) roadside assistance and vehicle diagnostics. Games and
   trivia are not a category; distraction concerns are the stated reason.
   ([Requesting CarPlay entitlements](https://developer.apple.com/documentation/carplay/requesting-carplay-entitlements),
   [CarPlay Developer Guide, June 2026](https://developer.apple.com/download/files/CarPlay-Developer-Guide.pdf))
2. **New in iOS 26.4: voice-based conversational apps.** Entitlement
   `com.apple.developer.carplay-voice-based-conversation`, a mandatory
   Voice Control template (visual "listening/processing" feedback, up to 4
   action buttons, max template depth 3), voice must be the primary
   modality, no text/imagery answers on screen, audio session held only
   while voice interaction is active. Apple reviews each request. ChatGPT
   shipped on it 2026-03-31; Grok followed in May.
   ([MacRumors](https://www.macrumors.com/2026/02/18/ios-26-4-carplay-support/),
   [AppleInsider](https://appleinsider.com/articles/26/03/31/openais-chatgpt-now-available-hands-free-via-carplay-with-ios-264))
3. **Custom Siri intents are blocked on CarPlay.** Third-party App Intents
   fail with "Sorry, I can't do that while you're driving"; only
   whitelisted SiriKit domains (calls, messaging, media) work. Siri *can*
   still launch an app by name — that's how CarTrivia starts hands-free.
   ([Apple Developer Forums](https://developer.apple.com/forums/thread/709496))
4. **Our PWA can't listen in installed mode.** Safari on iOS supports
   `webkitSpeechRecognition` (server-based, online-only) in the browser
   tab, but it does **not** work in an installed (standalone) PWA — the
   API feature-detects but never fires. `speechSynthesis` (TTS) works in
   both. ([whatpwacando.today](https://whatpwacando.today/speech-recognition/),
   [magicbell PWA iOS guide](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide))
5. **Precedents exist and were approved.** Drivetime/Drive.fm (voice
   trivia + a licensed Jeopardy! channel) and CarTrivia ("Siri, start
   CarTrivia"; works with CarPlay/Bluetooth) both operate as phone-side
   audio apps using the phone mic — neither needed a CarPlay screen UI.
   ([Drive.fm on the App Store](https://apps.apple.com/us/app/drivetime/id1357342274),
   [CarTrivia](https://cartrivia.app/))

## Options

### A. "Drive mode" in the existing web app — smallest step

A voice-first screen in the current PWA: TTS reads the question and the
four options ("A … B … C … D"), the user answers by voice, the app
confirms, explains on wrong answers (our mistakes-queue loop is already
built for this), and moves on. Audio reaches the car via Bluetooth/CarPlay
like any web audio.

- Works today with zero app-store involvement; `runner.ts` and
  `selection.ts` are pure and reusable as-is — this is just another runner
  surface next to PracticeRunner.
- Caveats: speech *recognition* only works in a Safari tab (not the
  installed PWA) and needs network; recognition quality is Siri's
  server service. Mitigation: constrain accepted answers to "A/B/C/D /
  one–four / the option text" and do fuzzy matching.
- Value: validates the whole spoken-MCQ UX (pacing, option phrasing,
  re-prompt on no-match) before any native work.

### B. Audio pack export — "podcast mode", zero platform risk

A build-time script (same family as `pack-assets.ts`) that renders a pack
into TTS audio episodes: question → options → thinking pause → answer +
explanation. Publish as static MP3s + RSS from the pack's Pages deploy;
people play it in any podcast app, in any car (CarPlay, Android Auto,
1998 Corolla), fully offline.

- No interactivity or scoring — it's drill-by-listening, not the practice
  loop. But it's pure static generation, exactly quizmill's ethos, and
  every registry pack gets it for free.
- Good TTS is the only real question (platform TTS vs. a paid neural
  voice API at pack-build time).

### C. Native iOS companion app, audio-first — the proven path

A thin native app (Swift, or Capacitor/React Native wrapping our web
runner) that loads a quizmill pack and runs the voice loop with native
speech APIs:

- `AVSpeechSynthesizer` for TTS and `SFSpeechRecognizer` for recognition —
  **on-device and offline-capable**, and `contextualStrings` lets us bias
  recognition toward the four option texts.
- Launched hands-free via a Siri App Shortcut ("Hey Siri, start
  quizmill"). Audio plays through CarPlay/Bluetooth as a background audio
  app. Phone mic listens (the car mic is reserved for Siri/calls).
- **No CarPlay entitlement needed at all** — this is exactly what
  CarTrivia ships. Works in every car, including non-CarPlay ones.
- Real costs: Apple developer account, App Store review (as a normal
  education/trivia app — uncontroversial), a pack-distribution story
  (bundle packs, or fetch from `<pack-id>.quizmill.dev`), and a separate
  progress store (or sync via the existing optional Supabase mirror).
- If built with React Native, `react-native-carplay` keeps option D open
  in the same codebase.

### D. CarPlay screen presence via the iOS 26.4 entitlement — the upgrade

Extend option C with `com.apple.developer.carplay-voice-based-conversation`
and the Voice Control template. The template's up-to-4 action buttons map
suspiciously well to A/B/C/D as a fallback for voice misses, and the
"voice-primary, no on-screen text answers" rules match a spoken quiz
naturally.

- Risk: the category is brand new and so far granted to AI assistants;
  Apple reviews every request and has historically kept
  games/entertainment off CarPlay. Framing matters — "voice-based
  conversational learning app", not "trivia game". Drivetime never got a
  CarPlay UI under the old regime; this entitlement did not exist then.
- Only worth attempting once C exists — the entitlement attaches to a
  native app, and rejection costs nothing since C works without it.

### Rejected shapes

- **CarPlay "audio app" entitlement with quiz-as-content** — the audio
  templates (lists + Now Playing) can't do answer input; abusing
  next/previous as answer buttons would fail review.
- **Siri-only quiz via App Intents** — custom intents are blocked while
  CarPlay is connected (constraint 3), and Siri can't hold a multi-turn
  third-party quiz dialogue anyway.
- **Anything requiring the PWA to listen while installed** — dead end on
  today's iOS (constraint 4).

## Recommendation

Do **A** and **B** now — both are pure web/static work inside this repo,
a few days each, and A settles the voice-UX design that everything later
inherits. Treat **C** as the real product milestone (first native code in
the project — decide Swift vs. Capacitor/RN then), and **D** as a cheap
entitlement application once C is live. Android Auto has a parallel story
(media-app category, similar restrictions) if C is built cross-platform.

## Safety note

Whatever ships must be genuinely eyes-free: no mid-drive screen
interaction, generous re-prompt timeouts, auto-pause when audio focus is
lost (navigation prompts, calls), and a "not while driving" gate on
anything visual.
