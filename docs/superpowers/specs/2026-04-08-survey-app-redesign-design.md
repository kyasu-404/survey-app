# Survey App Premium Monochrome Refresh Design

Date: 2026-04-08
Status: Ready for user review
Supersedes: earlier 2026-04-08 warm/editorial redesign direction

## Summary

This design refresh updates the Survey App into a premium, minimalist monochrome product.

The approved direction is:

- visual style: `Soft Luxury Monochrome`
- palette: black, white, graphite, and layered grayscale only
- structure: keep the current site structure intact
- motion: add only subtle, purposeful animations where they improve polish
- scope: login page, authenticated shell, dashboard, builder shell, users page, responses page, and public survey page
- safety constraint: preserve SurveyJS and Survey Creator behavior

This is a presentation-first redesign. It should materially improve polish, hierarchy, and cohesion without changing routes, screen structure, data flow, or feature behavior.

## Goals

- Replace the current blue-heavy visual language with a cohesive monochrome system.
- Make the product feel premium, modern, and minimalist rather than flat or generic.
- Increase perceived depth through layered surfaces, contrast, spacing, and shadows instead of color.
- Unify all screens under one visual system, including login and public survey experiences.
- Add restrained animation to key interactions so the UI feels responsive and intentional.
- Keep all existing screen structure, controls, interactions, and business behavior intact.

## Non-Goals

- No layout or information architecture redesign.
- No new dashboard modules, hero blocks, KPI sections, or reordered content.
- No API, schema, routing, or business logic changes.
- No theme switcher or dark mode in this iteration.
- No aggressive SurveyJS restyling that risks interaction regressions.

## Current Problems

- The app relies on a light blue palette that makes the product feel dated and less premium than intended.
- Many surfaces blend together because contrast is weak and elevation is inconsistent.
- Some screens still depend on inline styles, so the system does not feel fully unified.
- The builder shell and public survey shell do not feel visually integrated with the rest of the app.
- Interactive states are functional but visually static, so the UI lacks refinement.
- Several states communicate mostly through color; the redesign should work even in a nearly monochrome palette.

## Design Principles

### 1. Soft Luxury Monochrome

The interface should feel expensive through restraint. Use a white-to-graphite range with rich grayscale transitions, soft highlights, satin-like surfaces, and deep but controlled shadows.

### 2. Structure Preservation First

The user explicitly wants the current structure preserved. The redesign may refine wrappers, class names, spacing, and styling, but should not change screen composition, control order, route structure, or content hierarchy.

### 3. Contrast Over Color

Emphasis should come from typography, inversion, borders, fill density, and elevation rather than accent hues. Important controls may use black or near-black fills with white text. Secondary controls should stay light and quiet.

### 4. Motion With Restraint

Animations should be minimal, fast, and supportive. Movement exists to improve polish and perceived responsiveness, not to draw attention to itself.

### 5. Safe Integration

SurveyJS builder and renderer must remain fully functional. Styling should stay scoped and avoid broad selectors that could alter component behavior unexpectedly.

## Information Architecture

## Global Rule

The current structure stays as-is across the site.

Allowed changes:

- replacing inline styles with reusable classes
- introducing shared wrappers when they preserve the exact existing content order
- refining spacing, sizing, visual grouping, and alignment
- improving empty, loading, modal, and popover presentation

Disallowed changes:

- adding new dashboard sections that change page structure
- moving controls into different content regions
- changing page purpose or navigation hierarchy
- replacing tables/lists with different interaction models

## Screen-Level Design

## Authenticated App Shell

The app shell becomes darker in tone only through depth, not through dark mode.

- background uses soft grayscale gradients and low-contrast light blooms
- sidebar becomes more product-like and composed, with cleaner grouping and calmer contrast
- content area keeps its current layout but gains stronger separation from the background
- shared cards, tables, popovers, chips, and modal surfaces use one monochrome material system

## Sidebar

- keep the current logo, title, nav order, and collapse behavior
- strengthen the brand block through spacing, cleaner typography, and a premium surface treatment
- active nav state should use monochrome inversion or a dense graphite pill rather than blue emphasis
- inactive nav items remain quiet but still clearly interactive
- collapse/open buttons should feel compact and intentional, with refined hover/focus states

