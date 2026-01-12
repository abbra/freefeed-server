/* eslint-env node, mocha */
/* global $pg_database */
import unexpected from 'unexpected';
import unexpectedDate from 'unexpected-date';
import { pick, sortBy } from 'lodash';
import { DateTime } from 'luxon';
import { simpleParser } from 'mailparser';
import config from 'config';

import cleanDB from '../../../dbCleaner';
import { User, dbAdapter } from '../../../../app/models';
import {
  GONE_SUSPENDED,
  GONE_PAUSED,
  GONE_COOLDOWN,
  GONE_DELETION,
  GONE_DELETED,
} from '../../../../app/models/user';
import {
  USER_COOLDOWN_START,
  USER_COOLDOWN_REMINDER,
  USER_DELETION_START,
  USER_DELETE_DATA,
  USER_PAUSED_START,
  USER_PAUSED_REMINDER,
} from '../../../../app/jobs/user-gone';
import { initJobProcessing } from '../../../../app/jobs';
import { addMailListener } from '../../../../lib/mailer';
import { serializeUsersByIds } from '../../../../app/serializers/v2/user';

const expect = unexpected.clone();
expect.use(unexpectedDate);

const jobTypes = [
  USER_COOLDOWN_START,
  USER_COOLDOWN_REMINDER,
  USER_DELETION_START,
  USER_DELETE_DATA,
  USER_PAUSED_START,
  USER_PAUSED_REMINDER,
];

