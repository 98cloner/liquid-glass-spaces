---
name: Liquid Glass Spaces
description: A tactile Apple-style liquid glass system for interactive iOS-inspired surfaces
colors:
  primary: "#007aff"
  dark-primary: "#0a84ff"
  neutral-bg: "#f2f2f7"
  neutral-surface: "#ffffff"
  neutral-ink: "#000000"
  dark-bg: "#000000"
  dark-surface: "#1c1c1e"
  dark-ink: "#ffffff"
  secondary-label: "rgba(60, 60, 67, 0.6)"
  dark-secondary-label: "rgba(235, 235, 245, 0.6)"
  separator: "rgba(60, 60, 67, 0.29)"
  dark-separator: "rgba(84, 84, 88, 0.65)"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.29
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.196
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.25
rounded:
  capsule: "999px"
  control: "18px"
  card: "26px"
  device: "69px"
  tab: "62px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "20px"
  lg: "28px"
  xl: "48px"
  section: "128px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.capsule}"
    padding: "12px 20px"
  button-glass:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.primary}"
    typography: "{typography.body}"
    rounded: "{rounded.capsule}"
    padding: "7px 12px"
  card:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-ink}"
    rounded: "{rounded.card}"
    padding: "16px 22px"
---

# Design System: Liquid Glass Spaces

## Overview

**Creative North Star: "The Tactile OS"**

Liquid Glass Spaces translates the visual and behavioral language of a modern operating system into a refractive, touch-responsive surface system. The implementation feels optically physical rather than purely graphic: controls can become lenses when pressed, fills can swell or settle, and navigation moves through spatial continuity instead of abrupt page swaps.

The site balances Apple-like density with generous presentation. Light and dark schemes are complete, not inverted sketches. Neutral surfaces carry most of the interface, blue appears as the focused action and state color, and glass is reserved for spatial interaction rather than used as decoration on every panel.

**Key Characteristics:**
- Refractive glass with stable typography and direct touch affordances
- Restrained light surfaces and true-black dark surfaces
- Continuous, damped motion between states
- System-like density on controls, generous rhythm on editorial sections

## Colors

The palette is a neutral foundation with a single recognizable system accent. Blue is the action and selection signal in both schemes.

### Primary
- **System Blue**: the default interactive accent in the light scheme.
- **Dark System Blue**: the brighter action accent in the dark scheme.

### Neutral
- **Pale System Gray**: page background in the light scheme.
- **White Surface**: card and control background in the light scheme.
- **Black Ink**: primary text and page background in the appropriate context.
- **True Black**: the dominant page color in dark mode.
- **Graphite Surface**: elevated card and container color in dark mode.
- **Secondary Label**: de-emphasized supporting text in each scheme.
- **Separator**: hairline divider in each scheme.

**The Accent Rarity Rule.** Blue is for actionable, active, and state-bearing elements; it is not a decorative wash.

## Typography

**Display Font:** SF Pro Display with the Apple system stack
**Body Font:** SF Pro Text with the Apple system stack
**Label/Mono Font:** SF Pro Text or the platform system UI font

The type system is native-first and compact. Display text is substantial but quiet, while body and label sizes preserve system readability and avoid editorial excess.

### Hierarchy
- **Display** (700, 48px, 1.08, -0.02em): showcase and section titles
- **Title** (600, 22px, 1.196): cards, sheet titles, and page headings
- **Body** (400, 17px, 1.29): primary interface copy and navigation labels
- **Small** (400, 15px, 1.2): metadata, captions, and supporting labels
- **Label** (500, 15px, 1.25): controls and compact UI actions

**The Native Rhythm Rule.** Use platform-native font names and negative tracking only for large display text; keep interface copy untracked and highly legible.

## Layout

The showcase uses a centered 1240px content rail with 48px horizontal insets. Sections use a generous 128px vertical rhythm, while the phone presentation and component demos retain tighter 28px internal spacing.

The shelf is horizontal and snap-based; cards use a responsive grid that fills available width and spans two columns for selected wide examples at desktop widths. At under 760px, the content rail collapses to 20px insets, section spacing is reduced, and the shelf switches to smaller gaps.

**The One Rail Rule.** Editorial sections share the same content rail; a component demo may break containment only when it is demonstrating device or material scale.

## Elevation & Depth

Depth is primarily conveyed through refractive glass, tonal surface separation, and state-driven lift. Surfaces are mostly flat at rest. Pressed controls, knobs, and selected bars can lift into a lens-like treatment with a small shadow or optical distortion; ambient shadows are reserved for device frames and full-stage presentation.

**The State-Driven Lift Rule.** Elevation appears as a response to manipulation or focus, not as a default card ornament.

## Shapes

Capsules and superelliptic forms dominate controls. Cards use a generous 26px radius, tab bars use their own 62px presentation envelope, and the device frame uses 69px outer corners. The superellipse is preferred over arbitrary polygons when the component has to deform or refract.

**The Soft-But-Defined Rule.** Corners are rounded enough to feel tactile, but borders and fill contrast remain restrained and precise.

## Components

### Buttons
- **Shape:** capsule by default; rounded rectangle or circle when explicitly requested.
- **Primary:** system blue fill with white label in light mode and a brighter blue fill in dark mode.
- **Glass:** background remains refractive; the label carries the selected tone.
- **States:** press response darkens or brightens the label and may transform the glass surface; focus uses an inset or perimeter blue ring.
- **Sizes:** 15px compact, 17px regular and large, with 10-20px horizontal padding and 5-15px vertical padding.

### Cards / Containers
- **Corner Style:** 26px.
- **Background:** white in light mode, graphite in dark mode.
- **Border:** hairline separators only where a list or device-like distinction needs definition.
- **Internal Padding:** 16px to 22px around captions; 28px around denser component sections.

### Toggles
- **Shape:** 63px by 28px capsule with a 37px by 24px lifted thumb.
- **Off State:** neutral translucent track.
- **On State:** tinted track, default green.
- **Behavior:** dragging lifts the thumb into a liquid lens and springs back to the target state.

### Sliders
- **Shape:** 6px track and 37px by 24px thumb.
- **Behavior:** the thumb lifts as it is manipulated and snaps to available step or tick values.

### Navigation
- **Tab Bar:** glass bar, 62px tall in the mobile presentation, with spring-matched selection lens.
- **Navigation Stack:** page push/pop, edge swipe, shared-title behavior, and toolbar morphing use matching response and damping curves.
- **Desktop Shelf:** horizontal scroll snap with restrained previous/next controls.

### Search Fields
- **Style:** transparent field inside a glass container with no hard field border.
- **Placeholder:** secondary system label.
- **Cancel Control:** native-style affordance; no browser-default decoration.

## Do's and Don'ts

### Do:
- **Do** keep page backgrounds neutral and reserve blue for action-bearing states.
- **Do** use SF Pro system font stacks before introducing a custom typeface.
- **Do** use spring or damped motion for spatial state changes.
- **Do** preserve complete light and dark palettes rather than relying on only a CSS filter.
- **Do** use 26px card radius and capsule-shaped controls where they match the demonstrated components.

### Don't:
- **Don't** add ambient shadows to every card or panel.
- **Don't** use blue as a decorative background or oversized neutral fill.
- **Don't** use hard page transitions where navigation can preserve spatial continuity.
- **Don't** replace native system sizes with arbitrary global typography scales.
- **Don't** use a decorative glass effect without a corresponding interactive or structural role.
