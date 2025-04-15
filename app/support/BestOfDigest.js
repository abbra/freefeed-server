import createDebug from 'debug';
import _ from 'lodash';
import { DateTime } from 'luxon';

import { dbAdapter } from '../models';
import { sendDailyBestOfEmail, sendWeeklyBestOfEmail } from '../mailers/BestOfDigestMailer';
import { generalSummary } from '../controllers/api/v2/SummaryController.js';
import { API_VERSION_2 } from '../api-versions';

import { currentConfig } from './app-async-context';

const BESTOF_DIGEST_POSTS_LIMIT = 15;

export async function sendBestOfEmails() {
  const tz = currentConfig().ianaTimeZone;
  const debugLog = createDebug('freefeed:digests:bestOf');

  const weeklyDigestRecipients = (await dbAdapter.getWeeklyBestOfDigestRecipients()).filter(
    (u) => u.isActive,
  );
  debugLog(`getWeeklyBestOfDigestRecipients returned ${weeklyDigestRecipients.length} records`);

  const dailyDigestRecipients = (await dbAdapter.getDailyBestOfDigestRecipients()).filter(
    (u) => u.isActive,
  );
  debugLog(`getDailyBestOfDigestRecipients returned ${dailyDigestRecipients.length} records`);

  const dailyDigestDate = formatDigestDate(DateTime.now().setZone(tz));
  const weeklyDigestDate = formatDigestDate(
    // Start of the previous week
    DateTime.now().setZone(tz).minus({ weeks: 1 }).startOf('week'),
  );

  const weeklyEmailsSentAt = await dbAdapter.getWeeklyBestOfEmailSentAt(
    weeklyDigestRecipients.map((u) => u.intId),
  );
  const dailyEmailsSentAt = await dbAdapter.getDailyBestOfEmailSentAt(
    dailyDigestRecipients.map((u) => u.intId),
  );

  debugLog('Starting iteration over weekly digest recipients');

  for (const u of weeklyDigestRecipients) {
    debugLog(`[${u.username}]…`);

    if (!shouldSendWeeklyBestOfDigest(weeklyEmailsSentAt[u.intId])) {
      debugLog(`[${u.username}] shouldSendWeeklyBestOfDigest() returned falsy value: SKIP`);
      continue;
    }

    debugLog(`[${u.username}] -> getSummary()`);
    const weeklySummary = await getSummary(u, 7); // eslint-disable-line no-await-in-loop

    if (!canMakeBestOfEmail(weeklySummary)) {
      debugLog(`[${u.username}] getSummary() returned 0 posts: SKIP`);
      continue;
    }

    debugLog(`[${u.username}] -> sendWeeklyBestOfEmail()`);
    await sendWeeklyBestOfEmail(u, weeklySummary, weeklyDigestDate); // eslint-disable-line no-await-in-loop

    debugLog(`[${u.username}] -> email is queued`);

    // eslint-disable-next-line no-await-in-loop
    weeklyEmailsSentAt[u.intId] = await dbAdapter.addSentEmailLogEntry(
      u.intId,
      u.email,
      'weekly_best_of',
    );

    debugLog(`[${u.username}] -> added entry to sent_emails_log`);
  }

  debugLog('Finished iterating over weekly digest recipients');

  debugLog('Starting iteration over daily digest recipients');

  for (const u of dailyDigestRecipients) {
    debugLog(`[${u.username}]…`);

    if (!shouldSendDailyBestOfDigest(dailyEmailsSentAt[u.intId], weeklyEmailsSentAt[u.intId])) {
      debugLog(`[${u.username}] shouldSendDailyBestOfDigest() returned falsy value: SKIP`);
      continue;
    }

    debugLog(`[${u.username}] -> getSummary()`);
    const dailySummary = await getSummary(u, 1); // eslint-disable-line no-await-in-loop

    if (!canMakeBestOfEmail(dailySummary)) {
      debugLog(`[${u.username}] getSummary() returned 0 posts: SKIP`);
      continue;
    }

    debugLog(`[${u.username}] -> sendDailyBestOfEmail()`);
    await sendDailyBestOfEmail(u, dailySummary, dailyDigestDate); // eslint-disable-line no-await-in-loop

    debugLog(`[${u.username}] -> email is queued`);

    await dbAdapter.addSentEmailLogEntry(u.intId, u.email, 'daily_best_of'); // eslint-disable-line no-await-in-loop
    debugLog(`[${u.username}] -> added entry to sent_emails_log`);
  }

  debugLog('Finished iterating over daily digest recipients');
}

