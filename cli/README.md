# quizmill

**The mill that grinds questions into knowledge.**

Turn a folder of JSON — a *learning pack* — into a fast, installable,
offline-first practice app. Engine docs at
[github.com/quizmill/quizmill](https://github.com/quizmill/quizmill);
the story at [quizmill.dev](https://quizmill.dev).

```
npx quizmill new my-topic        # scaffold a pack (or have your AI agent fill it)
npx quizmill run my-topic        # practice at localhost:3000
npx quizmill run quizmill/pack-claude-cert   # or any GitHub pack repo
npx quizmill build my-topic      # static app in my-topic-app/ — deploy anywhere
```

| Command | What |
|---|---|
| `new [dir]` | scaffold a learning pack with an agent-ready README |
| `validate <dir>` | schema + cross-reference checks (agents loop on this) |
| `run [dir\|owner/repo]` | activate a pack and start the app |
| `build [dir\|owner/repo]` | emit a deployable static app in `<pack-id>-app/` |
| `list` | published packs you can install |
| `upgrade` | update the cached engine in `~/.quizmill` |

The CLI is a zero-dependency wrapper: it keeps an engine checkout in
`~/.quizmill/engine` and shells out to its npm scripts. Requires Node
≥ 18, git and npm.

Packs are private by default — they live wherever you put them. Push
one to a GitHub repo and `quizmill run owner/repo` works for anyone
with access; see the engine README to get listed in the public
registry. MIT.