describe(`User's 'gone' status`, () => {
  describe(`Clean gone user's fields`, () => {
    let luna;

    before(async () => {
      await cleanDB($pg_database);

      luna = new User({
        username: 'luna',
        screenName: 'Luna Lovegood',
        email: 'luna@lovegood.good',
        password: 'pw',
      });
      await luna.create();
    });

    it(`should return Lunas's props from db`, async () => {
      const luna1 = await dbAdapter.getUserById(luna.id);
      expect(
        pick(luna1, ['username', 'screenName', 'email']),
        'to equal',
        pick(luna, ['username', 'screenName', 'email']),
      );
    });

    it(`should return cleaned Lunas's props when Luna is gone`, async () => {
      const [, now] = await Promise.all([luna.setGoneStatus(GONE_SUSPENDED), dbAdapter.now()]);
      const luna1 = await dbAdapter.getUserById(luna.id);
      expect(luna1, 'to satisfy', {
        username: 'luna',
        screenName: 'luna',
        email: '',
        isPrivate: '1',
        isProtected: '1',
        goneStatus: GONE_SUSPENDED,
        goneAt: expect.it('to be close to', now),
      });

      const [serializedLuna] = await serializeUsersByIds([luna.id]);
      expect(serializedLuna, 'to satisfy', {
        isGone: true,
        goneStatus: 'suspended',
      });
    });

    it(`should return initial Lunas's props when Luna isn't gone anymore`, async () => {
      await luna.setGoneStatus(null);
      const luna1 = await dbAdapter.getUserById(luna.id);
      expect(
        pick(luna1, ['username', 'screenName', 'email']),
        'to equal',
        pick(luna, ['username', 'screenName', 'email']),
      );
    });
  });

  describe(`Gone user's deferred jobs`, () => {
    let luna,
      jobManager,
      capturedMail = null;
    let removeMailListener = () => null;

    before(async () => {
      await cleanDB($pg_database);

      luna = new User({
        username: 'luna',
        screenName: 'Luna Lovegood',
        email: 'luna@lovegood.good',
        password: 'pw',
      });
      await luna.create();

      jobManager = await initJobProcessing();
      removeMailListener = addMailListener((r) => (capturedMail = r));
    });

    after(removeMailListener);

    beforeEach(() => (capturedMail = null));

    it(`should create start job when user changes status to GONE_COOLDOWN`, async () => {
      const [, now] = await Promise.all([luna.setGoneStatus(GONE_COOLDOWN), dbAdapter.now()]);

      const jobs = await dbAdapter.getAllJobs(jobTypes);
      expect(jobs, 'to satisfy', [
        {
          name: USER_COOLDOWN_START,
          payload: { id: luna.id, goneAt: luna.goneAt.getTime() },
          unlockAt: expect.it('to be close to', now),
        },
      ]);
    });

    it(`should send email to user's real address`, async () => {
      await jobManager.fetchAndProcess();

      expect(capturedMail, 'to satisfy', { envelope: { to: ['luna@lovegood.good'] } });
      const parsedMail = await simpleParser(capturedMail.response);
      expect(parsedMail, 'to satisfy', {
        to: { text: '"luna" <luna@lovegood.good>' },
        subject: 'Your account has been suspended',
      });
    });

    it(`should create next deletion jobs after the first job processed`, async () => {
      const reminderTime = DateTime.fromJSDate(luna.goneAt)
        .setZone(config.ianaTimeZone)
        // Schedule reminder to 9:00
        .startOf('day')
        .plus({ days: config.userDeletion.reminderDays, hours: 9 })
        .toJSDate();

      const deletionTime = DateTime.fromJSDate(luna.goneAt)
        .plus({ days: config.userDeletion.cooldownDays })
        .toJSDate();

      const jobs = await dbAdapter.getAllJobs(jobTypes);
      expect(sortBy(jobs, 'unlockAt'), 'to satisfy', [
        {
          name: USER_COOLDOWN_REMINDER,
          payload: { id: luna.id, goneAt: luna.goneAt.getTime() },
          unlockAt: expect.it('to be close to', reminderTime),
        },
        {
          name: USER_DELETION_START,
          payload: { id: luna.id, goneAt: luna.goneAt.getTime() },
          unlockAt: expect.it('to be close to', deletionTime),
        },
      ]);
    });

    it(`should send a reminder email`, async () => {
      const jobs = await dbAdapter.getAllJobs(jobTypes);
      const reminderJob = jobs.find((job) => job.name === USER_COOLDOWN_REMINDER);
      // Manually unlock reminder job
      await reminderJob.setUnlockAt(0);

      await jobManager.fetchAndProcess();

      expect(capturedMail, 'to satisfy', { envelope: { to: ['luna@lovegood.good'] } });
      const parsedMail = await simpleParser(capturedMail.response);
      expect(parsedMail, 'to satisfy', {
        to: { text: '"luna" <luna@lovegood.good>' },
        subject: 'Your account data will be deleted in a few days',
      });
    });

    it(`should switch user to GONE_DELETION status`, async () => {
      const jobs = await dbAdapter.getAllJobs(jobTypes);
      expect(jobs, 'to satisfy', [{ name: USER_DELETION_START }]);
      const [deletionJob] = jobs;
      // Manually unlock deletion job
      await deletionJob.setUnlockAt(0);

      await jobManager.fetchAndProcess();

      const user = await dbAdapter.getUserById(luna.id);

      expect(user.goneStatus, 'to be', GONE_DELETION);

      const newJobs = await dbAdapter.getAllJobs(jobTypes);
      expect(newJobs, 'to satisfy', [{ name: USER_DELETE_DATA }]);
    });

    it(`should delete user data`, async () => {
      await jobManager.fetchAndProcess();

      const newJobs = await dbAdapter.getAllJobs(jobTypes);
      expect(newJobs, 'to be empty');

      const user = await dbAdapter.getUserById(luna.id);
      // Check that the user profile is really cleaned
      expect(user, 'to satisfy', { goneStatus: GONE_DELETED, hiddenEmail: '' });

      const [serializedLuna] = await serializeUsersByIds([luna.id]);
      expect(serializedLuna, 'to satisfy', {
        isGone: true,
        goneStatus: 'deleted',
      });

      expect(capturedMail, 'to satisfy', { envelope: { to: ['luna@lovegood.good'] } });
      const parsedMail = await simpleParser(capturedMail.response);
      expect(parsedMail, 'to satisfy', {
        to: { text: '"luna" <luna@lovegood.good>' },
        subject: 'Your account has been deleted',
      });
    });
  });

  describe(`Paused user status (GONE_PAUSED)`, () => {
    let luna;
    let originalLunaProps;

    beforeEach(async () => {
      await cleanDB($pg_database);

      luna = new User({
        username: 'luna',
        screenName: 'Luna Lovegood',
        email: 'luna@lovegood.good',
        password: 'pw',
      });
      await luna.create();

      // Save original props for restore test
      originalLunaProps = pick(luna, ['username', 'screenName', 'email']);
    });

    it(`should clean user's fields when status is set to GONE_PAUSED`, async () => {
      const [, now] = await Promise.all([luna.setGoneStatus(GONE_PAUSED), dbAdapter.now()]);
      const luna1 = await dbAdapter.getUserById(luna.id);
      expect(luna1, 'to satisfy', {
        username: 'luna',
        screenName: 'luna',
        email: '',
        isPrivate: '1',
        isProtected: '1',
        goneStatus: GONE_PAUSED,
        goneAt: expect.it('to be close to', now),
      });
    });

    it(`should save pause message when provided`, async () => {
      const pauseMessage = 'Taking a break until February';
      await luna.setPauseMessage(pauseMessage);

      const savedMessage = luna.getPauseMessage();
      expect(savedMessage, 'to be', pauseMessage);
    });

    it(`should show pause message in description when user is serialized`, async () => {
      const pauseMessage = 'On vacation until March';
      await luna.setGoneStatus(GONE_PAUSED);
      await luna.setPauseMessage(pauseMessage);

      const [serializedLuna] = await serializeUsersByIds([luna.id]);

      expect(serializedLuna.description, 'to be', pauseMessage);
      expect(serializedLuna.isGone, 'to be', true);
      expect(serializedLuna.goneStatus, 'to be', 'paused');
    });

    it(`should trim pause message`, async () => {
      const pauseMessage = '  Spaces around  ';
      await luna.setPauseMessage(pauseMessage);

      const savedMessage = luna.getPauseMessage();
      expect(savedMessage, 'to be', 'Spaces around');
    });

    it(`should not save empty pause message`, async () => {
      await luna.setPauseMessage('   ');

      const savedMessage = luna.getPauseMessage();
      expect(savedMessage, 'to be', null);
    });

    it(`should reject too long pause message`, async () => {
      const longMessage = 'a'.repeat(1501);

      await expect(
        luna.setPauseMessage(longMessage),
        'to be rejected with',
        /Pause message is too long/,
      );
    });

    it(`should clear pause message when set to null`, async () => {
      await luna.setPauseMessage('Some message');
      await luna.setPauseMessage(null);

      const savedMessage = luna.getPauseMessage();
      expect(savedMessage, 'to be', null);
    });

    it(`should keep pause message when status changes`, async () => {
      await luna.setPauseMessage('Some message');
      await luna.setGoneStatus(GONE_SUSPENDED);

      luna = await dbAdapter.getUserById(luna.id);
      const savedMessage = luna.getPauseMessage();
      expect(savedMessage, 'to be', 'Some message');

      await luna.setGoneStatus(null);
      luna = await dbAdapter.getUserById(luna.id);
      const savedMessageAfter = luna.getPauseMessage();
      expect(savedMessageAfter, 'to be', 'Some message');
    });

    it(`should restore user's fields when status is cleared`, async () => {
      await luna.setGoneStatus(GONE_PAUSED);
      await luna.setGoneStatus(null);
      const luna1 = await dbAdapter.getUserById(luna.id);
      expect(pick(luna1, ['username', 'screenName', 'email']), 'to equal', originalLunaProps);
    });
  });

  describe(`Paused user's jobs`, () => {
    let luna,
      jobManager,
      capturedMail = null;
    let removeMailListener = () => null;

    before(async () => {
      await cleanDB($pg_database);

      luna = new User({
        username: 'luna',
        screenName: 'Luna Lovegood',
        email: 'luna@lovegood.good',
        password: 'pw',
      });
      await luna.create();

      jobManager = await initJobProcessing();
      removeMailListener = addMailListener((r) => (capturedMail = r));
    });

    after(removeMailListener);

    beforeEach(() => (capturedMail = null));

    it(`should create only start job when user changes status to GONE_PAUSED`, async () => {
      const [, now] = await Promise.all([luna.setGoneStatus(GONE_PAUSED), dbAdapter.now()]);

      const jobs = await dbAdapter.getAllJobs(jobTypes);
      expect(jobs, 'to satisfy', [
        {
          name: USER_PAUSED_START,
          payload: { id: luna.id, goneAt: luna.goneAt.getTime() },
          unlockAt: expect.it('to be close to', now),
        },
      ]);
    });

    it(`should send email to user's real address`, async () => {
      await jobManager.fetchAndProcess();

      expect(capturedMail, 'to satisfy', { envelope: { to: ['luna@lovegood.good'] } });
      const parsedMail = await simpleParser(capturedMail.response);
      expect(parsedMail, 'to satisfy', {
        to: { text: '"luna" <luna@lovegood.good>' },
        subject: 'You have paused your account',
      });
    });

    it(`should create monthly reminder job after the start job processed`, async () => {
      const jobs = await dbAdapter.getAllJobs(jobTypes);
      expect(jobs, 'to satisfy', [
        {
          name: USER_PAUSED_REMINDER,
          payload: { id: luna.id, goneAt: luna.goneAt.getTime() },
          unlockAt: expect.it('to be a date'),
        },
      ]);
    });

    it(`should send reminder email when reminder job is processed`, async () => {
      const jobs = await dbAdapter.getAllJobs(jobTypes);
      const reminderJob = jobs.find((job) => job.name === USER_PAUSED_REMINDER);
      // Manually unlock reminder job
      await reminderJob.setUnlockAt(0);

      await jobManager.fetchAndProcess();

      expect(capturedMail, 'to satisfy', { envelope: { to: ['luna@lovegood.good'] } });
      const parsedMail = await simpleParser(capturedMail.response);
      expect(parsedMail, 'to satisfy', {
        to: { text: '"luna" <luna@lovegood.good>' },
        subject: 'Your account is still paused',
      });
    });

    it(`should schedule next reminder after processing current one`, async () => {
      const jobs = await dbAdapter.getAllJobs(jobTypes);
      expect(jobs, 'to satisfy', [
        {
          name: USER_PAUSED_REMINDER,
          payload: { id: luna.id, goneAt: luna.goneAt.getTime() },
          unlockAt: expect.it('to be a date'),
        },
      ]);
    });

    it(`should allow user to resume account`, async () => {
      await luna.setGoneStatus(null);
      const user = await dbAdapter.getUserById(luna.id);

      expect(user.goneStatus, 'to be', null);
      expect(user.email, 'to be', 'luna@lovegood.good');
    });

    it(`should not send reminders after user resumed account`, async () => {
      // Jobs remain but will be skipped by checkUserStatus
      const jobs = await dbAdapter.getAllJobs(jobTypes);
      const reminderJob = jobs.find((job) => job.name === USER_PAUSED_REMINDER);

      if (reminderJob) {
        // Manually unlock to test that handler skips it
        await reminderJob.setUnlockAt(0);
        await jobManager.fetchAndProcess();

        // No new email should be sent since user is no longer paused
        expect(capturedMail, 'to be', null);
      }
    });
  });
});
