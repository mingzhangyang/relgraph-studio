import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import graphDocument from '../datasets/honglou-chengjia-opening/graph.relgraph.json' with { type: 'json' };
import ledger from '../datasets/honglou-chengjia-opening/sources.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { validateRelGraph, visibleStory } from '../packages/core/src/relgraph.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt, frameCount } from '../packages/core/src/director/state.ts';
import { compileTimeline } from '../packages/core/src/director/timeline.ts';
import { domainStyle } from '../packages/core/src/style.ts';
import { composeFrame } from '../packages/render/src/compose.ts';
import { FRAME_SPECS, cameraFitFor } from '../packages/render/src/frame-spec.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { walkDisplayItems } from '../packages/render/src/display-list.ts';
import { measure } from './helpers/display-list.mjs';
import { verifyTranscriptions } from '../scripts/check-honglou-sources.mjs';

const evidence = new Map(ledger.evidence.map((entry) => [entry.id, entry]));
const sources = new Map(ledger.sources.map((entry) => [entry.id, entry]));
const handoff = readFileSync(
  new URL('../datasets/honglou-chengjia-opening/B2-2-HANDOFF.md', import.meta.url),
  'utf8',
);
const loaded = loadDocument(graphDocument);
assert.equal(loaded.valid, true);
const graph = loaded.graph;
const positions = layoutGraph(graph);
const provenance = (record) => record.extra.provenance;

test('bounded source-verified dataset validates and adapts without warnings or schema changes', () => {
  assert.deepEqual(validateRelGraph(graphDocument), { valid: true, errors: [], warnings: [] });
  assert.equal(loaded.warnings.length, 0);
  assert.equal(graph.nodes.length, 6);
  assert.equal(graph.edges.length, 9);
  assert.equal(graph.domain, 'literature');
  assert.equal(frameCount(graph), 72, 'three-second QA scaffold, not a completed film');
  const ids = graphDocument.characters.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(graphDocument.relations.map((r) => r.id)).size, 9);
  for (const relation of graphDocument.relations) {
    assert.ok(ids.includes(relation.source));
    assert.ok(ids.includes(relation.target));
  }
  for (const mutate of [
    (doc) => {
      doc.characters[1].id = doc.characters[0].id;
    },
    (doc) => {
      doc.relations[1].id = doc.relations[0].id;
    },
    (doc) => {
      doc.relations[0].target = 'missing';
    },
    (doc) => {
      doc.relations[0].chapters = { from: 3, to: 2 };
    },
  ]) {
    const invalid = structuredClone(graphDocument);
    mutate(invalid);
    assert.equal(validateRelGraph(invalid).valid, false);
  }
});

test('every excerpt has a pinned primary page, scan locator, verification state and edition', () => {
  assert.equal(graphDocument.extra.datasetId, ledger.datasetId);
  assert.equal(ledger.edition.id, 'chengjia-1791');
  assert.equal(sources.size, ledger.sources.length);
  assert.equal(evidence.size, ledger.evidence.length);
  assert.equal(sources.size, 39, 'all underlying pages in the chapter 1–3 reading window');
  for (const source of sources.values()) {
    assert.ok(Number.isSafeInteger(source.revisionId) && source.revisionId > 0);
    assert.ok(source.revisionUrl.endsWith(`oldid=${source.revisionId}`));
    assert.match(source.wikitextSha256, /^[a-f0-9]{64}$/);
    assert.ok(source.scanUrl.endsWith(`#page=${source.pdfPage}`));
    assert.ok(source.revisionTimestamp < ledger.verifiedAt);
  }
  for (const entry of evidence.values()) {
    const source = sources.get(entry.sourceId);
    assert.ok(source, entry.id);
    assert.equal(source.scanReview, 'evidence-passages-checked');
    assert.equal(entry.verification, 'transcription-and-scan-checked');
    assert.ok(
      entry.checkedAt <= ledger.verifiedAt,
      `${entry.id} checked after the ledger verification date`,
    );
    assert.ok(entry.text.length > 0 && Array.from(entry.text).length < 100);
    assert.ok(entry.context.length > 0);
    const window = ledger.readingWindow.find((part) => part.chapter === entry.at);
    assert.ok(window?.pdfPages.includes(source.pdfPage));
  }
});

