# React Lazy and Form Preview Safety Design

Date: 2026-04-15
Status: Ready for user review

## Summary

This design improves perceived page-load performance in the frontend without breaking public SurveyJS rendering or preview flows.

The approved first-stage direction is:

- move the base SurveyJS theme CSS into the global app entry so public forms and previews always receive styling
- keep Survey Builder CSS scoped to builder-only code
- use `route.lazy` for secondary heavy route modules instead of pushing form-critical routes behind a lazy boundary
- keep public form rendering and preview rendering eager
- stop blocking the responses page on loading every page of responses before the first render
- keep already rendered UI visible during refreshes and avoid returning a full-page fallback after first successful render
- allow XLSX export to load all response pages on demand on the client as a temporary first-stage solution

This is a targeted performance and loading-behavior change. It is not a larger architecture rewrite.

## Goals

- Reduce initial JavaScript and CSS shipped for common user paths.
- Protect `/form/:id` and response preview rendering from builder-driven CSS regressions.
- Improve first-load UX for large response tables by showing the first page quickly.
- Preserve already rendered content during refetches instead of replacing it with a full-page loading state.
- Use React Router code splitting in the way that fits the current `createBrowserRouter` setup.

## Non-Goals

- No rewrite of `SurveyFormRenderer` behavior or public form UX.
- No virtualization in this first stage.
- No server-side export implementation in this first stage.
- No server-side pagination model rewrite beyond changing what the first screen requests.
- No broad route-tree refactor that changes matching, guards, or layout structure.

## Current Problems

### 1. Public form styling depends on builder code

In the current implementation, `survey-core/defaultV2.min.css` is imported from the builder area. When builder code is eager, that dependency is hidden because the CSS lands in the shared bundle. Once builder code is split, `/form/:id` and preview flows can render without the base SurveyJS theme, which breaks layout and appearance.

### 2. Public form loading is gated by auth restoration

The current survey page waits for auth loading to settle before it starts the query, even for public form access. That adds avoidable delay for the most common unauthenticated path.

### 3. Responses page waits for every page before first render

`FormResponsesPage` currently fetches page 1 and then all remaining pages before the initial loading state resolves. On large forms this turns the first table paint into a long blocking wait.

### 4. Refresh behavior is heavier than necessary

The current pattern makes it too easy to hide already displayed content behind a full-page loading state during refetches. That feels especially jarring if a route or query re-suspends after the user is already looking at the page.

## Design Principles

### 1. Keep form-critical rendering out of lazy boundaries

The public survey page and preview renderer are critical paths. They must remain outside route-level lazy boundaries so lazy loading secondary admin routes does not delay or destabilize core form rendering.

### 2. Split code by route responsibility, not by every component

The target is not maximum laziness. The target is safe code splitting with clear route-level wins. Secondary heavy route modules should load lazily. Form-critical routes should remain eager.

### 3. Preserve visible UI during background work

Skeletons are for the first empty paint. Once the user has content, subsequent refreshes should prefer local refresh indicators and bounded fallbacks rather than replacing the whole screen.

### 4. Make first-stage changes easy to verify

The first stage should focus on changes that are easy to test and easy to reason about: CSS ownership, route-module splitting, query separation, and initial response loading behavior.

## Options Considered

### Option A: Minimal CSS-only fix

- move base SurveyJS CSS global
- lazy-load only builder

Pros:

- lowest implementation risk
- immediately fixes the styling regression

Cons:

- leaves public form auth gating in place
- leaves responses page first-render bottleneck in place
- leaves most performance wins untouched

### Option B: Targeted route-level split plus data-loading fixes

- move base SurveyJS CSS global
- use `route.lazy` for heavy secondary route modules
- keep form-critical routes eager
- separate public/private form queries
- load only the first responses page on initial render
- preserve visible UI during refetches

Pros:

- best balance of performance gain and safety
- directly addresses the observed regressions and slow paths
- fits the current router architecture cleanly

Cons:

- requires coordinated changes in router, page queries, and tests

### Option C: Aggressive client architecture rewrite

- deep route splitting
- immediate infinite loading or virtualization
- larger rework of responses and export flow

Pros:

- highest theoretical upside

Cons:

- more moving parts
- more regression risk
- not necessary for the first stage

## Approved Approach

Option B is approved.

## Route and CSS Design

### Global SurveyJS CSS ownership

Move `survey-core/defaultV2.min.css` into [main.tsx](/opt/survey-app/frontend/src/main.tsx) so the base SurveyJS theme is always present for public forms and preview surfaces.

Keep `survey-creator-core/survey-creator-core.min.css` inside [SurveyBuilder.tsx](/opt/survey-app/frontend/src/widgets/SurveyBuilder/SurveyBuilder.tsx) so builder-only styling stays isolated to the builder route path.

### Route-level code splitting

