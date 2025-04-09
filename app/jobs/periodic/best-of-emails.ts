import config from 'config';

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
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);

      if (next < now) {
        next.setDate(next.getDate() + 1);
      }

      return next;
    },
    payload: {},
  });
}
