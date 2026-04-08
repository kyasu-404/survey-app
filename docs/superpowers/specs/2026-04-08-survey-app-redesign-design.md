# Survey App Redesign Design

Date: 2026-04-08
Status: Approved for planning

## Summary

This design refreshes the entire Survey App visual system so the product feels modern, layered, and intentional instead of flat and washed out.

The approved direction is:

- Visual style: `Editorial Warm`
- Dashboard structure: `Command Center`
- Theme switching: not included in this iteration
- Scope: authenticated app shell, dashboard views, builder shell, users page, responses page, login page, and public survey page
- Constraint: preserve SurveyJS and Survey Creator behavior

The redesign must also remove zebra striping from the forms list and replace it with a cleaner high-contrast workspace presentation.

## Goals

- Make the application feel like a cohesive modern product rather than a set of loosely styled screens.
- Add visual depth through layered surfaces, strong hierarchy, warm color relationships, and motion.
- Turn the dashboard into a product overview screen instead of a single table-first page.
- Improve perceived polish on login, public survey, admin, and analytics-adjacent screens.
- Keep all existing business behavior, navigation, queries, filters, and actions intact.
- Protect SurveyJS builder and public form rendering from styling regressions.

## Non-Goals

- No dark mode or theme switch in this iteration.
- No API changes, schema changes, or query logic rewrites.
- No redesign of SurveyJS internals beyond scoped theming and safe visual integration.
- No new dashboard data sources beyond data already available in the frontend.
- No unrelated refactor of business logic just to satisfy the redesign.

## Current Problems

- The app uses light blue styling with limited contrast and weak depth, so cards and screens blend together.
- The forms list relies on zebra striping for readability, which makes it feel dated.
- Layouts are inconsistent: some screens use polished shared classes, while others still rely on inline styles or minimal structure.
- The dashboard is functional but does not feel like a central workspace.
- Login and public survey pages do not match the visual ambition of the authenticated experience.
- SurveyJS styling is partially customized already, but the surrounding shell does not feel integrated with it.

## Design Principles

### 1. Warm Editorial Product UI

The app should use a warm neutral base with premium-looking surfaces, restrained accent colors, and deeper shadows. The visual tone should feel calm and confident rather than loud or neon.

### 2. Command Center Hierarchy

The dashboard should prioritize overview and decision-making first, then operational detail. Forms remain easy to manage, but the page should lead with summary, urgency, and actions before the full list.

### 3. Safe Layering

The redesign should distinguish between:

- app shell styling controlled by the app
- SurveyJS builder styling controlled through scoped variables/selectors
- public form presentation controlled by a page container plus limited SurveyJS theming

This separation prevents broad CSS changes from breaking builder or survey interactions.

### 4. Motion With Restraint

Animations should be limited to micro-interactions that improve polish without adding distraction or layout instability.

## Information Architecture

## App Shell

The application shell becomes a consistent system used by all authenticated pages:

- a deeper background with warm gradients and subtle light blooms
- a more product-like sidebar with clearer grouping and stronger active states
- consistent page headers and content containers
- reusable card, section, toolbar, and modal patterns

## Dashboard: Command Center

The dashboard becomes a modular overview page with the following structure:

1. Hero / context block
   Shows the page title, current mode (`My Forms` or `All Forms`), a short description, and quick actions.

2. KPI row
   Shows summary metrics such as total forms, active forms, and forms with active deadlines.

3. Priority modules
   Includes two compact modules derived from already loaded forms data:
   - nearest active deadlines
   - recent forms ordered from the currently available frontend dataset

4. Primary workspace module
   Contains the full searchable/filterable forms list.

This keeps the forms list central but no longer makes it the only visual purpose of the page. No new endpoints are introduced for these modules.

## Forms List Module

The forms list remains a table/list hybrid because the page is operational and action-heavy.

Approved changes:

- remove zebra striping completely
- keep high readability through whitespace, section framing, and hover/focus states
- visually separate header, controls, and rows using surface layers instead of alternating row colors
- use status chips and stronger typography instead of relying on background coloration
- keep row actions dense and discoverable
- preserve existing behavior for copy link, duplicate, rename, edit, export, deadline, delete, and open

Rows authored by the current user may still have a subtle distinction, but not through zebra logic.

## Screen-Level Design

## Authenticated Screens

### Sidebar

- strengthen branding area
- use better active navigation states
- improve spacing and lower action grouping
- keep collapse/expand behavior unchanged

### Dashboard

- implement the Command Center layout
- promote filters into a cleaner control panel
- improve empty state presentation
- redesign action clusters and popovers to match the new system

### Builder

- keep builder behavior unchanged
- improve outer shell, spacing, and integration with the app theme
- preserve scoped Survey Creator custom properties and selectors
- avoid global rules that target Survey Creator classes outside `.builder-creator-shell`

### Form Responses

- restyle page header, actions, and table wrapper
- align table visuals with the forms list system
- preserve export and refresh flows

### Users

