import { JwtPayload, sign, verify } from 'jsonwebtoken';

import { currentConfig } from '../app-async-context';
import { UUID } from '../types';

import { getExpirationIntervalSec, UndoActionSubject } from './actions';

const undoTokenVersion = 1;

export const undoAudience = `freefeed:undo:v${undoTokenVersion}`;

export function createUndoToken(subject: UndoActionSubject, userId: UUID, payload: object): string {
  return sign(payload, currentConfig().secret, {
    subject,
    issuer: userId,
    audience: undoAudience,
    expiresIn: getExpirationIntervalSec(subject),
  });
}

export function verifyUndoToken(token: string, userId: UUID): JwtPayload | null {
  try {
    const result = verify(token, currentConfig().secret, {
      issuer: userId,
      audience: undoAudience,
    });

    if (!result || typeof result !== 'object') {
      return null;
    }

    return result;
  } catch {
    return null;
  }
}
