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

<!-- impeccable:design-map -->
Name: Liquid Glass Spaces
Colors: primary: primary #007aff; neutral: neutral-bg #f2f2f7; primary: dark-primary #0a84ff; neutral: neutral-surface #ffffff; neutral: neutral-ink #000000; neutral: dark-bg #000000 (+1 more in the sidecar)
Fonts: -apple-system (display, body, title, label)
Spacing: xs 8px, sm 12px, md 20px, lg 28px, xl 48px, section 128px
Radius: capsule 999px, control 18px, card 26px, device 69px, tab 62px
North Star: "The Tactile OS"
Rules:
- The Accent Rarity Rule. Blue is for actionable, active, and state-bearing elements; it is not a decorative wash.
- The Native Rhythm Rule. Use platform-native font names and negative tracking only for large display text; keep interface copy untracked and highly legible.
- The One Rail Rule. Editorial sections share the same content rail; a component demo may break containment only when it is demonstrating device or material scale.
- The State-Driven Lift Rule. Elevation appears as a response to manipulation or focus, not as a default card ornament.
- The Soft-But-Defined Rule. Corners are rounded enough to feel tactile, but borders and fill contrast remain restrained and precise.
Don't:
- Don't add ambient shadows to every card or panel.
- Don't use blue as a decorative background or oversized neutral fill.
- Don't use hard page transitions where navigation can preserve spatial continuity.
- Don't replace native system sizes with arbitrary global typography scales.
- Don't use a decorative glass effect without a corresponding interactive or structural role.
Do:
- Do keep page backgrounds neutral and reserve blue for action-bearing states.
- Do use SF Pro system font stacks before introducing a custom typeface.
- Do use spring or damped motion for spatial state changes.
- Do preserve complete light and dark palettes rather than relying on only a CSS filter.
- Do use 26px card radius and capsule-shaped controls where they match the demonstrated components.
Full: .impeccable/design-full.md (read a section when you need its detail)