- replace the current minimal admin layout with structured modules
- separate creation/password controls from the user list visually
- restyle status indicators and action buttons
- preserve existing admin permissions and actions

## Unauthenticated Screens

### Login

- create a polished standalone auth experience in the same visual language
- improve form presentation, messaging, spacing, and hierarchy
- keep authentication behavior unchanged

### Public Survey Page

- wrap the survey in a richer page shell with stronger first impression
- add better title/context framing around the survey card
- keep preview mode behavior intact
- allow SurveyJS completion, file upload, and submission behavior to work exactly as before

## Visual System

## Tokens

Introduce a clearer token system in global CSS for:

- warm background ramps
- surface colors for shell, cards, raised cards, muted modules, and overlays
- border colors for low, medium, and high emphasis
- text hierarchy colors
- accent and accent-soft states
- success, warning, and danger surfaces
- shadow levels
- radii scale
- motion timings

## Components

The redesign should define reusable visual patterns for:

- page hero blocks
- section cards
- KPI cards
- filter panels
- data tables
- status chips
- empty states
- modals
- inline toolbars
- icon/action buttons

These patterns should replace one-off inline styling where practical.

## Motion

Motion is limited to:

- soft hover lift for cards and key controls
- shadow and border transitions
- subtle popover/modal entry
- focus ring transitions

Avoid:

- page-wide animated transitions
- motion that changes measured table layout
- animation that interferes with SurveyJS interaction

## Technical Design

## Styling Strategy

Primary styling remains in `frontend/src/app.css`, which becomes the source of:

- global tokens
- shared shell layout
- dashboard and module styling
- login/public screen styling
- scoped builder styling

Where page structure needs significant change, update page components to introduce semantic wrappers and reusable class names rather than relying on inline styles.

## SurveyJS Safety Rules

These rules are mandatory:

- do not add broad global selectors for `.sd-*`, `.svc-*`, or `.sv-*`
- builder changes must stay under `.builder-creator-shell`
- public survey styling should be applied through a dedicated page/container scope
- prefer SurveyJS custom properties over deep selector overrides when possible
- if a cosmetic change threatens builder or renderer behavior, keep functionality and reduce the styling scope

## Data Flow And Behavior

No product behavior changes are planned.

Existing data flow stays the same:

- dashboard and related modules continue using existing queries and derived counts
- filters remain based on current local state and query parameters
- form actions continue using current mutations and invalidation behavior
- responses export and users management keep their current flows
- survey submission, upload, and completion logic stays unchanged

The redesign is presentation-focused.

## Error Handling

All current error states remain supported. The redesign should only improve how they are displayed:

- more readable inline error surfaces
- consistent empty, loading, and error blocks
- no hidden errors behind decorative UI
- maintain existing toast usage

## Accessibility

The redesign should maintain or improve:

- keyboard access to menus, filters, buttons, and row actions
- visible focus indicators
- readable text contrast
- non-color-dependent status interpretation where practical
- preserved semantics for tables and controls

## Testing Strategy

Verification should cover:

1. Dashboard (`my` and `all`)
   - search
   - status filters
   - date filters
   - refresh
   - row open
   - copy link
   - duplicate
   - rename
   - export
   - deadline modal
   - delete modal
   - action menu placement and visibility

2. Builder
   - page opens correctly
   - toolbox remains usable
   - preview remains visible
   - custom toolbar actions remain accessible

3. Public survey page
   - form loads
   - preview mode works
   - submit works
   - upload/clear file flow still works
   - completion message remains visible

4. Login
   - sign-in flow
   - error state presentation

5. Users
   - create user
   - change password
   - enable/disable
   - delete user

6. Form responses
   - table renders correctly
   - refresh works
   - export works

7. Visual checks
   - forms list no longer uses zebra striping
   - app feels consistent across authenticated and public surfaces
   - SurveyJS builder remains intact visually and functionally

## Implementation Sequence

Recommended execution order:

1. Establish tokens and app shell foundation in CSS.
2. Redesign dashboard into the Command Center structure and remove zebra striping from the forms list.
3. Redesign login and public survey shell.
4. Redesign users and form responses screens.
5. Apply final builder shell polish and SurveyJS-safe refinements.
6. Run regression checks and visual cleanup.

## Risks And Mitigations

### Risk: Existing local changes in the worktree

Mitigation:

- avoid reverting unrelated files
- scope edits carefully
- integrate with current component structure instead of resetting files

### Risk: Dashboard file is already dense

Mitigation:

- change structure incrementally
- introduce clear wrappers/classes
- keep business logic intact while reorganizing markup

### Risk: SurveyJS regressions

Mitigation:

- keep all SurveyJS targeting scoped
- verify builder and public renderer after visual changes

## Final Decision Record

Approved decisions captured by this spec:

- full-site redesign is in scope
- `Editorial Warm` is the approved visual direction
- `Command Center` is the approved dashboard structure
- theme switching is excluded from this iteration
- SurveyJS safety takes precedence over aggressive styling
- zebra striping must be removed from the forms list
