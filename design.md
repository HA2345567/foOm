# ZoOmly Design System

## Visual Theme

Build in dark mode with a Cal.com-inspired monochrome product aesthetic. The UI should feel restrained, professional, and product-first. Boldness comes from contrast, typography, spacing, and precise elevation, not from saturated brand color.

Use grayscale surfaces, near-white primary text, mid-gray secondary text, and controlled accents only for links, focus states, and critical semantic feedback.

## Palette

- Background: near black, `#080809` to `#0b0b0c`
- Raised surface: `#111113`
- Higher surface: `#171719`
- Primary text: `#f5f5f5`
- Secondary text: `#898989`
- Deep overlay: `rgba(17, 17, 17, 0.5)`
- Ring shadow: `rgba(255, 255, 255, 0.08-0.10)`
- Focus ring: `rgba(59, 130, 246, 0.5)`
- Link blue: `#0099ff`, reserved for links only

Avoid decorative gradients, color blobs, glow effects, and saturated brand color. Product content may carry color; the frame stays neutral.

## Typography

- Display: Cal Sans, weight `600`, tight line-height, letter-spacing `0`
- Body/UI: Inter, weights `300-600`
- Mono: Roboto Mono or system mono for technical values

Rules:

- Use Cal Sans for headings and important panel titles.
- Use Inter for body, labels, controls, and dense product UI.
- At smaller Cal Sans sizes, use slight positive tracking if needed.
- Keep letter spacing at `0` unless a small uppercase label needs spacing.

## Elevation

Use shadow rings instead of CSS borders when possible:

```css
box-shadow:
  0px 1px 5px -4px rgba(0, 0, 0, 0.9),
  0px 0px 0px 1px rgba(255, 255, 255, 0.08),
  0px 4px 8px rgba(0, 0, 0, 0.24),
  inset 0px 1px 0px rgba(255, 255, 255, 0.04);
```

Use subtle inset highlights on buttons and cards. Avoid heavy dark drop shadows.

## Components

- Buttons: compact, 6-8px radius, monochrome, opacity/ring changes on hover.
- Cards/panels: 8-12px radius, shadow-ring elevation.
- Tool rails: dense, quiet, icon-first, predictable.
- Inputs: dark raised surface, subtle ring, blue focus ring only for accessibility.
- Product screenshots/video previews: primary visual content.

## Layout

- Base spacing unit: `8px`
- Dense product UI gaps: `4px-12px`
- Card padding: `12px-24px`
- Large marketing sections may use `80px-96px`, but editor UI stays dense and operational.
- Keep fixed-format editor regions stable: preview, timeline, tool rail, icon rail.

## Do

- Keep the frame grayscale and professional.
- Use Cal Sans for headings and Inter for UI text.
- Use ring-shadow elevation for containment.
- Let actual video/product content carry visual interest.
- Keep workflow controls visible and ergonomic.

## Don't

- Do not add decorative gradients, abstract graphics, or colorful backgrounds.
- Do not use saturated brand colors for core chrome.
- Do not use heavy borders where ring shadows work.
- Do not make the editor feel like a landing page.
- Do not let text or tool panels resize unpredictably.
