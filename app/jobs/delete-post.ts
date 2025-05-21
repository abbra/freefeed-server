import { Duration } from 'luxon';

import { dbAdapter, Job, JobManager } from '../models';
import { currentConfig } from '../support/app-async-context';
import { UUID } from '../support/types';

export const DELETE_POST = 'DELETE_POST';

export async function schedulePostDeletion(postId: UUID) {
  const { undoIntervals } = currentConfig();
  const interval = undoIntervals[DELETE_POST] || undoIntervals.default;
  await Job.create(
    DELETE_POST,
    { postId },
    {
      uniqKey: postId,
      unlockAt: Duration.fromISO(interval).as('seconds'),
    },
  );
}

export function initHandlers(jobManager: JobManager) {
  jobManager.on(DELETE_POST, async (job: Job<{ postId: UUID }>) => {
    const post = await dbAdapter.getPostById(job.payload.postId);

    if (!post || !post.toDelete) {
      return;
    }

    await post.destroy();
  });
}
