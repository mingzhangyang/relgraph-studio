// Optional network audit of pinned primary-text revisions, not studio runtime.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const digest = (value) => createHash('sha256').update(value).digest('hex');

/** Verify identity and exact raw text before testing excerpt membership. */
export function verifyTranscriptions(ledger, revisions) {
  const indexed = new Map(revisions.map((revision) => [revision.revisionId, revision]));
  const content = new Map();
  for (const source of ledger.sources) {
    const revision = indexed.get(source.revisionId);
    assert.ok(revision, `Missing revision ${source.revisionId}`);
    assert.equal(revision.pageTitle, source.pageTitle, `Wrong page: ${source.id}`);
    assert.equal(digest(revision.content), source.wikitextSha256, `Changed text: ${source.id}`);
    content.set(source.id, revision.content);
  }
  for (const evidence of ledger.evidence)
    assert.ok(
      content.get(evidence.sourceId)?.includes(evidence.text),
      `Excerpt absent: ${evidence.id}`,
    );
  return { revisions: content.size, excerpts: ledger.evidence.length };
}

async function download(url, maxBuffer) {
  // curl follows the managed environment's proxy/CA settings on all supported
  // Node versions; Node 20's fetch does not automatically use HTTP(S)_PROXY.
  const { stdout } = await run(
    'curl',
    [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--max-time',
      '60',
      '--user-agent',
      'RelGraphStudio-source-verification/0.1',
      url,
    ],
    { encoding: 'buffer', maxBuffer },
  );
  return stdout;
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(
    args.length === 0 || (args.length === 2 && args[0] === '--scan-file'),
    'Usage: npm run check:honglou-sources [-- --scan-file <downloaded original PDF>]',
  );
  const ledger = JSON.parse(
    await readFile(new URL('../datasets/honglou-chengjia-opening/sources.json', import.meta.url)),
  );
  const url = new URL('https://zh.wikisource.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'revisions',
    rvprop: 'ids|content',
    rvslots: 'main',
    revids: ledger.sources.map((source) => source.revisionId).join('|'),
  }).toString();
  const response = JSON.parse((await download(url.href, 8 << 20)).toString('utf8'));
  assert.ok(!response.error && response.query?.pages, 'MediaWiki did not return source pages');
  const revisions = Object.values(response.query.pages).flatMap((page) =>
    (page.revisions ?? []).map((revision) => ({
      pageTitle: page.title,
      revisionId: revision.revid,
      content: revision.slots.main['*'],
    })),
  );
  const checked = verifyTranscriptions(ledger, revisions);
  const scan = ledger.edition.scan;
  const bytes = args.length ? await readFile(args[1]) : await download(scan.url, 32 << 20);
  assert.equal(bytes.length, scan.bytes, 'Scan byte count changed');
  assert.equal(digest(bytes), scan.sha256, 'Scan SHA-256 changed');
  console.log(`PASS ${checked.revisions} pinned revisions and ${checked.excerpts} exact excerpts`);
  console.log(`PASS original scan: ${bytes.length} bytes, SHA-256 ${scan.sha256}`);
  console.log(
    'This checks source identity and excerpt membership; literary interpretation and scan reading require review.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
