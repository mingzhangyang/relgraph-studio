# ADR 001 — Video-first narrative graph

Status: **Accepted for prototype** · 2026-11-06

## Context

The primary deliverable is cinematic, understandable character relationship videos, not a general-purpose network analysis tool. Developing a full interactive graph editor before the first video would delay the proof of value.

## Decision

- Represent identities, relations, chapters and shots in `schemaVersion: "0.1"` JSON.
- Validate in two stages: JSON Schema structure and custom semantic references/rules.
- Derive chapter-visible projection without modifying source data; never expose `bio.fate` in spoiler-safe playback.
- Use declarative scenes with explicit duration, focus/highlight and chapter state.
- Render video frames deterministically; favor preset layouts over runtime physics when recording.
- Keep early rendering in Canvas 2D; only move to WebGL if real performance or scale requires it.

## State and limitations

The legacy offline demo is a functioning visual experiment, **not yet fed by the new data schema**. The graph contract and pure-core validator are checked independently. Export quality, 9:16 layouts, audio, provenance and production storytelling are future milestones.

## Consequences

An AI agent can produce valid data and scenes before an interactive GUI exists. Video, preview and future viewer share a contract while implementation of visual playback can evolve independently.
