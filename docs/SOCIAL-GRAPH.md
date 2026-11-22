# Evidence-based social networks

`relgraph.social/0.1-draft` describes people, correspondence, societies and institutions. It uses the [graph source records](GENERIC-GRAPH.md) for nodes, groups, edges, evidence, layout and presentation, including camera keyframes and beats. Choose node kinds such as person or institution. Name the source of a membership, visit or letter in the relation's evidence. A shot can select that source with `"evidence": {"edgeId": "verse"}`.

The [social declaration schema](../packages/core/schema/social.schema.json) extends the shared grammar at `kinds.edges`. Each kind has two independent optional fields. `assertsCoPresence` says whether this kind claims the endpoints were present together. It defaults to false. `basis` describes the warrant for the relation itself and defaults to `"inferred"`. Both defaults apply to undeclared kinds. Names and quotations never implicitly set either field.

| Example kind | assertsCoPresence | basis |
| --- | --- | --- |
| 当面交往 (documented encounter) | true | attested |
| 诗文往来 (literary exchange) | false | attested |
| 交往推定 (inferred contact) | false | inferred |

The social sheet chooses dashed lines for inferred relations and solid lines for attested ones. An explicit solid line on an inferred kind produces an `INFERRED_SOLID` warning with the declaration path and kind. Only a co-presence declaration grants eligibility for the reserved neutral form `shared-position`. No renderer implements that form in this version. The composer checks each request against the kind's forms and reports refused or unavailable forms in `DisplayList.formDiagnostics`.

Open **唐代诗人** in Studio or render the [sample](../examples/tang-correspondence.social.json) after building packages:

```sh
npm run relgraph -- render examples/tang-correspondence.social.json --out /tmp/tang-correspondence.mp4
```
