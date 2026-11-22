# Evidence-based social networks

`relgraph.social/0.1-draft` describes people, correspondence, societies and institutions. It uses the [graph source records](GENERIC-GRAPH.md) for nodes, groups, edges, evidence, layout and presentation, including camera keyframes and beats. Choose node kinds such as person or institution. Name the source of a membership, visit or letter in the relation's evidence. A shot can select that source with `"evidence": {"edgeId": "verse"}`.

The [social declaration schema](../packages/core/schema/social.schema.json) extends the shared grammar at `kinds.edges`. Each kind has two independent optional fields. `assertsCoPresence` says whether this kind claims the endpoints were present together. It defaults to false. `basis` describes the warrant for the relation itself and defaults to `"inferred"`. Both defaults apply to undeclared kinds. Names and quotations never implicitly set either field.

| Example kind | assertsCoPresence | basis |
| --- | --- | --- |
| 当面交往 (documented encounter) | true | attested |
| 诗文往来 (literary exchange) | false | attested |
| 交往推定 (inferred contact) | false | inferred |

The social sheet chooses dashed lines for inferred relations and solid lines for attested ones. A solid line on an inferred kind produces an `INFERRED_SOLID` warning with the effective declaration or project-configuration path and kind. The check follows the project's global, category and object appearance overrides, including undeclared kinds, and updates during Studio edits, undo and redo. A higher-priority dashed or dotted override clears the warning for the affected relations. Unused inferred-solid source declarations still receive a declaration warning. Explicit kind declarations retain their authored order; undeclared kinds use the shared frequency/name ranking so reordering the edge records does not change their colors or legend order.

Only a co-presence declaration grants eligibility for the reserved neutral form `shared-position`. No renderer implements that form in this version. The composer checks each request against the kind's forms and reports refused or unavailable forms in `DisplayList.formDiagnostics`.

Open **唐代诗人** in Studio or render the [sample](../examples/tang-correspondence.social.json) after building packages:

```sh
npm run relgraph -- render examples/tang-correspondence.social.json --out /tmp/tang-correspondence.mp4
```

## Recording the limits of the evidence

Set `noAttestedRelation: true` on an individual node to record that the author found no attested relation for that person **in this graph**. Every incident edge conflicts with this declaration, including an inferred or later-visible edge. The diagnostic names the source or target field. An isolated node without the declaration keeps its usual appearance. A marked node keeps its shape and has a hollow, broken outline. The Chinese legend reads “本图未找到有据关系”.

Use `rejectedPairs` for examined candidates. Each record requires a unique `id`, a `nodes` array naming two distinct people, a nonblank `reason`, and a nonempty `evidence` array using the existing citation format. A shot selects the note with `"evidence": {"pairNoteId": "wang-lu"}`. Optional `items` selects citations by index. The card and transcript show the two names, the reason and the selected sources when both people are visible. Notes contribute zero relations and have no connecting geometry or edge selection target.

The [two-person example](../examples/tang-absence.social.json) uses the 王勃 and 卢照邻 entries and the Four Talents shot in the [64-person dataset](../datasets/tang-poets-met/README.md). The dataset identifies the missing chronology for a proposed shared outing. The note records why this dataset excludes the candidate. Evidence about other encounters remains open.

Import the JSON in Studio or render the three-second shot locally:

```sh
npm run build:packages
npm run relgraph -- render examples/tang-absence.social.json --out /tmp/tang-absence.mp4
```
