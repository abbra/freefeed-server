import moment from 'moment';
import createDebug from 'debug';

import { dbAdapter } from '../models';
import { serializeEvents } from '../serializers/v2/event';
import { sendEventsDigestEmail } from '../mailers/NotificationDigestMailer';

import { DIGEST_EVENT_TYPES } from './EventTypes';

export async function sendEmails() {
  const debugLog = createDebug('freefeed:digests:notifications');

  const users = await dbAdapter.getNotificationsDigestRecipients();
  debugLog(`getNotificationsDigestRecipients() returned ${users.length} records`);

  const emailsSentAt = await dbAdapter.getDigestSentAt(users.map((u) => u.intId));

  const promises = users.map(async (u) => {
    const digestSentAt: Date | null = emailsSentAt[u.intId] ?? null;
    const notificationsQueryDate = getUnreadEventsIntervalStart(
      digestSentAt,
      u.notificationsReadAt,
    );

    if (!notificationsQueryDate) {
      debugLog(`[${u.username}] getUnreadEventsIntervalStart() returned falsy value: SKIP`);
      return;
    }

    let digestInterval = `${notificationsQueryDate.format('MMM Do YYYY')} - ${moment().format(
      'MMM Do YYYY',
    )}`;

    if (notificationsQueryDate.isSameOrAfter(moment().subtract(1, 'days'), 'hours')) {
      digestInterval = notificationsQueryDate.format('MMM Do YYYY');
    }

    debugLog(`[${u.username}] looking for notifications since ${digestInterval}…`);

    const events = await dbAdapter.getUserEvents(
      u.intId,
      DIGEST_EVENT_TYPES,
      null,
      null,
      notificationsQueryDate.toDate(),
    );

    if (!events.length) {
      debugLog(`[${u.username}] no relevant notifications found: SKIP`);
      return;
    }

    debugLog(`[${u.username}] found ${events.length} notifications`);

    const serializedEvents = await serializeEvents(events, u.id);
    await sendEventsDigestEmail(u, serializedEvents, digestInterval);
    debugLog(`[${u.username}] email is queued: OK`);

    await dbAdapter.addSentEmailLogEntry(u.intId, u.email, 'notification');
    debugLog(`[${u.username}] added entry to sent_emails_log`);
  });

  debugLog('waiting for all promised actions to finish');
  await Promise.all(promises);
  debugLog('all promised actions are finished');
}

export function getUnreadEventsIntervalStart(
  digestSentAt: Date | null,
  notificationsLastSeenAt: Date | null,
  now?: Date,
) {
  const wrappedDigestSentAt = digestSentAt ? moment(digestSentAt) : null;
  const wrappedNotificationsLastSeenAt = notificationsLastSeenAt
    ? moment(notificationsLastSeenAt)
    : null;
  const wrappedNow = moment(now);

  const _90DaysAgo = wrappedNow.clone().subtract(90, 'days');
  const DayAgoAndHalfAnHour = wrappedNow.clone().subtract(1, 'days').add(30, 'minutes');

  if (wrappedDigestSentAt && wrappedDigestSentAt.isAfter(DayAgoAndHalfAnHour)) {
    return null;
  }

  if (
    (!wrappedDigestSentAt || wrappedDigestSentAt.isBefore(_90DaysAgo)) &&
    (!wrappedNotificationsLastSeenAt || wrappedNotificationsLastSeenAt.isBefore(_90DaysAgo))
  ) {
    return _90DaysAgo;
  }

  if (
    wrappedDigestSentAt &&
    (!wrappedNotificationsLastSeenAt || wrappedDigestSentAt.isAfter(wrappedNotificationsLastSeenAt))
  ) {
    return wrappedDigestSentAt;
  }

  return wrappedNotificationsLastSeenAt;
}
