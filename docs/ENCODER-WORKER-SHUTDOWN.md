# Encoder failure must not abort native render workers

**Merged:** PR #20 is on main as `a051d019d68ce2482de9e0ce4605fbb4f1862743`,
with the exact tree of the verified correction. The separate B2 data branch
has resumed from that main; its [current report](../datasets/honglou-chengjia-opening/VERIFICATION.md)
supersedes the historical paused-branch status below.

During B2-1 verification after PR #19 merged, the previously unexplained
fake-encoder child failure was reproduced independently of Vitest. This is a
runtime defect: forcibly terminating an active Skia worker can abort the entire
Node process. Keep this correction separate from the literary dataset.

## Reproduction and diagnosis

Base: `140af71abe9e7eef09ca79a5d100a7be95a92478`.
Linux x64, Node 24.22.1, skia-canvas 4.0.0. Main's normal 174-test,
37-browser-check and full two-film export gates passed on recheck; the
encoder-failure path nevertheless remained intermittent.

A fake FFmpeg answers `-version`/`-encoders`, reads 4,000,000 stdin bytes,
prints `fake encoder crashed` and exits 3. Render biology at 720p,
frames 0–23, with the default eight jobs. Of five standalone attempts on
the original implementation, one exited with `code: null, signal: SIGABRT`,
and four correctly returned CLI exit 1 with the encoder's exit-3 diagnostic.
The abort stderr named Neon's `tag.rs` / `error.rs`, `PendingException` and
`panic in a function that cannot unwind`. This establishes an actual native
abort; concurrency/resource pressure alone was not an adequate explanation.

The parent responds to an encoder write error by leaving `renderInOrder()`.
Its `finally` previously called `worker.terminate()` while other workers could
still be inside native Canvas calls. V8 termination can leave Neon with a
pending exception while executing those calls.

## Correction

- `RenderThread.close()` sends the worker's **existing** `{stop: true}` message
  and awaits its `exit` event. The port's FIFO lets queued native calls finish
  before the worker closes naturally. No more work is scheduled after failure.
- Worker initialization errors now close the port after reporting failure,
  because the ordinary stop handler has not yet been installed at that point.
- The bounded two-job-per-worker scheduling window, frame calculation,
  rendering, colour settings, fonts and output ordering are unchanged.

Error cleanup can finish the already queued work before returning the original
encoder diagnostic. This is intentionally graceful; it does not solve a native
call that never returns. There is no new playback clock, renderer or source
schema, and no B2 data is part of this correction.

## Verification

The existing isolated packed-consumer integration now exercises fake-encoder
failure with job counts 8, 2 and 8, requiring CLI exit 1, no terminating signal,
and the original encoder's exit code/stderr. It also launches the installed
worker with invalid source data and requires both an initialization error
message and natural exit, with a five-second regression deadline.

Executed on the correction:

| Check | Actual result |
| --- | --- |
| `npm ci` | 157 locked packages installed |
| Typecheck, lint, format, generated-type consistency | All pass |
| Package JS/declaration builds and studio production build | Pass |
| `npm test -- --reporter=verbose` | 174/174 tests, 24/24 files; expanded failure cases are inside the existing packed-consumer test |
| `npm run check:browser` | 37/37 Chromium checks; all 16 PNG files byte-identical to the main baseline |
| `npm run check:export` | 5/5 checks, 44/44 unchanged golden frames, both full MP4s probed, exact worker PNGs and decoded frame matching |
| Standalone fake-encoder failure, jobs 8/2, ten sequential attempts | 10/10: CLI exit 1, signal null, original exit-3 diagnostic retained |

No Actions CI was dispatched. No dataset MP4 or formal film was made as part
of this correction. Logs and QA outputs remain local under `output/` and `/tmp`.

## Gate, rollback and resumption

The B2-1 source files, ledger, report, handoff and targeted tests already
prepared in local commit `2cb9ea6f9498140f7ca585c89b3ffc1d05f09939` on
`feat/b2-1-honglou-source-verified` remain separate and unpushed. They contain
six people, nine relations, fifteen evidence excerpts and thirty-nine pinned
source-page revisions. The data passed the existing validator, seven focused
quality tests, a live source audit and four Skia size/theme frame checks.
Its complete suite had one 181/181 run but also reproduced this native abort;
its new Chromium scenarios have not yet been executed. Do not describe
that data work as released while this acceptance defect remains on main.
After this fix is reviewed and merged, rebase that data branch on latest main,
run its full checks and create its own Draft PR.

Reverting this correction restores forced termination and the intermittent
native abort. There is no schema or persistence migration to reverse.
