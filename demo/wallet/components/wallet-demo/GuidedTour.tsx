/**
 * GuidedTour — spotlight overlay + anchored tooltip for the wallet demo.
 *
 * The spotlight is a single div whose geometry GSAP morphs between
 * data-tour anchors inside the phone; a 9999px box-shadow dims everything
 * around it and four corner brackets "lock on". The overlay portals into
 * the phone frame so the frame's rounded corners clip it.
 *
 * Narration is a tooltip anchored to the spotlight's bounding box: it
 * floats beside the phone at the spotlight's height and glides with it,
 * so eyes and mouse never leave the phone. Next lives on the tooltip;
 * interactive steps swap it for a pulsing click-prompt.
 *
 * Reduced motion: every tween collapses to a jump cut; pulses never start.
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import gsap from 'gsap';
import { cn } from '@/lib/cn';
import { TOUR_STEPS } from './tourSteps';

const BRACKET = 14;

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface SpotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SpotlightOverlayProps {
  stepIndex: number;
  frameHost: HTMLElement | null;
  onRect?: (rect: SpotRect) => void;
}

export function SpotlightOverlay({ stepIndex, frameHost, onRect }: SpotlightOverlayProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef<gsap.core.Tween | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !frameHost) return;
    const step = TOUR_STEPS[stepIndex];
    const measure = (): SpotRect | null => {
      const targetEl =
        step.target === 'frame'
          ? frameHost
          : frameHost.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (!targetEl) return null;
      const host = frameHost.getBoundingClientRect();
      const r = targetEl.getBoundingClientRect();
      const pad = step.target === 'frame' ? 6 : 8;
      return {
        left: r.left - host.left - pad,
        top: r.top - host.top - pad,
        width: r.width + pad * 2,
        height: r.height + pad * 2,
      };
    };

    const settle = step.settle ?? 120;
    let measured = false;
    const timer = window.setTimeout(() => {
      const rect = measure();
      if (!rect) return;
      measured = true;
      const targetEl =
        step.target === 'frame'
          ? frameHost
          : frameHost.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      targetEl?.scrollIntoView({
        block: 'nearest',
        behavior: reducedMotion() ? 'auto' : 'smooth',
      });
      onRect?.(rect);
      const instant = reducedMotion();
      gsap.to(box, {
        ...rect,
        autoAlpha: 1,
        duration: instant ? 0 : 0.65,
        ease: 'power4.inOut',
      });
      pulseRef.current?.kill();
      if (!instant) {
        gsap.fromTo(
          box.querySelectorAll('[data-bracket]'),
          { scale: 1.9, opacity: 0 },
          {
            scale: 1,
            opacity: 1,
            duration: 0.5,
            stagger: 0.04,
            ease: 'back.out(2.2)',
            delay: 0.35,
          },
        );
        pulseRef.current = gsap.to(box, {
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.72), 0 0 32px 2px rgba(244,239,227,0.28)',
          repeat: -1,
          yoyo: true,
          duration: 1.6,
          ease: 'sine.inOut',
          delay: 0.9,
        });
      }
    }, settle);

    const nudge = () => {
      if (reducedMotion()) return;
      gsap.fromTo(
        box,
        { x: 0 },
        { x: 7, duration: 0.07, repeat: 5, yoyo: true, ease: 'sine.inOut', clearProps: 'x' },
      );
    };
    frameHost.addEventListener('wd-tour-nudge', nudge);

    // Layout can shift under a measured spotlight (viewport resize, late
    // content, dev-time hot reload). Re-measure and snap without tweening.
    const resync = () => {
      if (!measured) return;
      const rect = measure();
      if (!rect) return;
      onRect?.(rect);
      gsap.set(box, rect);
    };
    const observer = new ResizeObserver(resync);
    observer.observe(frameHost);
    window.addEventListener('resize', resync);

    return () => {
      window.clearTimeout(timer);
      pulseRef.current?.kill();
      frameHost.removeEventListener('wd-tour-nudge', nudge);
      observer.disconnect();
      window.removeEventListener('resize', resync);
    };
  }, [stepIndex, frameHost, onRect]);

  if (!frameHost) return null;

  return createPortal(
    <div className="pointer-events-none absolute inset-0 z-30" aria-hidden>
      <div
        ref={boxRef}
        className="absolute rounded-2xl opacity-0"
        style={{
          left: 20,
          top: 20,
          width: 120,
          height: 80,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.72), 0 0 24px 0px rgba(244,239,227,0.18)',
        }}
      >
        {(
          [
            ['top', 'left', 'border-t-2 border-l-2', 'rounded-tl-lg'],
            ['top', 'right', 'border-t-2 border-r-2', 'rounded-tr-lg'],
            ['bottom', 'left', 'border-b-2 border-l-2', 'rounded-bl-lg'],
            ['bottom', 'right', 'border-b-2 border-r-2', 'rounded-br-lg'],
          ] as const
        ).map(([v, h, borders, round]) => (
          <span
            key={`${v}-${h}`}
            data-bracket
            className={cn('absolute border-glint/90', borders, round)}
            style={{ [v]: -2, [h]: -2, width: BRACKET, height: BRACKET }}
          />
        ))}
      </div>
    </div>,
    frameHost,
  );
}

export interface TourTooltipProps {
  stepIndex: number;
  rect: SpotRect | null;
  frameHost: HTMLElement | null;
  wrapperRef: RefObject<HTMLDivElement | null>;
  onNext: () => void;
  onBack: () => void;
  onExit: () => void;
}

export function TourTooltip({
  stepIndex,
  rect,
  frameHost,
  wrapperRef,
  onNext,
  onBack,
  onExit,
}: TourTooltipProps) {
  const step = TOUR_STEPS[stepIndex];
  const tipRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const last = stepIndex === TOUR_STEPS.length - 1;
  const interactive = step.advance === 'click';

  useLayoutEffect(() => {
    const tip = tipRef.current;
    const wrapper = wrapperRef.current;
    if (!tip || !wrapper || !frameHost || !rect) return;
    const wide = window.matchMedia('(min-width: 1024px)').matches;
    if (!wide) {
      gsap.set(tip, { clearProps: 'left,top' });
      gsap.to(tip, { autoAlpha: 1, duration: reducedMotion() ? 0 : 0.3 });
      return;
    }
    const w = wrapper.getBoundingClientRect();
    const f = frameHost.getBoundingClientRect();
    const frameLeft = f.left - w.left;
    const frameTop = f.top - w.top;
    const tipH = tip.offsetHeight;
    const left = frameLeft + f.width + 28;
    const idealTop = frameTop + rect.top + rect.height / 2 - tipH / 2;
    const top = Math.max(0, Math.min(idealTop, w.height - tipH));
    const caret = caretRef.current;
    if (caret) {
      const spotCenter = frameTop + rect.top + rect.height / 2;
      const caretTop = Math.max(14, Math.min(spotCenter - top, tipH - 14));
      caret.style.top = `${caretTop}px`;
    }
    const instant = reducedMotion();
    gsap.to(tip, {
      left,
      top,
      autoAlpha: 1,
      duration: instant ? 0 : 0.55,
      ease: 'power3.out',
    });
  }, [stepIndex, rect, frameHost, wrapperRef]);

  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip || reducedMotion()) return;
    gsap.fromTo(
      tip.querySelectorAll('[data-line]'),
      { y: 10, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 0.45, stagger: 0.06, ease: 'power3.out', delay: 0.1 },
    );
  }, [stepIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
      else if (!interactive && (e.key === 'ArrowRight' || e.key === 'Enter')) onNext();
      else if (e.key === 'ArrowLeft') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNext, onBack, onExit, interactive]);

  return (
    <div
      ref={tipRef}
      className={cn(
        'z-40 w-[300px] border border-tide bg-abyss p-4 opacity-0 shadow-2xl shadow-black/70',
        'lg:absolute lg:left-0 lg:top-0',
        'max-lg:mx-auto max-lg:mt-4',
      )}
      role="dialog"
      aria-label={`Tour step ${stepIndex + 1}: ${step.title}`}
    >
      <span
        ref={caretRef}
        aria-hidden
        className="absolute -left-[7px] hidden h-3 w-3 -translate-y-1/2 rotate-45 border-b border-l border-tide bg-abyss lg:block"
        style={{ top: 24 }}
      />
      <p data-line className="font-body text-[9px] uppercase tracking-[0.3em] text-mist">
        {stepIndex + 1} / {TOUR_STEPS.length}
      </p>
      <h3 data-line className="mt-1.5 font-headline text-xl italic leading-snug text-pearl">
        {step.title}
      </h3>
      <p data-line className="mt-2 font-body text-xs leading-relaxed text-silk">
        {step.copy}
      </p>

      <div className="mt-3 h-0.5 w-full bg-tide" aria-hidden>
        <div
          className="h-full bg-glint transition-[width] duration-300"
          style={{ width: `${((stepIndex + 1) / TOUR_STEPS.length) * 100}%` }}
        />
      </div>

      <div className="mt-3 flex h-[36px] items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onExit}
            className="px-1.5 py-2 font-body text-[9px] uppercase tracking-[0.2em] text-mist hover:text-silk focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-glint"
          >
            End
          </button>
          <button
            type="button"
            onClick={onBack}
            disabled={stepIndex === 0}
            className={cn(
              'px-1.5 py-2 font-body text-[9px] uppercase tracking-[0.2em]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-glint',
              stepIndex === 0 ? 'cursor-not-allowed text-mist/40' : 'text-silk hover:text-pearl',
            )}
          >
            Back
          </button>
        </div>
        {interactive ? (
          <span className="border border-glint/40 px-3 py-2 font-body text-[9px] uppercase tracking-[0.18em] text-glint motion-safe:animate-pulse">
            {step.clickPrompt}
          </span>
        ) : (
          <button
            type="button"
            onClick={last ? onExit : onNext}
            className="bg-pearl px-4 py-2 font-body text-[9px] uppercase tracking-[0.2em] text-void hover:bg-glint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-glint focus-visible:ring-offset-2 focus-visible:ring-offset-void"
          >
            {last ? 'Finish' : 'Next'}
          </button>
        )}
      </div>
    </div>
  );
}

export function useFrameHost(themeId: string): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('[data-wd-frame]'));
  }, [themeId]);
  return host;
}
