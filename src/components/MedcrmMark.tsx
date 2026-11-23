/** The MedCRM mark: three rising bars. The two side bars are lime; the tall centre bar
 *  takes `--mark-core` (deep green on light grounds, lime on dark ones, set in CSS),
 *  matching the brand's two-colour and all-lime variants. */
export default function MedcrmMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="712 716 576 568" className={className} role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true} aria-label={title} focusable="false">
      <path fill="var(--mark-side, #e1ea75)" d="M717.06,879.47h89.01c41.91,0,75.88,33.97,75.88,75.88v323.78h0c-91.07,0-164.89-73.82-164.89-164.89v-234.78Z" />
      <path fill="var(--mark-core, #063531)" d="M917.55,720.87h89.01c41.91,0,75.88,33.97,75.88,75.88v482.38h0c-91.07,0-164.89-73.82-164.89-164.89v-393.38Z" />
      <path fill="var(--mark-side, #e1ea75)" d="M1118.05,720.87h89.01c41.91,0,75.88,33.97,75.88,75.88v323.78h0c-91.07,0-164.89-73.82-164.89-164.89v-234.78Z" />
    </svg>
  );
}
