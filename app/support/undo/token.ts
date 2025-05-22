import { JwtPayload, sign, verify } from 'jsonwebtoken';

import { currentConfig } from '../app-async-context';
import { UUID } from '../types';

import { getExpirationIntervalSec, UndoActionSubject } from './actions';

export function createUndoToken(subject: UndoActionSubject, userId: UUID, payload: object): string {
  return sign(payload, currentConfig().secret, {
    subject: `undo:${subject}`,
    issuer: userId,
    expiresIn: getExpirationIntervalSec(subject),
  });
}

export function verifyUndoToken(token: string, userId: UUID): JwtPayload | null {
  try {
    const result = verify(token, currentConfig().secret, { issuer: userId });

    if (!result || typeof result !== 'object') {
      return null;
    }

    if (!result.sub?.startsWith('undo:')) {
      // Not an undo token
      return null;
    }

    return result;
  } catch {
    return null;
  }
}
