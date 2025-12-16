import config from 'config';

import { JobManager, dbAdapter } from '../../models';

import { definePeriodicJob } from '.';

export const PERIODIC_REFRESH_HASHTAG_STATS = 'PERIODIC_REFRESH_HASHTAG_STATS';

export function initHandlers(jobManager: JobManager) {
  return definePeriodicJob(jobManager, {
    name: PERIODIC_REFRESH_HASHTAG_STATS,
    handler: () => dbAdapter.refreshHashtagStats(),
    nextTime: config.hashtagStats.refreshInterval,
    payload: {},
  });
}
