import compose from 'koa-compose';
import { uniqBy } from 'lodash-es';

import { dbAdapter } from '../../../models';
import { serializeFeed } from '../../../serializers/v2/post';
import { authRequired, monitored } from '../../middlewares';
import { serializeUsersByIds } from '../../../serializers/v2/user';

import { ORD_CREATED, ORD_UPDATED } from './TimelinesController';

export default class SearchController {
  search = compose([
    monitored('search'),
    authRequired(),
    async (ctx) => {
      const DEFAULT_LIMIT = 30;
      const MAX_LIMIT = 120;

      const { user, apiVersion } = ctx.state;
      const viewerId = user?.id ?? null;
      const query = (ctx.request.query.qs || '').trim();
      let offset = parseInt(ctx.request.query.offset, 10);
      let limit = parseInt(ctx.request.query.limit, 10);
      const sort =
        ctx.request.query.sort === ORD_CREATED || ctx.request.query.sort === ORD_UPDATED
          ? ctx.request.query.sort
          : ORD_UPDATED;

      if (!Number.isFinite(offset) || offset < 0) {
        offset = 0;
      }

      if (!Number.isFinite(limit) || limit < 0 || limit > MAX_LIMIT) {
        limit = DEFAULT_LIMIT;
      }

      const [postIds, accountIds] = query
        ? await Promise.all([
            // Search posts and comments
            dbAdapter.search(query, {
              viewerId,
              limit: limit + 1,
              offset,
              sort,
            }),
            // Search accounts
            dbAdapter.searchInAccounts(query, { viewerId }),
          ])
        : [[], []];

      const isLastPage = postIds.length <= limit;

      if (!isLastPage) {
        postIds.length = limit;
      }

      const [serFeed, serUsers] = await Promise.all([
        serializeFeed(postIds, viewerId, null, {
          isLastPage,
          apiVersion,
        }),
        serializeUsersByIds(accountIds, viewerId),
      ]);

      ctx.body = {
        ...serFeed,
        foundUsers: accountIds,
        // We need to merge `users` with the `result.users`
        users: uniqBy([...serFeed.users, ...serUsers], 'id'),
      };
    },
  ]);
}