/**
 * @typedef {Date|import('./types').ISO8601DateTimeString|null|undefined} MayBeDate
 *
 */

export function shouldSendWeeklyBestOfDigest(weeklyDigestSentAt, now) {
  const tz = currentConfig().ianaTimeZone;

  const deepPast = DateTime.fromISO('2000-01-01').setZone(tz);
  const weeklySentAtWeek = parseDateLike(weeklyDigestSentAt, deepPast).setZone(tz).startOf('week');
  const thisWeek = parseDateLike(now, DateTime.now()).setZone(tz).startOf('week');
  const thisDayOfWeek = parseDateLike(now, DateTime.now()).setZone(tz).weekday;

  return thisDayOfWeek === 1 /** Monday */ && thisWeek > weeklySentAtWeek;
}

/**
 * @param {MayBeDate} dailyDigestSentAt
 * @param {MayBeDate} weeklyDigestSentAt
 * @param {MayBeDate} now
 * @returns {boolean}
 */
export function shouldSendDailyBestOfDigest(dailyDigestSentAt, weeklyDigestSentAt, now) {
  const tz = currentConfig().ianaTimeZone;

  const deepPast = DateTime.fromISO('2000-01-01').setZone(tz);
  const dailySentAtDay = parseDateLike(dailyDigestSentAt, deepPast).setZone(tz).startOf('day');
  const weeklySentAtDay = parseDateLike(weeklyDigestSentAt, deepPast).setZone(tz).startOf('day');
  const today = parseDateLike(now, DateTime.now()).setZone(tz).startOf('day');

  return dailySentAtDay < today && weeklySentAtDay < today;
}

/**
 *
 * @param {MayBeDate} dateLike
 * @param {DateTime} defaultValue
 * @returns {DateTime}
 */
function parseDateLike(dateLike, defaultValue) {
  if (dateLike instanceof Date) {
    return DateTime.fromJSDate(dateLike);
  } else if (typeof dateLike === 'string') {
    return DateTime.fromISO(dateLike);
  }

  return defaultValue;
}

/**
 * Emulate of moment's 'MMMM Do' format
 * @param {DateTime} date
 * @returns {string}
 */
function formatDigestDate(date) {
  const month = date.toFormat('MMMM');
  const intDay = date.day;

  // @see
  const s = ['th', 'st', 'nd', 'rd'];
  const v = intDay % 100;
  const daySuffix = s[(v - 20) % 10] || s[v] || s[0];

  return `${month} ${intDay}${daySuffix}`;
}

export function canMakeBestOfEmail(summaryPayload) {
  if (!summaryPayload || !summaryPayload.posts || !summaryPayload.posts.length) {
    return false;
  }

  return true;
}

function preparePosts(payload, recipient) {
  for (const post of payload.posts) {
    post.createdBy = payload.users.find((user) => user.id === post.createdBy);
    post.recipients = post.postedTo
      .map((subscriptionId) => {
        const theSubscription =
          payload.subscriptions.find((subscription) => subscription.id === subscriptionId) || {};
        const userId = theSubscription.user;
        const subscriptionType = theSubscription.name;
        const isDirectToSelf = userId === post.createdBy.id && subscriptionType === 'Directs';
        return !isDirectToSelf ? userId : false;
      })
      .map((userId) => payload.subscribers.find((subscriber) => subscriber.id === userId))
      .filter((user) => user);

    post.attachments = _(post.attachments || [])
      .map((attachmentId) => {
        return payload.attachments.find((att) => att.id === attachmentId);
      })
      .value();

    post.usersLikedPost = _(post.likes || [])
      .map((userId) => {
        return payload.users.find((user) => user.id === userId);
      })
      .value();

    post.comments = _(post.comments || [])
      .map((commentId) => {
        const theComment = payload.comments.find((comment) => comment.id === commentId);
        theComment.createdBy = payload.users.find((user) => user.id === theComment.createdBy);
        return theComment;
      })
      .value();
  }

  payload.user = recipient;
  return payload;
}

export async function getSummary(user, days) {
  const ctx = {
    request: { query: { limit: BESTOF_DIGEST_POSTS_LIMIT } },
    state: { user, apiVersion: API_VERSION_2 },
    params: { days },
  };

  await generalSummary(ctx);

  if (!_.get(ctx, 'body.posts', []).length) {
    return ctx.body;
  }

  return preparePosts(ctx.body, user);
}