Update [router.tsx](/opt/survey-app/frontend/src/app/router.tsx) to use `route.lazy` for secondary heavy route modules:

- `BuilderPage`
- `UsersPage`
- `FormResponsesHtmlPage`
- `TemplatesPage` only if implementation confirms it has no dependency that protects form or preview safety; otherwise keep it eager in stage one

Keep these routes eager:

- `SurveyPage`
- route modules that directly support public form rendering or preview safety

The acceptance rule is behavioral rather than implementation-specific:

- critical form routes must not be placed behind a lazy boundary
- secondary heavy route modules should load lazily

### Fallback placement

Keep fallbacks local to the lazy route module boundary. Do not move a fallback up to the whole `RouterProvider` or `AppLayout` subtree. The shell and already visible layout should stay mounted while a secondary route module resolves.

## Public and Private Survey Loading Design

### Public/private query separation

Split survey loading into distinct query keys:

- `["survey-form", "public", id]`
- `["survey-form", "private", id]`

This avoids mixing cache entries for public access and authenticated preview access.

### Public form loading behavior

Public form rendering should start immediately once `id` is available. It must not wait for auth restoration.

### Preview loading behavior

Authenticated preview should still respect auth state and use the private form path so protected access checks remain intact.

### Loading-state rule

Show the form skeleton only for the first empty open. After the first successful render:

- keep the current form visible during refreshes
- use a local refresh indicator if needed
- if an update can suspend, do not place the fallback above the smallest boundary that needs it
- do not return to a full-page fallback after the form has already rendered successfully

## Responses Page Design

### Initial render behavior

Remove the initial `getAllResponsesByForm()` pattern from [FormResponsesPage.tsx](/opt/survey-app/frontend/src/pages/FormResponsesPage/FormResponsesPage.tsx).

The first screen should request only the first responses page and render as soon as that page is available.

### Refresh behavior

Once rows are on screen:

- keep rendered rows visible during refetch
- use a small refresh indicator in the toolbar
- reserve the full table skeleton for the first empty load only

### Realtime behavior

Keep realtime invalidation, but have it refresh the current responses query rather than depending on a preassembled all-pages dataset.

### Export behavior

For the first stage, XLSX export may fetch all pages on the client only when the user clicks export. This moves heavy work out of the initial page load while preserving current functionality.

This is an explicitly temporary solution. The long-term scalable path is a server-side export endpoint or RPC so the browser does not need to load the full dataset for large exports.

## Implementation Boundaries

### Included in stage one

- global SurveyJS theme CSS move
- builder CSS isolation
- `route.lazy` for secondary heavy route modules
- public/private survey query separation
- removal of initial all-pages fetch on the responses page
- refresh-state refinement so visible content remains on screen
- test updates for the changed loading and routing behavior

### Excluded from stage one

- virtualized response tables
- server-side XLSX export
- server-side table filtering and sorting model
- broader dashboard pagination rewrite unless needed to support these changes safely

## Testing and Verification

### Tests to add or update

In [router.test.tsx](/opt/survey-app/frontend/src/app/router.test.tsx):

- verify that critical form routes are not moved behind a lazy boundary
- verify that the approved secondary heavy route modules are configured to load lazily

In [SurveyPage.test.tsx](/opt/survey-app/frontend/src/pages/SurveyPage/SurveyPage.test.tsx):

- verify separate public/private loading behavior
- verify public form loading is not blocked by auth restoration
- verify loading-state behavior does not regress to a full-page fallback after first render

In [FormResponsesPage.test.tsx](/opt/survey-app/frontend/src/pages/FormResponsesPage/FormResponsesPage.test.tsx):

- verify initial render uses only the first page of responses
- verify already shown rows remain visible during refresh
- verify the page no longer blocks on loading every responses page before first render

### Smoke cases

- if builder has not been opened at all in the current session, `/form/:id` still renders with correct SurveyJS styling
- if builder has not been opened at all in the current session, response preview still renders with correct SurveyJS styling
- `/builder/:id` still loads builder styling correctly
- `/dashboard/forms/:id/responses` shows the first table page without waiting for the full dataset
- `/dashboard/forms/:id/responses/html` still works after route-level splitting

### Verification commands

- `npm test`
- `npx tsc --noEmit`
- `npm run build`

## Acceptance Criteria

- Public forms and preview surfaces no longer depend on builder code to receive base SurveyJS styling.
- Critical form routes remain outside lazy boundaries.
- Secondary heavy route modules are loaded lazily through React Router route-level splitting.
- Public form loading no longer waits for auth restoration.
- Survey loading uses distinct public and private query keys.
- The form skeleton appears only on the first empty open and does not replace already rendered content during later refreshes.
- The responses page renders from the first page of data instead of waiting for all pages.
- Refreshing responses preserves visible rows and uses a local loading indicator instead of a full-page reset.
- XLSX export still works, with client-side all-pages loading treated as a first-stage temporary implementation.
