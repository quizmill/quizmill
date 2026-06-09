import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

interface StatTileProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
}

export function StatTile({ label, value, hint, className }: StatTileProps) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="text-sm font-medium uppercase tracking-wide text-ink-500">
        {label}
      </div>
      <div className="mt-1 text-3xl font-bold text-ink-800">{value}</div>
      {hint ? <div className="mt-1 text-sm text-ink-500">{hint}</div> : null}
    </Card>
  );
}
