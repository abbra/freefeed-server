import config from 'config';
import { DateTime } from 'luxon';

import { JobManager } from '../../models';
import { sendBestOfEmails } from '../../support/BestOfDigest';
import { sendEmails as sendNotificationsEmails } from '../../support/NotificationsDigest';

import { definePeriodicJob } from '.';

export const PERIODIC_SEND_BEST_OF_EMAILS = 'PERIODIC_SEND_BEST_OF_EMAILS';
export const PERIODIC_SEND_NOTIFICATIONS_EMAILS = 'PERIODIC_SEND_NOTIFICATIONS_EMAILS';

const sendConfigs = [
  {
    ...(config.dailyMails.bestOf || { enabled: false }),
    name: PERIODIC_SEND_BEST_OF_EMAILS,
    handler: sendBestOfEmails,
  },
  {
    ...(config.dailyMails.notifications || { enabled: false }),
    name: PERIODIC_SEND_NOTIFICATIONS_EMAILS,
    handler: sendNotificationsEmails,
  },
];

export async function initHandlers(jobManager: JobManager) {
  await Promise.all(
    sendConfigs
      .filter(({ enabled }) => enabled)
      .map(({ name, sendAt, handler }) => {
        const [hours, minutes] = sendAt.split(':').map(Number);

        return definePeriodicJob(jobManager, {
          name,
          handler,
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
      }),
  );
}
