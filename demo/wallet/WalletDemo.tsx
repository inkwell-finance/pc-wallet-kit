/**
 * Wallet View — /wallet
 *
 * Shows what pc-token + pc-swap feel like from inside a consumer wallet:
 * a phone-framed mock wallet (Phantom/Solflare-class layout, no real
 * wallet's branding) with the flows a wallet partner would ship —
 * private balance display with local viewing-key reveal, wrap as the
 * public ramp, estimate-plus-floor swap, sealed activity.
 *
 * Everything in the frame is mock data. The annotation panel narrates
 * what the rail is actually doing at each step, keeping the honest-claims
 * discipline (we hide how much, not that; no firm quotes on encrypted
 * reserves; pre-alpha disclaimer per SOUL.md §108).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PreAlphaDisclaimer } from '@/components/swap/Disclaimer';
import { WalletFrame, type WalletFrameHandle } from '@/components/wallet-demo/WalletFrame';
import {
  SpotlightOverlay,
  TourTooltip,
  useFrameHost,
  type SpotRect,
} from '@/components/wallet-demo/GuidedTour';
import { TOUR_STEPS } from '@/components/wallet-demo/tourSteps';
import { WALLET_THEMES, type WalletThemeId } from '@/components/wallet-demo/theme';
import type { ScreenId } from '@/components/wallet-demo/data';

type Context = ScreenId | 'wrap' | 'confirm';

const ANNOTATIONS: Record<Context, { headline: string; points: string[] }> = {
  home: {
    headline: 'The chain never shows a number.',
    points: [
      'Balances are ciphertexts. Your viewing key decrypts them on your screen, nowhere else.',
      'No wallet ships this today. It is the gap on the Foundation’s own roadmap.',
    ],
  },
  swap: {
    headline: 'No firm quote. An estimate, plus a floor you choose.',
    points: [
      'An exact quote would leak the encrypted reserves.',
      'The floor is enforced inside the encrypted math. Below it, the swap fails whole.',
    ],
  },
  activity: {
    headline: 'Observers see that you traded. Never how much.',
    points: [
      'Wrap rows show amounts. The ramp is public by design.',
      'Swap amounts, balances, and reserves stay sealed.',
    ],
  },
  save: {
    headline: 'Yield with no payout. The rate rises instead.',
    points: [
      'Treasury rewards arrive as one aggregate vault transfer, streamed by Solomon.',
      'Your shares never move; the public rate climbs. A payout would reveal your balance. A rate reveals no one.',
    ],
  },
  wrap: {
    headline: 'The ramp is the only public step.',
    points: [
      'KYC lives with the issuer, at mint and redeem.',
      'After settlement, even the issuer can’t read your balance.',
    ],
  },
  confirm: {
    headline: 'One atomic transaction.',
    points: [
      'Debit receipt, encrypted curve, payout. No partial state, no mempool window.',
      'A lying counterparty gets a uniform no-op.',
    ],
  },
};

export default function WalletDemo() {
  const [context, setContext] = useState<Context>('home');
  const [themeId, setThemeId] = useState<WalletThemeId>('neutral');
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [spotRect, setSpotRect] = useState<SpotRect | null>(null);
  const frameRef = useRef<WalletFrameHandle>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const frameHost = useFrameHost(themeId);
  const annotation = ANNOTATIONS[context];
  const touring = tourStep !== null;

  const enterStep = useCallback((index: number) => {
    const step = TOUR_STEPS[index];
    if (step.action) frameRef.current?.run(step.action);
    setTourStep(index);
  }, []);

  const exitTour = useCallback(() => {
    setTourStep(null);
    setSpotRect(null);
    frameRef.current?.run('home');
  }, []);

  useEffect(() => {
    if (touring) exitTour();
    // Intentionally only when the theme changes: a theme switch remounts the
    // frame, which orphans the tour's portal host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId]);

  useEffect(() => {
    if (tourStep === null || !frameHost) return;
    const step = TOUR_STEPS[tourStep];
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        step.advance === 'click' &&
        step.clickTarget &&
        target.closest(`[data-tour-click="${step.clickTarget}"]`)
      ) {
        window.setTimeout(() => enterStep(Math.min(tourStep + 1, TOUR_STEPS.length - 1)), 80);
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      frameHost.dispatchEvent(new CustomEvent('wd-tour-nudge'));
    };
    frameHost.addEventListener('click', handler, true);
    return () => frameHost.removeEventListener('click', handler, true);
  }, [tourStep, frameHost]);

  return (
    <div className="mx-auto max-w-6xl px-6 pb-20 pt-10">
      <Helmet>
        <title>Wallet View — Dagon</title>
        <meta
          name="description"
          content="What pc-token and pc-swap feel like inside a consumer wallet: private balances, viewing-key reveal, and honest encrypted-swap quotes."
        />
      </Helmet>

      <PreAlphaDisclaimer />

      <header className="mb-10 mt-8 max-w-3xl">
        <p className="font-body text-[10px] uppercase tracking-[0.4em] text-mist">Wallet view</p>
        <h1 className="mt-3 font-headline text-4xl italic text-pearl md:text-5xl">
          What a private dollar feels like in your pocket.
        </h1>
        <p className="mt-4 font-body text-base leading-relaxed text-silk">
          The swap-demo primitives, met the way an end user meets them: inside a wallet. Every
          figure is illustrative.
        </p>
      </header>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <span id="wd-style-label" className="font-body text-[10px] uppercase tracking-[0.35em] text-mist">
          Style study
        </span>
        <div role="group" aria-labelledby="wd-style-label" className="flex border border-tide/60">
          {(Object.keys(WALLET_THEMES) as WalletThemeId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setThemeId(id)}
              aria-pressed={themeId === id}
              className={cn(
                'px-4 py-2.5 font-body text-[10px] uppercase tracking-[0.25em] transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-glint',
                themeId === id ? 'bg-pearl text-void' : 'text-silk hover:text-pearl',
              )}
            >
              {WALLET_THEMES[id].label}
            </button>
          ))}
        </div>
        <span className="font-body text-[10px] text-mist">
          Style studies. No affiliation, no logos.
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => frameRef.current?.run('reset')}
            disabled={touring}
            className={cn(
              'border border-tide px-4 py-2.5 font-body text-[10px] uppercase tracking-[0.25em]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-glint',
              touring ? 'cursor-not-allowed text-mist/50' : 'text-silk hover:text-pearl',
            )}
          >
            Reset demo
          </button>
          <button
            type="button"
            onClick={() => (touring ? exitTour() : enterStep(0))}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 font-body text-[10px] uppercase tracking-[0.25em]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-glint',
              touring
                ? 'border border-tide text-silk hover:text-pearl'
                : 'bg-pearl text-void hover:bg-glint',
            )}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {touring ? 'End tour' : 'Guided tour'}
          </button>
        </div>
      </div>

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div ref={wrapperRef} className="relative">
          <WalletFrame
            ref={frameRef}
            key={themeId}
            themeId={themeId}
            locked={tourStep !== null}
            onContextChange={setContext}
          />

          {tourStep !== null && (
            <>
              <SpotlightOverlay stepIndex={tourStep} frameHost={frameHost} onRect={setSpotRect} />
              <TourTooltip
                stepIndex={tourStep}
                rect={spotRect}
                frameHost={frameHost}
                wrapperRef={wrapperRef}
                onNext={() => tourStep < TOUR_STEPS.length - 1 && enterStep(tourStep + 1)}
                onBack={() => tourStep > 0 && enterStep(tourStep - 1)}
                onExit={exitTour}
              />
            </>
          )}
        </div>

        <aside className="lg:sticky lg:top-24" aria-live="polite">
          {tourStep === null && (
            <>
              <div className="border border-tide/60 bg-abyss p-6">
                <p className="font-body text-[10px] uppercase tracking-[0.35em] text-mist">
                  What's actually happening
                </p>
                <h2 className="mt-3 font-headline text-3xl italic leading-snug text-pearl">
                  {annotation.headline}
                </h2>
                <div className="mt-5 flex flex-col gap-3">
                  {annotation.points.map((p) => (
                    <p key={p.slice(0, 24)} className="font-body text-sm leading-relaxed text-silk">
                      {p}
                    </p>
                  ))}
                </div>
              </div>
              <p className="mt-4 font-body text-[10px] text-mist">
                Tap through the phone. This panel follows. Or take the guided tour above.
              </p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
