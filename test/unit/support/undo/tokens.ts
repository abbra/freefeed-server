import { describe, it } from 'mocha';
import expect from 'unexpected';

import { createUndoToken, undoAudience, verifyUndoToken } from '../../../../app/support/undo/token';
import {
  getExpirationIntervalSec,
  UNDO_POST_DELETE,
  undoPostDelete,
} from '../../../../app/support/undo/actions';

describe('Undo tokens', () => {
  it(`should create and verify a '${UNDO_POST_DELETE}' token`, () => {
    const token = createUndoToken(UNDO_POST_DELETE, 'userId', { postId: 'postId' });
    expect(token, 'to be a string');

    const payload = verifyUndoToken(token, 'userId');
    expect(payload, 'to satisfy', {
      sub: UNDO_POST_DELETE,
      iss: 'userId',
      aud: undoAudience,
      exp: (payload?.iat ?? 0) + getExpirationIntervalSec(UNDO_POST_DELETE),
      postId: 'postId',
    });
  });

  it(`should create a '${UNDO_POST_DELETE}' undo action`, () => {
    const action = undoPostDelete('userId', 'postId', "You deleted Luna's post", {
      author: 'luna',
    });
    expect(action, 'to satisfy', {
      subject: UNDO_POST_DELETE,
      message: "You deleted Luna's post",
      token: expect.it('to be a string'),
      expiresInSec: getExpirationIntervalSec(UNDO_POST_DELETE),
      extra: { author: 'luna' },
    });

    const payload = verifyUndoToken(action.token, 'userId');
    expect(payload, 'to satisfy', {
      sub: UNDO_POST_DELETE,
      iss: 'userId',
      aud: undoAudience,
      exp: (payload?.iat ?? 0) + getExpirationIntervalSec(UNDO_POST_DELETE),
      postId: 'postId',
    });
  });
});
