import config from 'config';
import _, { difference } from 'lodash';
import compose from 'koa-compose';

import { dbAdapter, PubSub as pubSub } from '../../../models';
import { EventService } from '../../../support/EventService';
import { serializeSinglePost, serializeFeed } from '../../../serializers/v2/post';
import {
  authRequired,
  inputSchemaRequired,
  monitored,
  postAccessRequired,
} from '../../middlewares';
import { ForbiddenException } from '../../../support/exceptions';

import {
  getPostsByIdsInputSchema,
  notifyOfAllCommentsInputSchema,
  pinPostInputSchema,
  unpinPostInputSchema,
} from './data-schemes/posts';
import { getCommonParams } from './TimelinesController';

export const show = compose([
  postAccessRequired(true),
  monitored('posts.show-v2'),
  async (ctx) => {
    const { user: viewer, post, apiVersion } = ctx.state;

    const foldComments = ctx.request.query.maxComments !== 'all';
    const foldLikes = ctx.request.query.maxLikes !== 'all';

    ctx.body = await serializeSinglePost(post.id, viewer && viewer.id, {
      foldComments,
      foldLikes,
      apiVersion,
    });
  },
]);

export const opengraph = compose([
  monitored('posts.opengraph-v2'),
  async (ctx) => {
    let { postId } = ctx.params;

    if (postId && postId.length < 36) {
      postId = (await dbAdapter.getPostLongId(postId)) ?? postId;
    }

    const post = await dbAdapter.getPostById(postId);

    // OpenGraph is available for public posts that are not protected
    if (!post || post.isProtected === '1' || (await post.isDeleting())) {
      ctx.body = '';
      return;
    }

    let image = null;
    let image_h, image_w;

    // The first image attachment is used
    const attachments = await dbAdapter.getAttachmentsOfPost(post.id);

    if (attachments.length > 0) {
      for (const item of attachments) {
        if (item.previews.image) {
          // Image fallback: thumbnail 2 (t2) => thumbnail (t) => original (o) => none
          // Posts created in older versions of FreeFeed had only one thumbnail (t)
          let variant = null;

          if ('thumbnails2' in item.previews.image) {
            variant = 'thumbnails2';
          } else if ('thumbnails' in item.previews.image) {
            variant = 'thumbnails';
          } else {
            // Looking for maximum size
            variant = item.maxSizedVariant('image');
          }

          if (!variant) {
            continue;
          }

          const p = item.previews.image[variant];
          image = item.getFileUrl(variant);
          image_h = p.h;
          image_w = p.w;
          break;
        }
      }
    }

    const body = _.escape(post.body);

    const author = await post.getCreatedBy();
    let og = `<meta property="og:title" content="${author.username} at ${config.siteTitle}" />
      <meta property="og:description" content="${body}" />
      <meta property="og:type" content="article" />`;

    if (image) {
      og += `
        <meta property="og:image" content="${image}" />
        <meta property="og:image:width" content="${image_w}" />
        <meta property="og:image:height" content="${image_h}" />`;
    }

    ctx.body = og;
  },
]);

const maxPostsByIds = 100;

export const getByIds = compose([
  inputSchemaRequired(getPostsByIdsInputSchema),
  monitored('posts.by-ids'),
  async (ctx) => {
    const { user: viewer, apiVersion } = ctx.state;
    const { postIds } = ctx.request.body;

    const hasMore = postIds.length > maxPostsByIds;

    if (hasMore) {
      postIds.length = maxPostsByIds;
    }

    const foldComments = ctx.request.query.maxComments !== 'all';
    const foldLikes = ctx.request.query.maxLikes !== 'all';

    const visiblePostIds = await dbAdapter.selectPostsVisibleByUser(postIds, viewer?.id);

    ctx.body = await serializeFeed(visiblePostIds, viewer?.id, null, {
      foldComments,
      foldLikes,
      apiVersion,
    });
    const postsFound = ctx.body.posts.map((p) => p.id);
    const postsNotFound = difference(postIds, postsFound);
    ctx.body.postsNotFound = postsNotFound;
    delete ctx.body.isLastPage;
    delete ctx.body.timelines;
  },
]);

export const leave = compose([
  authRequired(),
  postAccessRequired(),
  async (ctx) => {
    const { user, post } = ctx.state;

    const ok = await post.removeDirectRecipient(user);

    if (!ok) {
      throw new ForbiddenException('You can not leave this post');
    }

    ctx.body = {};
  },
]);

