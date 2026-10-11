import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/cn';

// Exported so link-shaped actions (e.g. a mailto: that must be a real <a>)
// can wear the same clothes as a Button.
export const buttonStyles = cva(
  // The ring offset is scoped to focus-visible with the ring itself:
  // Tailwind 4's ring-offset-* paints its offset shadow unconditionally,
  // which drew a 2px ink-50 halo round every button on dark surfaces.
  'tap-feedback inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      variant: {
        // Dark hovers brighten instead: shades 700+ re-map to light text
        // tones there, so "darken on hover" would flip to a pale button.
        primary:
          'bg-brand-600 text-white hover:bg-brand-700 dark:hover:bg-brand-400 shadow-xs',
        secondary:
          'bg-surface text-ink-800 border border-ink-200 hover:bg-ink-50 dark:hover:bg-ink-100 shadow-xs',
        ghost: 'text-ink-700 hover:bg-ink-100',
        danger:
          'bg-warn-500 text-white hover:bg-warn-700 dark:hover:bg-[#e39a3b]',
      },
      size: {
        sm: 'min-h-9 px-3.5 text-sm',
        md: 'min-h-12 px-5 text-base',
        lg: 'min-h-14 px-6 text-lg',
        xl: 'min-h-16 px-8 text-xl',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonStyles> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonStyles({ variant, size, block }), className)}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
