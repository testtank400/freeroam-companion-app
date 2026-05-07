# Character Cards — Design Brainstorm

## Response 1
<response>
<text>
**Design Movement:** Tactical Dark Ops / Military UI
**Core Principles:** 
- Deep charcoal/slate backgrounds with sharp angular card edges
- Monospace + bold sans-serif type hierarchy
- Neon amber/orange accent for status badges and hover states
- High-contrast imagery with subtle vignette overlays

**Color Philosophy:** Near-black backgrounds (#0d0f12) with slate-800 card surfaces. Amber (#f59e0b) as the sole accent — evoking HUD displays and military readouts. Text in cool white (#e2e8f0).

**Layout Paradigm:** Masonry-adjacent horizontal scroll grid. Cards are tall portrait rectangles. The image takes up 60% of the card height with a hard gradient fade into the text area below.

**Signature Elements:** 
- Thin 1px amber border on card hover
- Status badge with lock icon in top-left corner (military stencil font)
- Edit/delete icon buttons in top-right corner

**Interaction Philosophy:** Hover lifts card with a subtle amber glow. Click triggers a full-screen profile overlay with slide-up animation.

**Animation:** Card hover: translateY(-4px) + box-shadow amber glow. Profile open: slide-up from bottom with backdrop blur. Tab switch: crossfade.

**Typography System:** `Rajdhani` (display/headers, bold, all-caps tracking) + `JetBrains Mono` (body/backstory text, monospace feel). 
</text>
<probability>0.08</probability>
</response>

## Response 2
<response>
<text>
**Design Movement:** Cyberpunk Dossier / Classified Files
**Core Principles:**
- Dark navy/indigo backgrounds with glitch-inspired accents
- Scanline texture overlay on cards
- Cyan/teal neon for interactive elements
- Cards feel like declassified personnel files

**Color Philosophy:** Deep navy (#0a0e1a) background, card surfaces in #111827. Cyan (#06b6d4) for accents and status indicators. Red (#ef4444) for private/locked status. Muted green (#22c55e) for public.

**Layout Paradigm:** Fixed 4-column grid on desktop, 2-column on tablet. Cards have a "file folder" aesthetic with a tab at the top showing the privacy status.

**Signature Elements:**
- Scanline CSS texture on card image areas
- Glitch text effect on character names on hover
- "CLASSIFIED" / "PUBLIC" / "LINKED" stamps as status badges

**Interaction Philosophy:** Clicking a card flips it briefly before opening the profile. Profile page uses a split-screen: image left, details right.

**Animation:** Card flip on click (CSS 3D transform). Glitch keyframe animation on name hover. Smooth tab transitions in profile.

**Typography System:** `Orbitron` (headings, futuristic) + `IBM Plex Mono` (body text, dossier feel).
</text>
<probability>0.07</probability>
</response>

## Response 3
<response>
<text>
**Design Movement:** Dark Editorial / Character Roster
**Core Principles:**
- Rich near-black (#111118) background with subtle warm undertones
- Cards as editorial portrait panels — image dominant, text as caption overlay
- Muted gold (#c9a84c) accent for premium feel
- Clean, editorial typography with strong weight contrast

**Color Philosophy:** Background in deep warm-dark (#111118). Card surface #1a1a24. Gold accent (#c9a84c) for hover borders and status badges. Text in off-white (#f0ede8) for warmth. Status colors: amber lock icon for private, green chain for linked, open eye for public.

**Layout Paradigm:** Responsive card grid (4 cols desktop → 2 cols mobile). Cards are tall portrait rectangles (aspect ratio ~3:4). The character image fills the full card with a gradient overlay at the bottom revealing name + creator. Backstory text appears in a semi-transparent panel below the image.

**Signature Elements:**
- Gradient overlay on card image (transparent → dark from 50% down)
- Gold border shimmer on hover
- Privacy badge pill in top-left with icon + label

**Interaction Philosophy:** Hover reveals full backstory text with smooth height expansion. Click opens a full-screen modal with About + Appearance tabs.

**Animation:** Card hover: subtle scale(1.02) + gold border glow. Modal open: fade + scale from 0.95 to 1. Tab switch: slide transition.

**Typography System:** `Playfair Display` (character names, editorial weight) + `Inter` (body/backstory, clean readability).
</text>
<probability>0.06</probability>
</response>

---

## Selected Design: Response 1 — Tactical Dark Ops / Military UI

Chosen for its strong thematic alignment with the sci-fi/military character aesthetic shown in the reference image. The amber accent, monospace typography, and tall portrait cards with gradient overlays perfectly match the Trooper/Echo character aesthetic.
