#!/usr/bin/env babel-node
import createDebug from 'debug';

import { sendEmails } from '../app/support/NotificationsDigest';

process.stdout.write('The "Notifications Digest" is sending in app process now\n');
process.exit(0);

// TODO: remove this file

const errorLog = createDebug('freefeed:errors');

sendEmails()
  .then(() => {
    process.stdout.write('Finished\n');
    process.exit(0);
  })
  .catch((e) => {
    errorLog(e);
    process.stderr.write(`Error: ${e}\n`);
    process.exit(1);
  });
