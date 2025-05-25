import compose from 'koa-compose';
import { z } from 'zod';

import { authRequired, inputSchemaRequired, monitored } from '../../middlewares';
import { Ctx } from '../../../support/types';
import { dbAdapter, User } from '../../../models';
import { verifyUndoToken } from '../../../support/undo/token';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '../../../support/exceptions';
import { UNDO_POST_DELETE } from '../../../support/undo/actions';

const undoInputSchema = z.object({ token: z.string().jwt() });
type UndoInput = z.infer<typeof undoInputSchema>;

export const undo = compose([
  authRequired(),
  inputSchemaRequired(undoInputSchema),
  monitored((ctx) => `undo:${ctx.params.subject}`),
  async (ctx: Ctx<{ user: User }>) => {
    const { user } = ctx.state;
    const { token } = ctx.request.body as UndoInput;
    const { subject } = ctx.params as { subject: string };

    const data = verifyUndoToken(token, user.id);

    if (!data || data.sub !== subject) {
      throw new ForbiddenException('Invalid or expired undo token');
    }

    ctx.body = {};

    if (subject === UNDO_POST_DELETE) {
      const post = await dbAdapter.getPostById(data.postId);

      if (!post) {
        throw new NotFoundException('Post not found');
      }

      await post.activate(user);
      ctx.body = { postId: post.id };
    } else {
      throw new BadRequestException(`Unknown undo subject: ${subject}`);
    }
  },
]);
