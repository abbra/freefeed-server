import { Duration } from 'luxon';

import { currentConfig } from '../app-async-context';
import { UUID } from '../types';

import { createUndoToken } from './token';

export const UNDO_POST_DELETE = 'postDelete';

export type UndoActionSubject = typeof UNDO_POST_DELETE;

export type UndoAction<T extends UndoActionSubject> = {
  subject: T;
  message: string;
  extra?: object;
  token: string;
  expiresInSec: number;
};

export function undoPostDelete(
  userId: UUID,
  postId: UUID,
  message: string,
  extra?: object,
): UndoAction<typeof UNDO_POST_DELETE> {
  return {
    subject: UNDO_POST_DELETE,
    message,
    extra,
    token: createUndoToken(UNDO_POST_DELETE, userId, { postId }),
    expiresInSec: getExpirationIntervalSec(UNDO_POST_DELETE),
  };
}

export function getExpirationIntervalSec(subject: UndoActionSubject): number {
  const { undoIntervals } = currentConfig();
  return Duration.fromISO(undoIntervals[subject] ?? undoIntervals.default).as('seconds');
}
