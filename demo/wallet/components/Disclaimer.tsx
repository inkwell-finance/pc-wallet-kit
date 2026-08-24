/**
 * Pre-alpha disclaimer banner — verbatim from
 * packages/dagon/documentation/points-farm-copy.md §1.
 *
 * SOUL.md §108 ("no FHE-privacy-today claims") makes this banner load-bearing for the points-farm
 * UI. It must be visible on every screen and the wording must not be paraphrased away from the
 * source-of-truth doc.
 */

import { AlertTriangle } from 'lucide-react';

export function PreAlphaDisclaimer() {
  return (
    <aside
      role="note"
      aria-label="Pre-alpha disclaimer"
      className="border-l-4 border-amber-500/80 bg-amber-500/5 px-4 py-3 mb-6 text-sm text-amber-100/90 flex gap-3"
    >
      <AlertTriangle className="size-4 mt-0.5 flex-shrink-0 text-amber-400" />
      <p>
        <strong className="text-amber-300">Pre-alpha:</strong> Encrypt's production FHE is not live
        yet — your balances and trade amounts are{' '}
        <strong className="text-amber-300">publicly visible on-chain</strong> today. This is a UX
        preview to get you ready for Alpha 1, when real encryption ships. Do not trade real value
        here.
      </p>
    </aside>
  );
}
