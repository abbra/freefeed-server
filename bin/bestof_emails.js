#!/usr/bin/env babel-node
import createDebug from 'debug';

import { sendBestOfEmails } from '../app/support/BestOfDigest';

const errorLog = createDebug('freefeed:errors');

sendBestOfEmails()
  .then(() => {
    process.stdout.write('Finished\n');
    process.exit(0);
  })
  .catch((e) => {
    errorLog(e);
    process.stderr.write(`Error: ${e.message}\n`);
    process.stderr.write(`${e.stack}\n`);
    process.exit(1);
  });
