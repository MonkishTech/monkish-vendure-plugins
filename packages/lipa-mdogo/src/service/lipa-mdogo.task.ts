import { ScheduledTask } from '@vendure/core';

import { LipaMdogoService } from './lipa-mdogo.service';

export const lipaMdogoPlansTask = new ScheduledTask({
  id: 'lipa-mdogo-plans',
  schedule: (cron) => cron.everyHour(),
  execute: async ({ injector }) => {
    await injector.get(LipaMdogoService).runDuePlans();
  },
});
