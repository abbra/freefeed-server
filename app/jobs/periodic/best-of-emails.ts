import config from 'config';
import { DateTime } from 'luxon';

import { JobManager } from '../../models';
import { sendBestOfEmails } from '../../support/BestOfDigest';

import { definePeriodicJob } from '.';

export const PERIODIC_SEND_BEST_OF_EMAILS = 'PERIODIC_SEND_BEST_OF_EMAILS';

export function initHandlers(jobManager: JobManager) {
  const { enabled, sendAt } = config.dailyMails.bestOf;

  if (!enabled) {
    return Promise.resolve();
  }

  const [hours, minutes] = sendAt.split(':').map(Number);

  return definePeriodicJob(jobManager, {
    name: PERIODIC_SEND_BEST_OF_EMAILS,
    handler: sendBestOfEmails,
    nextTime: () => {
      const now = DateTime.now().setZone(config.ianaTimeZone);
      let next = now.startOf('day').plus({ hours, minutes });

      if (next < now) {
        next = next.plus({ days: 1 });
      }

      return next.toJSDate();
    },
    payload: {},
  });
}
