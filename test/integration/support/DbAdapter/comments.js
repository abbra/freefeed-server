/* global $pg_database */
import unexpected from 'unexpected';

import { dbAdapter, User, Post } from '../../../../app/models';
import cleanDB from '../../../dbCleaner';

const expect = unexpected.clone();

describe('Comments DB trait', () => {
  let luna, mars;
  let lunaPost, marsPost;
  let lunaComment;
  let lunaPostShortId, marsPostShortId;
  let lunaCommentShortId;

  before(async () => {
    await cleanDB($pg_database);

    luna = new User({ username: 'luna', password: 'pw' });
    mars = new User({ username: 'mars', password: 'pw' });
    await Promise.all([luna.create(), mars.create()]);

    const lunaFeed = await luna.getPostsTimeline();
    const marsFeed = await mars.getPostsTimeline();

    lunaPost = new Post({
      body: 'Luna post',
      userId: luna.id,
      timelineIds: [lunaFeed.id],
    });
    await lunaPost.create();

    marsPost = new Post({
      body: 'Mars post',
      userId: mars.id,
      timelineIds: [marsFeed.id],
    });
    await marsPost.create();

    // Create a comment on Luna's post
    lunaComment = luna.newComment({ postId: lunaPost.id, body: 'Luna comment' });
    await lunaComment.create();

    // Get short IDs
    lunaPostShortId = await dbAdapter.getPostShortId(lunaPost.id);
    marsPostShortId = await dbAdapter.getPostShortId(marsPost.id);
    lunaCommentShortId = lunaComment.shortId;
  });

  describe('getCommentByShortId', () => {
    it('should return comment by valid post short id and comment short id', async () => {
      const comment = await dbAdapter.getCommentByShortId(lunaPostShortId, lunaCommentShortId);
      expect(comment, 'not to be null');
      expect(comment.id, 'to be', lunaComment.id);
      expect(comment.postId, 'to be', lunaPost.id);
    });

    it('should return null for non-existent comment short id', async () => {
      const comment = await dbAdapter.getCommentByShortId(lunaPostShortId, 'ffff');
      expect(comment, 'to be null');
    });

    it('should return null for non-existent post short id', async () => {
      const comment = await dbAdapter.getCommentByShortId('ffffff', lunaCommentShortId);
      expect(comment, 'to be null');
    });

    it('should return null when comment belongs to different post', async () => {
      // Try to find Luna's comment in Mars's post
      const comment = await dbAdapter.getCommentByShortId(marsPostShortId, lunaCommentShortId);
      expect(comment, 'to be null');
    });
  });
});
