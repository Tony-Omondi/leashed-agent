# Leashed Agent dashboard: design system

## Direction and feel
Ledger paper on a shamba (Kiambu smallholder farm). Calm, warm and trustworthy, not
"crypto neon". The audience is a judge watching a projector for two minutes, so the
verdict must be readable from the back of the room.

- **Signature:** the *leash check*. Every money attempt lists PolicyWallet.sol's
  `require` rules in contract order. Each rule is marked pass (leaf), revert (murram,
  with the exact revert string) or not reached (ink-4). The card is then stamped
  PAID / REVERTED / REQUESTED like a receipt book.
- **Focal point:** the verdict card. Its order is: stamp, then an outcome band
  ("No funds moved · Wallet x → x ETH"), then the instruction, then what the agent
  tried, then the rules. The outcome sits at the top so it stays above the fold at
  1440×900.

## Tokens (`web/src/index.css`, Tailwind v4 `@theme`)
| Token | Value | Use |
|---|---|---|
| paper | #f4efe3 | page |
| sheet | #fbf8f0 | raised card |
| well | #ebe4d3 | inset: inputs, code, meter track |
| ink / ink-2 / ink-3 / ink-4 | #1e2a1f / #4b5547 / #7a8073 / #aaad9f | primary / supporting / metadata / disabled |
| rule / rule-strong | ink at 11% / 20% | borders |
| leaf (+wash) | #2e6a3a / #e2ebdb | success, paid, the one accent |
| murram (+wash) | #a63f27 / #f4e0d6 | revert, attacks, danger |
| maize (+wash) | #b9850f / #f5e9c8 | budget meter, waiting for co-sign |

The colours always carry meaning: leaf = rule held or paid, murram = reverted or
attack, maize = budget or pending. Never use them as decoration.

## Typography
- **Fraunces Variable:** human words (the quoted instruction at 20px, the data quote
  at 16px) and the balance figure (44px/500, tabular-nums).
- **Instrument Sans Variable:** all UI text. Body is 14px with line-height 1.5.
- **JetBrains Mono Variable:** anything on-chain: addresses, `require(...)`, tx
  hashes, planned calls.
- **Scale (about 1.25):** 11 · 12 · 13 · 14 · 16 · 18 · 20 · 22 · 24 · 44.
- **Labels:** 11px/600, uppercase, tracking 0.09em, ink-3.
- Fonts are bundled through @fontsource, so the page works offline at the venue.

## Depth and spacing
- **Depth:** borders and paper tints only, no shadows (it should feel like a ledger).
- **Spacing:** 4px base. Cards are padded 20px (`p-5`) with 24px (`gap-6`) between
  cards and sections.
- **Radius:** cards 14px, list rows and inset areas 10px, buttons and inputs 8px,
  chips fully round.
- **Layout:** main column `minmax(0,1fr)` plus a 372px sidebar at lg; it stacks below
  that. Max width is 1360px, with a 16px gutter on mobile.

## Component patterns
- **Button** (`ui.jsx`): min-height 40px, padding 14px, 8px radius, 14px/500. Three
  variants: primary (ink fill), quiet (sheet with rule-strong border), danger
  (murram text and border). Press scales to 0.97.
- **Scenario chip:** a fully rounded pill with min-height 40px and 13px/500 text plus
  a 17px icon. Errand chips use the quiet style. Attack chips use a murram border and
  a murram-wash/50 fill.
- **Stamp:** mono 700, letter-spacing 0.14em, rotated −4°, 2px current-colour border.
  It comes in three sizes: small for ledger rows, regular, and big for the verdict
  (16px on mobile, 22px on desktop, 3px border). On entry it scales from 1.18 to 1
  over 200ms.
- **Rule row:** a 20px status disc (leaf with check, murram with cancel, or well with
  a dot), a 14/500 label, and `require(code)` in 12px mono below it. A failing row
  gets a murram-wash background and the revert reason. Rows fade in 70ms apart.
- **Pill:** fully rounded, 12/500 text, a 6px dot in the current colour, wash
  background.
- **Ledger row:** grid columns 64px time · 20px icon · summary · amount · 96px stamp.

## Icons
Icons8 **Material Rounded (`m_rounded`)** only, locked in `web/icons8.json`. They are
stored as local PNGs in `web/public/icons/` and drawn as CSS masks
(`<Icon name size>`) so they take on `currentColor`. Sizes used: 13, 15, 16, 17, 18,
20, 22, 24 and 36. Use one pack only.

## Motion
Ease-out is `cubic-bezier(0.23, 1, 0.32, 1)`. Only transform and opacity are
animated. Everything stays under 300ms. `prefers-reduced-motion` turns off the stamp,
row and press motion.
