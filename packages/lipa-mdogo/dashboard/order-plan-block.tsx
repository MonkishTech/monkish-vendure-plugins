import { DateTime, Money } from '@vendure/dashboard';

type LipaMdogoPlan = {
  deadline: string | Date;
  outstanding: number;
  minimumDue: number;
  state: string;
};

type OrderEntity = {
  currencyCode?: string;
  lipaMdogoPlan?: LipaMdogoPlan | null;
};

export function OrderPlanBlock({
  context,
}: {
  context: { entity?: OrderEntity | null };
}) {
  const plan = context.entity?.lipaMdogoPlan;
  const currencyCode = context.entity?.currencyCode;

  if (!plan || !currencyCode) {
    return null;
  }

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-muted-foreground">State</div>
        <div>{plan.state}</div>
      </div>
      <div>
        <div className="text-muted-foreground">Deadline</div>
        <DateTime value={plan.deadline} />
      </div>
      <div>
        <div className="text-muted-foreground">Outstanding</div>
        <Money value={plan.outstanding} currency={currencyCode} />
      </div>
      <div>
        <div className="text-muted-foreground">Minimum due</div>
        <Money value={plan.minimumDue} currency={currencyCode} />
      </div>
    </div>
  );
}

export function shouldRenderOrderPlanBlock(context: {
  entity?: OrderEntity | null;
}): boolean {
  return context.entity?.lipaMdogoPlan != null;
}
