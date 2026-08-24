/**
 * Guided-tour script for the wallet demo.
 *
 * Two step kinds:
 *   advance: 'next'  — narration; the user presses Next.
 *   advance: 'click' — interactive; the user must click the real control
 *     carrying data-tour-click={clickTarget}. The click drives the wallet
 *     itself (reveal, sheets, tabs, deposit, settlement), so the tutorial
 *     is the product, not a slideshow over it.
 *
 * `action` runs when the step is entered (scripted state repair only —
 * everything user-visible is user-clicked where possible). `settle` is ms
 * to wait before measuring the spotlight target.
 */

export type TourAction = 'home' | 'close-sheet-home' | 'reset';

export interface TourStep {
  id: string;
  target: string;
  title: string;
  copy: string;
  advance: 'next' | 'click';
  clickTarget?: string;
  clickPrompt?: string;
  action?: TourAction;
  settle?: number;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    target: 'frame',
    title: 'Your wallet, with a private dollar',
    copy: 'Same wallet you know. One new property: amounts can be sealed. This tour has you drive. When a control glows, click it.',
    advance: 'next',
    action: 'reset',
    settle: 250,
  },
  {
    id: 'private',
    target: 'private',
    title: 'Balances the chain never shows',
    copy: 'On-chain these are ciphertexts. Not small numbers. Not hidden numbers. No numbers. Notice the total above counts only public tokens.',
    advance: 'next',
  },
  {
    id: 'reveal',
    target: 'reveal-eye',
    title: 'Reveal with your viewing key',
    copy: 'Decryption happens on this device, from your seed. Nothing is sent anywhere.',
    advance: 'click',
    clickTarget: 'reveal-eye',
    clickPrompt: 'Click the eye on pcUSD',
  },
  {
    id: 'total-after',
    target: 'total',
    title: 'Now the total includes it',
    copy: 'Only your screen changed. The chain still shows ciphertext.',
    advance: 'next',
    settle: 1400,
  },
  {
    id: 'wrap-open',
    target: 'action-wrap',
    title: 'The ramp',
    copy: 'Wrap moves public dollars into the vault and back. It is the one deliberately public step.',
    advance: 'click',
    clickTarget: 'action-wrap',
    clickPrompt: 'Click Wrap',
  },
  {
    id: 'wrap-sheet',
    target: 'wrap-cta',
    title: 'Public by design',
    copy: 'This transaction is visible on-chain. KYC and compliance live here, with the issuer, never inside your balance.',
    advance: 'click',
    clickTarget: 'wrap-cta',
    clickPrompt: 'Click Wrap 250 USDC',
    settle: 450,
  },
  {
    id: 'wrap-done',
    target: 'success',
    title: 'Now it’s private',
    copy: 'The wrap settled. From here on, this balance is ciphertext.',
    advance: 'click',
    clickTarget: 'wrapdone',
    clickPrompt: 'Click Done',
    settle: 450,
  },
  {
    id: 'swap-tab',
    target: 'tab-swap',
    title: 'Now trade it',
    copy: 'The private dollar needs a private venue.',
    advance: 'click',
    clickTarget: 'tab-swap',
    clickPrompt: 'Open the Swap tab',
    action: 'close-sheet-home',
    settle: 350,
  },
  {
    id: 'quote',
    target: 'quote',
    title: 'An estimate, plus a floor you choose',
    copy: 'Reserves are encrypted, so a firm quote is impossible without leaking them. Your floor is enforced inside the encrypted math.',
    advance: 'next',
    settle: 350,
  },
  {
    id: 'review',
    target: 'review',
    title: 'Take the swap to review',
    copy: 'One hundred pcUSD to pcDOGE, floor set.',
    advance: 'click',
    clickTarget: 'review',
    clickPrompt: 'Click Review swap',
  },
  {
    id: 'split',
    target: 'split',
    title: 'Public and sealed, stated plainly',
    copy: 'Public: that this wallet swapped, and when. Sealed: both amounts, your balances, the pool’s reserves.',
    advance: 'next',
    settle: 450,
  },
  {
    id: 'swap-now',
    target: 'swapnow',
    title: 'One atomic transaction',
    copy: 'Debit receipt, encrypted curve, payout. No partial state, no mempool window.',
    advance: 'click',
    clickTarget: 'swapnow',
    clickPrompt: 'Click Swap now',
  },
  {
    id: 'settled',
    target: 'viewactivity',
    title: 'Settled, sealed',
    copy: 'The amounts never touched the public ledger.',
    advance: 'click',
    clickTarget: 'viewactivity',
    clickPrompt: 'Click View activity',
    settle: 500,
  },
  {
    id: 'activity',
    target: 'activity',
    title: 'What observers keep',
    copy: 'That you traded. Never how much. Ramp rows show amounts; sealed rows never will.',
    advance: 'next',
    settle: 450,
  },
  {
    id: 'save-tab',
    target: 'tab-save',
    title: 'One more thing: yield',
    copy: 'A private dollar that also grows, backed by short-dated treasuries via Solomon and Bridge.',
    advance: 'click',
    clickTarget: 'tab-save',
    clickPrompt: 'Open the Save tab',
  },
  {
    id: 'save-intro',
    target: 'saveinfo',
    title: 'An exchange-rate share',
    copy: 'ypcUSD is a share whose public rate only rises. Your share count is sealed; the rate is not: a public rate over sealed balances reveals no one.',
    advance: 'next',
    settle: 400,
  },
  {
    id: 'deposit-open',
    target: 'deposit',
    title: 'Move dollars into savings',
    copy: 'Rewards are variable and not guaranteed. That honesty is part of the design.',
    advance: 'click',
    clickTarget: 'deposit',
    clickPrompt: 'Click Deposit',
  },
  {
    id: 'deposit-confirm',
    target: 'deposit-confirm',
    title: 'Sealed shares at today’s rate',
    copy: '1,000 pcUSD buys shares at the current rate. The share count is a ciphertext, like every other balance.',
    advance: 'click',
    clickTarget: 'deposit-confirm',
    clickPrompt: 'Confirm the deposit',
    settle: 450,
  },
  {
    id: 'settle-week',
    target: 'settle',
    title: 'Then a week passes',
    copy: 'Solomon streams treasury rewards to the vault: one aggregate transfer, no per-holder payout. Run the week.',
    advance: 'click',
    clickTarget: 'settle',
    clickPrompt: 'Click Run a week',
    settle: 500,
  },
  {
    id: 'rate-after',
    target: 'savevalue',
    title: 'You earned by nothing happening',
    copy: 'The rate rose. Your shares never moved. No payout touched your address. A visible reward would reveal your balance; a rising public rate reveals no one.',
    advance: 'next',
    settle: 1300,
  },
  {
    id: 'finale',
    target: 'frame',
    title: 'That’s the stack',
    copy: 'A compliant dollar, sealed amounts, an honest venue, and treasury yield, in the wallet you already have.',
    advance: 'next',
    settle: 300,
  },
];
