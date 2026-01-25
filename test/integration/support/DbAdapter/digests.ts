import unexpected from 'unexpected';
import unexpectedDate from 'unexpected-date';

import { dbAdapter, User } from '../../../../app/models';
import cleanDB from '../../../dbCleaner';
import { createUsers } from '../../helpers/users';
import { shouldSendDailyBestOfDigest } from '../../../../app/support/BestOfDigest';

const expect = unexpected.clone();
expect.use(unexpectedDate);

describe('Basic digests functions', () => {
  beforeEach(() => cleanDB(dbAdapter.database));

  let luna: User, mars: User;
  beforeEach(async () => {
    [luna, mars] = await createUsers(['luna', 'mars']);
  });

  describe('Basic Notifications digest functions', () => {
    describe("Mars doesn't want to receive the Notifications Digest", () => {
      // Only Luna has an email
      beforeEach(() => luna.update({ email: 'luna.lovegood@example.com' }));

      it(`should return the Notification Digest recipients`, async () => {
        const now = await dbAdapter.now();
        const recipients = await dbAdapter.getNotificationsDigestRecipients();
        expect(recipients, 'to satisfy', [
          {
            id: luna.id,
            intId: luna.intId,
            username: 'luna',
            email: 'luna.lovegood@example.com',
            notificationsReadAt: expect.it('to be close to', now),
          },
        ]);
      });
    });
  });

  describe('Basic "Best Of" functions', () => {
    beforeEach(() =>
      Promise.all([
        luna.update({ email: 'luna.lovegood@example.com' }),
        mars.update({ email: 'mars.jupiterson@example.com' }),
      ]),
    );

    describe('Luna want to receive the Daily Best Of', () => {
      beforeEach(() => luna.update({ preferences: { sendDailyBestOfDigest: true } }));

      it(`should return the Daily Best Of recipients`, async () => {
        const recipients = await dbAdapter.getDailyBestOfDigestRecipients();
        expect(recipients, 'to satisfy', [
          { id: luna.id, username: 'luna', email: 'luna.lovegood@example.com' },
        ]);
      });

      it(`should return the last sent dates as empty object`, async () => {
        const recipients = await dbAdapter.getDailyBestOfDigestRecipients();
        const dailyEmailsSentAt = await dbAdapter.getDailyBestOfEmailSentAt(
          recipients.map((u) => u.intId),
        );
        expect(dailyEmailsSentAt, 'to satisfy', {});
      });

      describe('Luna receives the Daily Best Of mail, Mars also wants to receive', () => {
        let sendDate: Date;
        beforeEach(async () => {
          await dbAdapter.addSentEmailLogEntry(
            luna.intId,
            'luna.lovegood@example.com',
            'daily_best_of',
          );
          await mars.update({ preferences: { sendDailyBestOfDigest: true } });
          sendDate = await dbAdapter.now();
        });

        it(`should return the Daily Best Of recipients`, async () => {
          const recipients = await dbAdapter.getDailyBestOfDigestRecipients();
          expect(
            recipients,
            'when sorted by',
            idCmp,
            'to satisfy',
            [
              { id: mars.id, username: 'mars', email: 'mars.jupiterson@example.com' },
              { id: luna.id, username: 'luna', email: 'luna.lovegood@example.com' },
            ].sort(idCmp),
          );
        });

        it(`should return the last sent dates`, async () => {
          const recipients = await dbAdapter.getDailyBestOfDigestRecipients();
          const dailyEmailsSentAt = await dbAdapter.getDailyBestOfEmailSentAt(
            recipients.map((u) => u.intId),
          );
          expect(dailyEmailsSentAt, 'to satisfy', {
            [luna.intId]: expect.it('to be close to', sendDate),
          });
        });

        it(`should check the 'shouldSendDailyBestOfDigest' output`, async () => {
          const userIntIds = [luna, mars].map((u) => u.intId);
          const dailyEmailsSentAt = await dbAdapter.getDailyBestOfEmailSentAt(userIntIds);
          const weeklyEmailsSentAt = await dbAdapter.getWeeklyBestOfEmailSentAt(userIntIds);

          let shouldSend: Record<string, boolean> = {};

          for (const intId of userIntIds) {
            shouldSend[intId] = shouldSendDailyBestOfDigest(
              dailyEmailsSentAt[intId],
              weeklyEmailsSentAt[intId],
            );
          }

          expect(shouldSend, 'to satisfy', {
            [luna.intId]: false,
            [mars.intId]: true,
          });

          // Let's pass some time
          const futureDate = new Date(sendDate.getTime() + 28 * 60 * 60 * 1000);
          shouldSend = {};

          for (const intId of userIntIds) {
            shouldSend[intId] = shouldSendDailyBestOfDigest(
              dailyEmailsSentAt[intId],
              weeklyEmailsSentAt[intId],
              futureDate,
            );
          }

          expect(shouldSend, 'to satisfy', {
            [luna.intId]: true,
            [mars.intId]: true,
          });
        });
      });
    });
  });
});

function idCmp(a: { id: string }, b: { id: string }) {
  // eslint-disable-next-line no-nested-ternary
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
