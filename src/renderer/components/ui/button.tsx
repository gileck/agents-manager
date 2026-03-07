import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.25)_inset,0_8px_18px_hsl(var(--primary)/0.22)] hover:bg-primary/95 active:translate-y-px',
        destructive: 'bg-destructive text-destructive-foreground shadow-[0_0_0_1px_hsl(var(--destructive)/0.35)_inset] hover:bg-destructive/90',
        outline: 'border border-border/80 bg-background/65 text-foreground shadow-sm hover:bg-accent/55',
        secondary: 'border border-border/70 bg-secondary/75 text-secondary-foreground shadow-sm hover:bg-secondary',
        ghost: 'text-muted-foreground hover:bg-accent/55 hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        success: 'bg-success text-success-foreground shadow-[0_0_0_1px_hsl(var(--success)/0.25)_inset] hover:bg-success/90',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-10 px-8',
        icon: 'h-9 w-9 rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
