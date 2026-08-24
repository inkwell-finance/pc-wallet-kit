# Guided wallet demo

The phone-framed mock wallet from our `/wallet` walkthrough — the one you saw on the call. **Everything in it is mock data**: no wallet connection, no RPC, no real balances. It exists to show what the rail's constraints look like as wallet UX, so you can lift the interaction patterns rather than the numbers:

- private balances render hidden (`••••`) until a local reveal, which is an explicit user action with a timestamp — never a passive refresh
- swap shows a reference price plus a user-chosen floor, never a firm quote (the reference price is a mock; a real build uses the wallet's own feed)
- wrap is the public ramp leg and is labelled as such; swap rows in activity are marked sealed
- confirm sheets narrate "submitted → settled" as two states
- a guided tour (`GuidedTour.tsx`, `tourSteps.ts`) spotlights each of these, with an annotation panel explaining what the rail is doing

**Concept screens, not deployed.** The demo names its private dollar `pcUSD` and includes a "Save" screen (`ypcUSD`, a rate-bearing share) that references treasury yield. None of that is deployed — the devnet pair is mock-USDC / mock-DOGE, and there is no savings product. Treat the `save` screen and the `pcUSD` naming as illustration of where the account model can go; build against `GUIDE.md` and `devnet.json` for what exists.

## Files

| Path | Role |
|---|---|
| `wallet/WalletDemo.tsx` | Page: theme picker, annotation panel, tour host |
| `wallet/components/wallet-demo/WalletFrame.tsx` | The phone frame: home / swap / save / activity screens, sheets, all state |
| `wallet/components/wallet-demo/GuidedTour.tsx` | Spotlight overlay + tooltip engine (portal-based, measures `data-tour` targets) |
| `wallet/components/wallet-demo/tourSteps.ts` | The scripted walkthrough copy and targets |
| `wallet/components/wallet-demo/data.ts` | Mock balances, activity rows, demo constants |
| `wallet/components/wallet-demo/theme.ts` | Three neutral wallet skins (light / dark / midnight) |
| `wallet/components/wallet-demo/bits.tsx` | Small UI atoms (buttons, rows, eye toggle) |
| `wallet/components/Disclaimer.tsx` | Pre-alpha banner; keep it on every screen |
| `wallet/lib/cn.ts` | `clsx` + `tailwind-merge` helper |
| `wallet/theme-tokens.css` | Tailwind v4 `@theme` block with the `wd-*` color tokens the frame uses |

## Running it

Dependencies: `react`, `react-dom`, `gsap`, `lucide-react`, `react-helmet-async`, `clsx`, `tailwind-merge`, Tailwind CSS v4 (`@tailwindcss/vite`). Imports use the `@/` alias for the `wallet/` directory root — map it in your bundler or rewrite to relative paths. Add `theme-tokens.css` after `@import "tailwindcss"`. Mount `<WalletDemo />` under a `HelmetProvider` and a router; it takes no props.