## Dashboard

- keep the current toolbar, filters, forms list, menus, and pagination behavior
- remove the remaining blue-tinted backgrounds and convert forms cards to layered monochrome surfaces
- improve row/card readability through border contrast, spacing, and type hierarchy rather than colored fills
- status and metadata pills should become monochrome chips that rely on label, density, and border treatment
- menus and popovers should match the rest of the premium material language
- preserve the current operational feel; this remains a working surface, not a marketing page

## Login

- keep the current single-card auth structure and form fields
- present the page as a polished standalone scene with more atmosphere and stronger vertical rhythm
- use a more refined auth card surface and larger title hierarchy
- restyle validation and status messages to match the monochrome system

## Users

- preserve the current create-user controls, password actions, table, and modal flows
- replace ad hoc inline styling with shared admin surface patterns
- visually separate creation controls from the table without changing their order
- convert status labels and action areas into the same monochrome language used on the dashboard

## Form Responses

- preserve page structure, toolbar actions, and table rendering
- align the table shell, header, and empty states with the dashboard system
- make the data surface feel clean and high-contrast without adding visual noise

## Builder

- preserve current builder page structure and all Survey Creator functionality
- redesign only the outer shell and scoped Survey Creator theming
- replace blue-tinted variables with graphite, white, and neutral gray equivalents
- keep toolbar actions, focus states, and component affordances readable and usable

## Public Survey Page

- keep the current survey page structure and SurveyJS rendering logic
- wrap the form in a more premium monochrome shell so the page feels intentional even for unauthenticated users
- preserve completion, upload, and submission behavior exactly as today

## Visual System

## Tokens

Introduce a monochrome token set in global CSS for:

- app background layers
- shell and surface backgrounds
- raised, muted, and overlay surfaces
- low, medium, and strong border contrast
- primary and secondary text
- inverted surfaces and text
- focus rings
- semantic surfaces expressed in grayscale
- shadow depths
- radii
- motion timing and easing

The palette should be built from warm-white, soft-white, pearl-gray, silver-gray, graphite, charcoal, and black. Avoid saturated color accents.

## Typography

- keep the UI typography clean and modern
- increase title hierarchy through size, weight, and tracking rather than decoration
- supporting text should feel calm and editorial, but still highly readable in admin contexts
- controls should use slightly tighter, more premium typography than the current default feel

## Surfaces

Surfaces should feel layered rather than flat.

- page background: soft grayscale atmosphere
- standard card: bright surface with subtle edge contrast
- raised card: deeper shadow and stronger border separation
- muted module: off-white/pearl background for secondary regions
- overlay: translucent white with blur only where it meaningfully improves depth

## Components

The redesign should define reusable styling for:

- cards
- buttons and button-links
- inputs, selects, and textareas
- nav items
- toolbars
- tables
- status chips
- empty states
- popovers and dropdown menus
- modal backdrops and modal cards
- icon buttons and compact controls

## Status Treatment

Status semantics should remain understandable without using color as the main differentiator.

Use combinations of:

- copy labels
- fill density
- border emphasis
- iconography if already present or easy to add safely
- contrast inversion for important active states

Pure green/red/blue status styling should be removed in favor of grayscale treatments unless a functional library surface forces otherwise.

## Motion

Motion should be subtle and consistent.

Allowed motion:

- card and button hover lift of roughly 1-2px
- border and shadow transitions
- popover fade/scale entry
- modal fade/slide entry
- soft appearance of major surfaces on first render
- focus ring transitions

Avoid:

- page transition animations
- anything that shifts table measurements during interaction
- decorative looping motion
- heavy builder or survey animation that could interfere with usability

`prefers-reduced-motion` should reduce or remove non-essential animation.

## Technical Design

## Styling Strategy

Primary styling remains in `frontend/src/app.css`, which becomes the source of:

- monochrome design tokens
- shared shell layout styling
- dashboard, users, responses, login, and public survey styling
- modal and popover styling
- scoped builder theming

Where pages currently rely on inline styles, replace them with reusable class names as long as the rendered structure stays materially the same.

