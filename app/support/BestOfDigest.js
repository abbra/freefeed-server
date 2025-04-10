import moment from 'moment';
import createDebug from 'debug';
import _ from 'lodash';

import { dbAdapter } from '../models';
import { sendDailyBestOfEmail, sendWeeklyBestOfEmail } from '../mailers/BestOfDigestMailer';
import { generalSummary } from '../controllers/api/v2/SummaryController.js';
import { API_VERSION_2 } from '../api-versions';

const BESTOF_DIGEST_POSTS_LIMIT = 15;

export async function sendBestOfEmails() {
  const debugLog = createDebug('freefeed:digests:bestOf');

  const weeklyDigestRecipients = (await dbAdapter.getWeeklyBestOfDigestRecipients()).filter(
    (u) => u.isActive,
  );
  debugLog(`getWeeklyBestOfDigestRecipients returned ${weeklyDigestRecipients.length} records`);

  const dailyDigestRecipients = (await dbAdapter.getDailyBestOfDigestRecipients()).filter(
    (u) => u.isActive,
  );
  debugLog(`getDailyBestOfDigestRecipients returned ${dailyDigestRecipients.length} records`);

  const dailyDigestDate = moment().format('MMMM Do');
  const weeklyDigestDate = moment().subtract(7, 'days').format('MMMM Do');
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

    await dbAdapter.addSentEmailLogEntry(u.intId, u.email, 'weekly_best_of'); // eslint-disable-line no-await-in-loop
    weeklyEmailsSentAt[u.intId] = moment();

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

export function shouldSendWeeklyBestOfDigest(weeklyDigestSentAt, now) {
  const weeklyEmailDay = 'Monday';
  const wrappedWeeklyDigestSentAt = moment(weeklyDigestSentAt || 0);
  const wrappedNow = moment(now);

  if (wrappedNow.day() !== moment().day(weeklyEmailDay).day()) {
    return false;
  }

  const weekAgo = wrappedNow.clone().subtract(1, 'week').add(30, 'minutes');

  return wrappedWeeklyDigestSentAt.isBefore(weekAgo);
}

export function shouldSendDailyBestOfDigest(dailyDigestSentAt, weeklyDigestSentAt, now) {
  const wrappedWeeklyDigestSentAt = moment(weeklyDigestSentAt || 0);
  const wrappedDailyDigestSentAt = moment(dailyDigestSentAt || 0);
  const wrappedNow = moment(now);
  const dayAgo = wrappedNow.clone().subtract(1, 'days').add(30, 'minutes');

  return wrappedDailyDigestSentAt.isBefore(dayAgo) && wrappedWeeklyDigestSentAt.isBefore(dayAgo);
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
