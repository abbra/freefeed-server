import compose from 'koa-compose';

import { dbAdapter } from '../../../models';
import { authRequired } from '../../middlewares';

export default class HashtagsController {
  static sparseMatches = compose([
    authRequired(),
    async (ctx) => {
      const { user } = ctx.state;
      const qs = ctx.request.query.qs ?? '';

      const hashtags = await dbAdapter.sparseMatchesHashtags(qs, user.id);

      ctx.body = { hashtags };
    },
  ]);
}
