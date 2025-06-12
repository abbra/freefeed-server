import { describe, it } from 'mocha';
import expect from 'unexpected';
import { v4 } from 'uuid';

import { UNDO_POST_DELETE, UndoPostDelete } from '../../../../app/support/undo/post-delete';
import { tokenAudience, verifyUndoToken } from '../../../../app/support/undo/entry';
import {
  UNDO_COMMENT_DELETE,
  UndoCommentDelete,
} from '../../../../app/support/undo/comment-delete';

describe('Undo entries', () => {
  it(`should create a '${UNDO_POST_DELETE}' undo entry`, async () => {
    const userId = v4();
    const postId = v4();
    const authorName = 'luna';

    const entry = new UndoPostDelete(postId);

    const action = entry.serialize(userId, "You deleted Luna's post", { authorName });

    expect(action, 'to satisfy', {
      subject: entry.subject,
      message: "You deleted Luna's post",
      token: expect.it('to be a string'),
      expiresInSec: UndoPostDelete.ttlSec,
      extra: { authorName },
    });

    const payload = await verifyUndoToken(action.token, userId, UNDO_POST_DELETE);
    expect(payload, 'to satisfy', {
      sub: entry.subject,
      iss: userId,
      aud: tokenAudience,
      exp: (payload?.iat ?? 0) + UndoPostDelete.ttlSec,
      postId,
    });
  });

  it(`should create a '${UNDO_COMMENT_DELETE}' undo entry`, async () => {
    const userId = v4();
    const commentId = v4();
    const authorName = 'luna';

    const entry = new UndoCommentDelete(commentId);

    const action = entry.serialize(userId, "You deleted Luna's comment", { authorName });

    expect(action, 'to satisfy', {
      subject: entry.subject,
      message: "You deleted Luna's comment",
      token: expect.it('to be a string'),
      expiresInSec: UndoPostDelete.ttlSec,
      extra: { authorName },
    });

    const payload = await verifyUndoToken(action.token, userId, UNDO_COMMENT_DELETE);
    expect(payload, 'to satisfy', {
      sub: entry.subject,
      iss: userId,
      aud: tokenAudience,
      exp: (payload?.iat ?? 0) + UndoPostDelete.ttlSec,
      commentId,
    });
  });
});