test('B2-2 handoff reports the current source-ledger evidence count', () => {
  const match = handoff.match(/^- \[来源台账\]\(sources\.json\)：(\d+) 条短证据、/m);
  assert.ok(match, 'handoff source-ledger count');
  assert.equal(Number(match[1]), ledger.evidence.length);
});

function assertEvidence(ids, through = 3) {
  assert.ok(ids.length > 0);
  for (const id of ids) {
    assert.ok(evidence.has(id), id);
    assert.ok(evidence.get(id).at <= through, `${id} would reveal later information`);
  }
}

test('character identities, aliases, summaries and first mentions keep their own source times', () => {
  for (const character of graphDocument.characters) {
    const p = provenance(character);
    assert.equal(p.status, 'verified-direct');
    assert.equal(character.firstAppearance, p.firstMention.at);
    assert.equal(character.firstAppearance, p.safeRevealAt);
    assert.equal(p.reviewedThrough, ledger.reviewedThrough);
    assert.ok(character.firstAppearance >= 1 && character.firstAppearance <= 3);
    assertEvidence(p.evidenceIds);
    assertEvidence(p.firstMention.evidenceIds, character.firstAppearance);
    assertEvidence(p.summaryEvidenceIds, character.firstAppearance);
    assert.equal(
      p.firstOnstage.status,
      'not-systematically-audited',
      'mention is not a claim of first onstage appearance',
    );
    assert.deepEqual(
      p.aliasEvidence.map((a) => a.value),
      character.aliases,
    );
    for (const alias of p.aliasEvidence) assertEvidence(alias.evidenceIds, alias.at);
    assert.deepEqual(
      character.bio.quotes.map((q) => q.text),
      p.evidenceIds.map((id) => evidence.get(id).text),
    );
  }
  const atTwo = visibleStory(graphDocument, 2, true);
  const zheng = atTwo.bios['jia-zheng'];
  assert.ok(zheng.quotes.every((quote) => quote.at <= 2));
  assert.ok(
    !JSON.stringify(zheng).includes('存周'),
    'later alias evidence withheld from safe biography',
  );
});

test('direct facts and the single kinship inference stay distinct with complete dependencies', () => {
  assert.equal(
    graphDocument.relations.filter((r) => provenance(r).status === 'verified-direct').length,
    8,
  );
  for (const relation of graphDocument.relations) {
    const p = provenance(relation);
    assert.ok(['verified-direct', 'inferred'].includes(p.status));
    assert.equal(p.safeRevealAt, relation.chapters.from);
    assert.ok(p.safeRevealAt >= p.evidenceConfirmedAt && p.safeRevealAt <= 3);
    assertEvidence(p.evidenceIds, p.safeRevealAt);
    assert.deepEqual(
      relation.evidence.map((q) => q.text),
      p.evidenceIds.map((id) => evidence.get(id).text),
    );
    for (const quote of relation.evidence) assert.ok(quote.context.includes('oldid='));
    assert.equal(
      relation.strength,
      2,
      'encoding weight, not invented scholarly relationship intensity',
    );
    assert.equal(relation.polarity, 'neutral');
    if (p.status === 'inferred') {
      assert.equal(relation.id, 'baoyu-daiyu');
      assert.match(relation.label, /推导/);
      assert.deepEqual(p.derivedFrom, ['zheng-min', 'min-daiyu', 'zheng-baoyu']);
      for (const id of p.derivedFrom) {
        const dependency = graphDocument.relations.find((r) => r.id === id);
        assert.equal(provenance(dependency).status, 'verified-direct');
        assert.ok(dependency.chapters.from <= relation.chapters.from);
      }
    }
  }
});

