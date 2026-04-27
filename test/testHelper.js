import { should } from 'chai';
import config from 'config';
import { mkdirp } from 'mkdirp';

import redisDb from '../app/setup/database';
import * as postgresDb from '../app/setup/postgres';

global.$database = redisDb; // used by realtime-tests

global.$should = should();
global.$postgres = postgresDb;

global.$pg_database = global.$postgres.connect();

// Show stack not only for errors, but also for warnings
process.on('warning', (e) => console.warn(e.stack));

export const mochaHooks = {
  async beforeAll() {
    const mediaDirs = [config.attachments, config.profilePictures]
      .filter((mediaConfig) => mediaConfig.storage.type === 'fs')
      .map((mediaConfig) => mkdirp(mediaConfig.storage.rootDir + mediaConfig.path));

    await Promise.all(mediaDirs);
  },
};
