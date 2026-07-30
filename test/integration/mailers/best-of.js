import { readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

import { v4 as createUuid } from 'uuid';
import config from 'config';
import expect from 'unexpected';
import ejs from 'ejs';
import { simpleParser } from 'mailparser';

import {
  renderSummaryBody,
  sendDailyBestOfEmail,
  sendWeeklyBestOfEmail,
} from '../../../app/mailers/BestOfDigestMailer';
import { addMailListener } from '../../../lib/mailer';
import { createUser } from '../helpers/users';
import { createPost } from '../helpers/posts-and-comments';
import { testFiles } from '../models/attachment-data';
import { nodeDirname } from '../../../app/support/node-dirname';
import { Attachment, dbAdapter } from '../../../app/models';
import cleanDB from '../../dbCleaner';
import { getSummary } from '../../../app/support/BestOfDigest';

const __dirname = nodeDirname(import.meta.url);

describe('BestOfDigests', () => {
  let luna, post, att;

  before(async () => {
    await cleanDB(dbAdapter.database);
    luna = await createUser('luna');
    post = await createPost(luna, 'Post body');

    // Add attachment to post
    {
      const { name: fileName } = testFiles.medium;
      const fixturesDir = resolve(__dirname, '../../fixtures');
      const fileData = await readFile(resolve(fixturesDir, fileName));
      const tmpPath = join(tmpdir(), `upl-${createUuid()}`);
      await writeFile(tmpPath, fileData);
      att = await Attachment.create(tmpPath, fileName, luna, post.id);
    }
  });

  describe('renderSummaryBody', () => {
    it(`should render a summary body and doesn't blow up`, async () => {
      const dailySummary = await getSummary(luna, 1);
      const body = await renderSummaryBody(dailySummary);
      expect(body, 'to contain', '<style>');
      expect(
        body,
        'to contain',
        '<div class="posts"><div class="post timeline-post" data-author="luna"',
      );
      expect(
        body,
        'to contain',
        `<img class="image-attachment-img" src="http://localhost:31337/attachments/thumbnails/${att.id}.webp" alt="${att.fileName}`,
      );
    });

    it('should inline email styles with Juice', async () => {
      const dailySummary = await getSummary(luna, 1);
      const body = await renderSummaryBody(dailySummary);

      expect(
        body,
        'to match',
        /<div class="post timeline-post" data-author="luna" style="(?=[^"]*padding-top: 14px)(?=[^"]*border-bottom: 1px solid #eee)(?=[^"]*line-height: 19px)[^"]*">/,
      );
      expect(
        body,
        'to match',
        /<div class="post-body" style="(?=[^"]*margin-left: 63px)(?=[^"]*color: #666)(?=[^"]*font-size: 14px)[^"]*">/,
      );
      expect(
        body,
        'to match',
        /<img class="image-attachment-img"[^>]*style="(?=[^"]*display: block)(?=[^"]*max-width: 525px)(?=[^"]*max-height: 175px)[^"]*"[^>]*>/,
      );
    });
  });

  describe('sendBestOfEmail', () => {
    let capturedMail = null;
    let removeMailListener = () => null;

    before(() => {
      removeMailListener = addMailListener((r) => (capturedMail = r));
    });
    after(removeMailListener);

    it(`should send daily best of email and doesn't blow up`, async () => {
      const digestDate = 'April 1st';
      const dailySummary = await getSummary(luna, 1);
      const user = { email: 'luna@example.com' };

      await sendDailyBestOfEmail(user, dailySummary, digestDate);

      expect(capturedMail, 'to satisfy', { envelope: { to: [user.email] } });
      const parsedMail = await simpleParser(capturedMail.response);
      expect(parsedMail, 'to satisfy', {
        subject: ejs.render(config.mailer.dailyBestOfDigestMailSubject, { digestDate }),
        html: expect.it(
          'to contain',
          '<div class="posts"><div class="post timeline-post" data-author="luna"',
        ),
      });
    });

    it(`should send weekly best of email and doesn't blow up`, async () => {
      const digestDate = 'April 1st';
      const weeklySummary = await getSummary(luna, 7);
      const user = { email: 'luna@example.com' };

      await sendWeeklyBestOfEmail(user, weeklySummary, digestDate);

      expect(capturedMail, 'to satisfy', { envelope: { to: [user.email] } });
      const parsedMail = await simpleParser(capturedMail.response);
      expect(parsedMail, 'to satisfy', {
        subject: ejs.render(config.mailer.weeklyBestOfDigestMailSubject, { digestDate }),
        html: expect.it(
          'to contain',
          '<div class="posts"><div class="post timeline-post" data-author="luna"',
        ),
      });
    });
  });
});