/**
 * Returns feed of posts that reference the given post
 */
export const getReferringPosts = compose([
  monitored('posts.referring'),
  postAccessRequired(true),
  async (ctx) => {
    const { post, user, apiVersion } = ctx.state;

    const params = getCommonParams(ctx);
    params.limit++;

    const foundPostsIds = await dbAdapter.getReferringPosts(post.id, user?.id, params);
    const isLastPage = foundPostsIds.length <= params.limit - 1;

    if (!isLastPage) {
      foundPostsIds.length = params.limit - 1;
    }

    ctx.body = await serializeFeed(foundPostsIds, user?.id, null, { isLastPage, apiVersion });
  },
]);

export const notifyOfAllComments = compose([
  monitored('posts.notifyOfAllComments'),
  postAccessRequired(),
  inputSchemaRequired(notifyOfAllCommentsInputSchema),
  async (ctx) => {
    const { post, user, apiVersion } = ctx.state;
    const { enabled } = ctx.request.body;

    await user.notifyOfAllCommentsOfPost(post, enabled);
    ctx.body = await serializeSinglePost(post.id, user.id, { apiVersion });
  },
]);

export const pin = compose([
  authRequired(),
  postAccessRequired(),
  inputSchemaRequired(pinPostInputSchema),
  async (ctx) => {
    const { user, post, apiVersion } = ctx.state;
    const { owner } = ctx.request.body || {};
    // Determine ownerId: default to author
    const ownerId = owner || post.userId;

    if (ownerId === post.userId) {
      if (post.userId !== user.id) {
        throw new ForbiddenException('You can not pin this post');
      }
    } else {
      const ownerAccount = await dbAdapter.getFeedOwnerById(ownerId);

      if (!ownerAccount || !ownerAccount.isGroup()) {
        throw new ForbiddenException('Only groups supported as non-author owners');
      }

      const isAdmin = await dbAdapter.isUserAdminOfGroup(user.id, ownerId);

      if (!isAdmin) {
        throw new ForbiddenException('You are not admin of this group');
      }
      // Check post present in this group

      const present = await dbAdapter.isPostInUserFeed(post.id, ownerId, 'Posts');

      if (!present) {
        throw new ForbiddenException('Post is not in this group');
      }
    }

    // Determine Posts feed UUID of the owner
    const ownerAccount = await dbAdapter.getFeedOwnerById(ownerId);
    const ownerFeed = await ownerAccount.getPostsTimeline();
    await dbAdapter.pinUserPost(ownerFeed.id, post.id, user.id);

    if (ownerId !== post.userId) {
      const group = await dbAdapter.getFeedOwnerById(ownerId);
      await EventService.onPostPinnedInGroup(user, group, post);
    } else {
      await EventService.onPostPinnedInProfile(user, post);
    }

    await pubSub.updatePost(post.id);
    ctx.body = await serializeSinglePost(post.id, user.id, { apiVersion });
  },
]);

export const unpin = compose([
  authRequired(),
  postAccessRequired(),
  inputSchemaRequired(unpinPostInputSchema),
  async (ctx) => {
    const { user, post, apiVersion } = ctx.state;
    const { owner } = ctx.request.body || {};
    const ownerId = owner || post.userId;

    if (ownerId === post.userId) {
      if (post.userId !== user.id) {
        throw new ForbiddenException('You can not unpin this post');
      }
    } else {
      const ownerAccount = await dbAdapter.getFeedOwnerById(ownerId);

      if (!ownerAccount || !ownerAccount.isGroup()) {
        throw new ForbiddenException('Only groups supported as non-author owners');
      }

      if (!(await dbAdapter.isUserAdminOfGroup(user.id, ownerId))) {
        throw new ForbiddenException('You are not admin of this group');
      }
    }

    const ownerAccount = await dbAdapter.getFeedOwnerById(ownerId);
    const ownerFeed = await ownerAccount.getPostsTimeline();
    await dbAdapter.unpinUserPost(ownerFeed.id, post.id);

    if (ownerId !== post.userId) {
      const group = await dbAdapter.getFeedOwnerById(ownerId);
      await EventService.onPostUnpinnedInGroup(user, group, post);
    } else {
      await EventService.onPostUnpinnedInProfile(user, post);
    }

    await pubSub.updatePost(post.id);
    ctx.body = await serializeSinglePost(post.id, user.id, { apiVersion });
  },
]);
