import { readFile } from 'fs/promises';

import createDebug from 'debug';
import { loadAll } from 'js-yaml';
import { z } from 'zod';
import { DateTime, Duration } from 'luxon';
import { fromError, isZodErrorLike } from 'zod-validation-error';

import { dbAdapter, User, Job, Post, Comment, JobManager } from '../models';

import { currentConfig } from './app-async-context';
import { UUID } from './types';
import { isNoEntryError } from './is-no-entry';

export const WELCOME_DIRECT = 'WELCOME_DIRECT';

export function initHandlers(jobManager: JobManager) {
  jobManager.on(WELCOME_DIRECT, jobHandler);
}

const debugLog = createDebug('freefeed:welcomeDirects');
const errorLog = debugLog.extend('errors');

export type JobPayload = {
  id: string;
  senderId: UUID;
  userId: UUID;
  body: string;
  comment?: string;
  criterion?: { type: string };
};

const entrySchema = z
  .object({
    id: z.string(),
    delay: z.string().duration().default('PT0S'),
    skipDays: z.number().int().positive().optional(),
    criterion: z
      .object({
        type: z.string(),
        // ...some other arguments
      })
      .optional(),
    body: z.string(),
    comment: z.string().optional(),
  })
  .strict();

type EntrySchema = z.infer<typeof entrySchema>;

export async function scheduleWelcomeDirects(user: User): Promise<boolean> {
  const { senderAccount, scheduleFile } = currentConfig().welcomeDirects;

  if (!scheduleFile) {
    // No schedule file is configured, so nothing to do
    return false;
  }

  const sender = await dbAdapter.getUserByUsername(senderAccount);

  if (!sender) {
    errorLog(`User "${senderAccount}" does not exist`);
    throw new Error(`User "${senderAccount}" does not exist`);
  }

  let entries: EntrySchema[];

  try {
    const yamlData = await readFile(scheduleFile, 'utf-8');
    entries = z.array(entrySchema).parse(loadAll(yamlData));
  } catch (err) {
    if (isNoEntryError(err)) {
      errorLog(`The schedule file is not found: ${scheduleFile}`);
      return false;
    }

    if (isZodErrorLike(err)) {
      errorLog(`The schedule file has invalid format: ${fromError(err).toString()}`);
      return false;
    }

    throw err;
  }

  await Promise.all(entries.map((entry) => scheduleEntry(user, sender, entry)));

  return true;
}

async function scheduleEntry(user: User, sender: User, entry: EntrySchema) {
  const tz = currentConfig().ianaTimeZone;
  let time = DateTime.fromJSDate(user.firstInteractionAt ?? new Date()).setZone(tz);

  if (entry.skipDays) {
    time = time.plus({ days: entry.skipDays }).startOf('day');
  }

  time = time.plus(Duration.fromISO(entry.delay));

  await Job.create<JobPayload>(
    WELCOME_DIRECT,
    {
      senderId: sender.id,
      userId: user.id,
      id: entry.id,
      body: entry.body,
      comment: entry.comment,
      criterion: entry.criterion,
    },
    { unlockAt: time.toJSDate(), uniqKey: `${user.id}:${entry.id}` },
  );
}

export async function jobHandler(job: Job<JobPayload>) {
  const { senderId, userId, id, body, comment, criterion } = job.payload;
  const [sender, user] = await Promise.all([
    dbAdapter.getUserById(senderId),
    dbAdapter.getUserById(userId),
  ]);

  if (!sender) {
    errorLog(`Sender ${senderId} does not exist`);
    return;
  }

  if (!user) {
    errorLog(`User ${userId} does not exist`);
    return;
  }

  const logPrefix = `${id} (${sender.username} -> ${user.username}): `;

  // Check criterion
  if (!criterion) {
    // No criterion, just send the message
  } else if (criterion.type === 'noPosts') {
    const postsCount = await dbAdapter.getUserPostsCount(user.id);

    if (postsCount > 0) {
      debugLog(`${logPrefix}User has ${postsCount} posts, skipping`);
      return;
    }
  } else if (criterion.type === 'noSubscriptions') {
    const friends = await user.getFriends();
    const ignoreList =
      'ignore' in criterion && Array.isArray(criterion.ignore) ? criterion.ignore : [];
    const maxSubscriptions =
      'maxSubscriptions' in criterion && typeof criterion.maxSubscriptions === 'number'
        ? criterion.maxSubscriptions
        : 0;
    const friendsCount = friends.filter((f) => !ignoreList.includes(f.username)).length;

    if (friendsCount > maxSubscriptions) {
      debugLog(`${logPrefix}User has ${friendsCount} friends, skipping`);
      return;
    }
  } else {
    debugLog(`${logPrefix}Unknown criterion type ${criterion.type}, skipping`);
    return;
  }

  // Send message and comment (if any)
  debugLog(`${logPrefix}Sending message`);
  const [userDirectsId, senderDirectsId] = await Promise.all([
    user.getDirectsTimelineId(),
    sender.getDirectsTimelineId(),
  ]);

  if (!userDirectsId || !senderDirectsId) {
    errorLog(`${logPrefix}User or sender has no direct timeline, skipping`);
    return;
  }

  const post = new Post({
    userId: sender.id,
    body,
    commentsDisabled: '1',
    timelineIds: [userDirectsId, senderDirectsId],
  });
  await post.create();
  debugLog(`${logPrefix}Message sent`);

  if (comment) {
    debugLog(`${logPrefix}Adding comment`);
    const newComment = new Comment({
      body: comment,
      postId: post.id,
      userId: sender.id,
    });
    await newComment.create();
    debugLog(`${logPrefix}Comment added`);
  }
}
