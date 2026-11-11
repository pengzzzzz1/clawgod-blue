# Unrestricted runtime

Do not hand-edit hit counts in this file. Apply results come from:

```powershell
node src/shared/patch.mjs
node scripts/verify.mjs
```

`patch.mjs` stdout is the live matcher report (applied / skipped / tolerated / failed). `scripts/verify.mjs` is the only pass/fail number README and CI may cite.

Runtime layers (source, not marketing):

| Layer | File | When it runs |
|---|---|---|
| Bundle verdicts | `src/shared/patch.mjs` vengeance-* + url-restriction | Install / `-NoUpgrade` |
| Fetch strip | `src/shared/redline-strip.cjs` `activate()` | Launch, unless `CLAWGOD_REDLINE=0` |
| Completions retry | `src/shared/openai-proxy.cjs` | `provider.json` `protocol=openai-chat` |
| User memory | `src/shared/supreme-memory.cjs` `render()` | Launch; paths from this machine, not the git tree |

`redline-strip.cjs` must not hook `globalThis.fetch` on `require()`. Tests import `transform` without installing the hook; `cli.cjs` calls `activate()` after version-only queries are skipped.
