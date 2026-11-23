---
id: DB-6891
title: Starting a download reveals the Downloads tab
priority: medium
labels: [downloads, notification]
created: 2026-08-01
revised: 2026-08-11
---

# DB-6891 — Starting a download reveals the Downloads tab

## Background

A download started from a clip should show where it went.

## Requirements

- R1: starting a download opens Notification on the Downloads tab.
- R2: the reveal request is consumed once.

## Changelog

- **2026-08-11**: added the consume rule to R2
  - 사유: the request stayed set after the first reveal
  - 영향: `downloadOwnershipStore.ts`
