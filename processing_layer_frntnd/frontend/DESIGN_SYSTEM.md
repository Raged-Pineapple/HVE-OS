# HVE-OS Frontend Design System

This document outlines the standardized design language for the HVE-OS Lakehouse frontend. The design philosophy is heavily inspired by Claude (Anthropic), focusing on a modern, deeply minimalist, calm, and distraction-free user experience.

## Core Philosophy
1. **Prioritize Clarity over Decoration:** Every element must feel intentional. Avoid decorative borders, heavy drop-shadows, and unnecessary visual clutter.
2. **Generous Whitespace:** Allow elements to breathe. Use spacing and typography to create hierarchy rather than boxes and lines.
3. **Calm Palette:** Avoid highly saturated colors, neon effects (like cyan glow), or heavy dark modes. The interface should feel like reading a high-quality printed document.
4. **Flat Design:** Elements rest on the surface. We do not use elevation shadows (`box-shadow`) for cards or structural elements, making the interface completely flat. Popups and toasts may use extremely subtle, soft shadows strictly for depth recognition.

## Dark Mode
The interface supports a high-quality dark mode toggled via the `[data-theme='dark']` attribute on the root html element. The dark mode maintains the same flat design and minimal color palette.

### Switching Themes
The theme is managed via the `theme` state in `App.jsx` and can be toggled using the button in the top-right corner of the `StatusBar`.

## Color Palette Tokens (Defined in `index.css`)

Always use standard CSS variables (`var(--token-name)`) rather than hardcoded colors for any new components.

### Structural Colors
- `--bg-base` (`#Fcfaf8`): A very soft, warm off-white. Used as the underlying web page background.
- `--bg-surface` (`#ffffff`): Pure white. Used for cards, inputs, and floating containers.
- `--bg-elevated` (`#ffffff`): Pure white, identical to surface in this flat theme.
- `--bg-hover` (`#f3f1eb`): A subtle warm gray used for active tabs, hovered buttons, and striped table rows.

### Borders
- `--border-subtle` (`#f0ece6`): Very light bordering used for dividers and secondary dividers.
- `--border-default` (`#e5e1d8`): Default input and card borders.
- `--border-strong` (`#d0caba`): Hover state for borders, adding a slight hint of depth without shadow.

### Typography
- `--text-primary` (`#2d2b2a`): Used for primary text, headings, and active tabs. Never use pure black (`#000000`).
- `--text-secondary` (`#64615a`): Used for secondary body text, inactive tabs.
- `--text-muted` (`#918e87`): Used for hints, placeholders, and very low-priority metadata.

### Accent Colors
Accents are deliberately muted and desaturated. Do not use bright, glowing colors.
- **Sage/Teal (`--cyan`):** `#6b8a8d` - Used for general highlights or info states.
- **Slate/Lavender (`--violet`):** `#7a748c` - Used for secondary distinct items.
- **Muted Green (`--emerald`):** `#6b8a6a` - Used for success states and 'connected' statuses.
- **Muted Ochre (`--amber`):** `#b88a44` - Used for warning and 'checking' states.
- **Muted Terracotta (`--rose`):** `#bd7373` - Used for error and danger states.

## Typography
- **Primary Font:** Inter (`--font-sans`). We fallback to `system-ui, -apple-system, sans-serif`.
- **Monospace Font:** JetBrains Mono. Used exclusively for code blocks, terminal outputs, and SQL editors.
- **Weights:** Keep font weights light. Headings should be `500` (Medium). Avoid `700` (Bold) or `800` (Extra Bold) unless strictly necessary for extreme emphasis.

## Component Rules
- **Cards (`.card`):** Must use `border-radius: 12px`, `background: var(--bg-surface)`, and `border: 1px solid var(--border-subtle)`. No shadows.
- **Buttons (`.btn`):** Flat background fills (e.g. `var(--bg-hover)`) on hover. No gradients. No shadows. Button text should share the text color of its wrapper context unless it's a primary action. Check `index.css` for `.btn-primary`, `.btn-ghost`, and `.btn-danger`.
- **Inputs:** Soft `6px` border radii. Focus rings should use neutral colors like `var(--text-muted)` rather than bright glowing outlines.

## Data Source Organization
To maintain a clean and organized sidebar:
1. **Flexbox Layout:** Use `display: flex; justify-content: space-between; align-items: center;` for card headers.
2. **Name Truncation:** Always wrap names in a container with `min-width: 0;` and apply `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` to the text element. This prevents long names (e.g., `bangalore_military`) from breaking the layout.
3. **Subtle Badges:** Place source type indicators on the far right. Badges should use muted background colors (e.g., `var(--cyan-dim)`), reduced font size (`0.65rem`), and `flex-shrink: 0` to preserve their shape.

## Future Development Guidelines
When adding features or pages:
1. Try to reuse the `.card`, `.btn`, and `.field` classes as much as possible rather than redefining standard CSS properties inline in JSX.
2. Ensure you search for any stray inline hex codes (`#123456`) or `hsl()` strings and swap them with the relevant CSS variable token mappings.
3. If generating UI using an AI agent, instruct the agent to "Follow the minimalist Anthropic design guidelines found in DESIGN_SYSTEM.md" to ensure aesthetic integrity is maintained.