const earlyEdges = [
  'lin-marriage',
  'ruhai-daiyu',
  'min-daiyu',
  'mu-zheng',
  'zheng-min',
  'zheng-baoyu',
];
test('production projection and a11y reveal only chapter-safe data and withdraw on rewind', () => {
  for (const [frame, nodeCount, edgeIds] of [
    [0, 0, []],
    [24, 6, earlyEdges],
    [48, 6, graph.edges.map((e) => e.id)],
    [0, 0, []],
    [24, 6, earlyEdges],
  ]) {
    const state = directorFrameAt(graph, positions, frame);
    assert.equal(state.view.nodes.length, nodeCount);
    assert.deepEqual(
      state.view.edges.map((e) => e.id),
      edgeIds,
    );
    const list = composeFrame(state, {
      graph,
      positions,
      frame,
      fps: 24,
      measure,
      style: domainStyle('literature'),
      detailAt: loaded.detailAt,
    });
    assert.equal(list.a11y.nodes.length, nodeCount);
    assert.equal(list.a11y.relations.length, edgeIds.length);
    const text =
      JSON.stringify(list.a11y) +
      [...walkDisplayItems(list.items)]
        .filter((i) => i.type === 'text')
        .map((i) => i.text)
        .join(' ');
    if (frame === 0)
      for (const character of graphDocument.characters) assert.ok(!text.includes(character.name));
    if (frame === 24) assert.doesNotMatch(text, /外祖母|外孙女|姑舅/);
  }
  const timeline = compileTimeline(graph);
  assert.equal(timeline.shots[0].view.nodes.length, 0);
});

test('every random-access frame matches fresh composition in both sizes and themes', () => {
  const before = JSON.stringify(graphDocument);
  for (const spec of Object.values(FRAME_SPECS))
    for (const theme of ['light', 'dark']) {
      const at = (frame) =>
        composeFrame(
          directorFrameAt(graph, positions, frame, spec.fps, { fit: cameraFitFor(spec) }),
          {
            graph,
            positions,
            frame,
            fps: spec.fps,
            measure,
            frameSpec: spec,
            theme: VIDEO_THEMES[theme],
            style: domainStyle('literature'),
            detailAt: loaded.detailAt,
          },
        );
      const baseline = Array.from({ length: frameCount(graph) }, (_, frame) => at(frame));
      // A coprime permutation visits every frame in a different order.
      for (let index = 0; index < baseline.length; index++) {
        const frame = (index * 29) % baseline.length;
        assert.deepEqual(at(frame), baseline[frame]);
      }
    }
  assert.equal(JSON.stringify(graphDocument), before, 'source and provenance stay immutable');
});

test('source audit rejects missing revisions, wrong pages, changed text and absent excerpts', () => {
  const content = '公版原文短证据';
  const fixture = {
    sources: [
      {
        id: 's',
        revisionId: 1,
        pageTitle: 'Page:one',
        wikitextSha256: createHash('sha256').update(content).digest('hex'),
      },
    ],
    evidence: [{ id: 'e', sourceId: 's', text: '原文短证据' }],
  };
  const revisions = [{ revisionId: 1, pageTitle: 'Page:one', content }];
  assert.deepEqual(verifyTranscriptions(fixture, revisions), { revisions: 1, excerpts: 1 });
  assert.throws(() => verifyTranscriptions(fixture, []), /Missing revision/);
  assert.throws(
    () => verifyTranscriptions(fixture, [{ ...revisions[0], pageTitle: 'Page:other' }]),
    /Wrong page/,
  );
  assert.throws(
    () => verifyTranscriptions(fixture, [{ ...revisions[0], content: 'altered' }]),
    /Changed text/,
  );
  const badQuote = structuredClone(fixture);
  badQuote.evidence[0].text = '未经核实的添加';
  assert.throws(() => verifyTranscriptions(badQuote, revisions), /Excerpt absent/);
});