The first files most likely to need small markup cleanups are:

- `frontend/src/pages/LoginPage/LoginPage.tsx`
- `frontend/src/pages/UsersPage/UsersPage.tsx`
- `frontend/src/pages/FormResponsesPage/FormResponsesPage.tsx`

## SurveyJS Safety Rules

These rules are mandatory:

- do not add broad global selectors for `.sd-*`, `.svc-*`, or `.sv-*`
- builder changes must stay under `.builder-creator-shell`
- public survey styling should be applied through dedicated survey-page scopes
- prefer SurveyJS custom properties over deep selector overrides when possible
- if a cosmetic change threatens builder or renderer behavior, reduce styling scope before changing behavior

## Data Flow And Behavior

No product behavior changes are planned.

Existing data flow stays the same:

- dashboard queries, filters, mutations, and menu behavior stay as implemented
- users creation and password management flows stay as implemented
- responses export and refresh stay as implemented
- survey rendering, submission, completion, and upload flows stay as implemented

This redesign changes presentation only.

## Error Handling

All current loading, empty, and error states remain supported.

The redesign should improve them by:

- making states more visually consistent
- keeping messages readable against the monochrome system
- avoiding hidden or low-contrast errors
- preserving current toast usage and page-level messaging behavior

## Accessibility

The redesign should maintain or improve:

- keyboard access to menus, filters, buttons, and form controls
- visible focus states with strong contrast
- readable contrast between text and surfaces
- status readability without depending on hue alone
- safe reduced-motion behavior
- preserved semantics for tables, buttons, and existing controls

## Testing Strategy

Verification should cover:

1. Login
   - sign-in flow still works
   - error and success messaging remain readable

2. Dashboard (`my` and `all`)
   - search
   - date filters
   - page size selector
   - refresh
   - card open
   - status menu
   - actions menu
   - copy link
   - duplicate
   - rename
   - deadline flow
   - delete flow

3. Users
   - create user
   - change my password
   - change another user's password
   - enable/disable user
   - delete user

4. Form responses
   - table rendering
   - refresh
   - export

5. Builder
   - page opens correctly
   - toolbox remains usable
   - preview remains usable
   - custom toolbar actions remain visible

6. Public survey
   - survey loads
   - form fields remain interactive
   - submit works
   - upload/clear file flow still works
   - completion state still appears

7. Visual checks
   - app is fully monochrome
   - no important UI state still depends on the old blue accent system
   - motion feels subtle and consistent
   - no structural screen changes were introduced
   - SurveyJS still feels integrated but not broken

## Implementation Sequence

Recommended execution order:

1. Replace global tokens and base controls with the monochrome system in CSS.
2. Refresh shell, sidebar, cards, and shared surfaces.
3. Redesign dashboard visuals without changing its structure.
4. Redesign login, users, and responses screens and remove inline-style dependencies where needed.
5. Apply scoped monochrome theming to builder and public survey surfaces.
6. Add restrained animation and reduced-motion handling.
7. Run regression and visual verification across all key flows.

## Risks And Mitigations

### Risk: The UI becomes flat or "gray soup"

Mitigation:

- rely on layered surface values rather than one flat gray
- use contrast, borders, and elevation intentionally
- reserve inversion for key emphasis points

### Risk: Preserving structure could still drift during cleanup

Mitigation:

- treat JSX changes as styling support only
- avoid reordering content
- verify before/after structure during review

### Risk: Existing inline styles conflict with the new system

Mitigation:

- replace only the inline styles that block consistency
- move those styles into shared classes rather than ad hoc local overrides

### Risk: SurveyJS regressions

Mitigation:

- keep all library styling scoped
- prefer custom properties over deep overrides
- verify builder and public survey behavior after every styling pass

## Final Decision Record

Approved decisions captured by this spec:

- the redesign direction is `Soft Luxury Monochrome`
- the entire site stays in scope, but structure must remain unchanged
- the palette is strictly black/white/graphite/grayscale
- subtle animation is required where it improves polish
- blue-accent styling should be removed from the app-owned design system
- SurveyJS safety takes precedence over aggressive visual changes
