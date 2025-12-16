/* eslint-disable no-await-in-loop */
import { promises as fs } from 'fs';
import path from 'path';
import { setTimeout } from 'timers/promises';

import { program } from 'commander';

import { dbAdapter, postgres } from '../app/models';
import { extractHashtags } from '../app/support/hashtags';

// Reindex hashtags from posts and comments.
// Usage: yarn babel bin/reindex_hashtags1.js --help

const allTables = ['posts', 'comments'];
const ZERO_UID = '00000000-00000000-00000000-00000000';
const statusFile = path.join(__dirname, '../tmp/reindex_hashtags.json');

program
  .option('--batch-size <batch size>', 'batch size', (v) => parseInt(v, 10), 500)
  .option('--delay <delay>', 'delay between batches, milliseconds', (v) => parseInt(v, 10), 100)
  .option('--restart', 'start from the beginning and clear existing hashtags');
program.parse(process.argv);

const [batchSize, delayMsec, restart] = [
  program.getOptionValue('batchSize'),
  program.getOptionValue('delay'),
  program.getOptionValue('restart'),
];

if (!isFinite(batchSize) || !isFinite(delayMsec)) {
  process.stderr.write(`⛔ Invalid program option\n`);
  program.help();
}

process.stdout.write(`Running with batch size of ${batchSize} and delay of ${delayMsec}\n`);
process.stdout.write(`Status file: ${statusFile}\n`);
process.stdout.write(`\n`);

(async () => {
  try {
    let lastUID = ZERO_UID;
    let [table] = allTables;

    let shouldClean = restart;

    if (!restart) {
      try {
        const statusText = await fs.readFile(statusFile, { encoding: 'utf8' });
        ({ lastUID, table } = JSON.parse(statusText));
        process.stdout.write(`Resuming from ${table} at ${lastUID}...\n`);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw new Error(`Cannot read status from ${statusFile}: ${err.message}`);
        }

        process.stdout.write(`Status file is not found, starting from the beginning...\n`);
        shouldClean = true;
      }
    }

    if (shouldClean) {
      process.stdout.write(`Cleaning hashtag tables...\n`);
      await postgres.raw('truncate hashtag_usages, hashtags restart identity');
      process.stdout.write(`Tables cleaned.\n`);
    }

    if (!allTables.includes(table)) {
      throw new Error(`Unknown table name '${table}'`);
    }

    while (table) {
      process.stdout.write(`Processing ${table} starting from ${lastUID}...\n`);
      let processed = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const start = Date.now();

        const rows = await postgres(table)
          .select('uid', 'body')
          .where('uid', '>', lastUID)
          .orderBy('uid')
          .limit(batchSize);

        if (rows.length === 0) {
          break;
        }

        for (const row of rows) {
          const hashtags = extractHashtags(row.body);

          if (hashtags.length > 0) {
            if (table === 'posts') {
              await dbAdapter.linkPostHashtagsByNames(hashtags, row.uid);
            } else {
              await dbAdapter.linkCommentHashtagsByNames(hashtags, row.uid);
            }
          }
        }

        lastUID = rows[rows.length - 1].uid;
        processed += rows.length;

        const percent = (parseInt(lastUID.slice(0, 2), 16) * 100) >> 8;
        const speed = Math.round((batchSize * 1000) / (Date.now() - start));

        process.stdout.write(
          `\tprocessed ${processed} ${table} at ${speed} records/sec (${percent}% of total)\n`,
        );

        await saveStatus(lastUID, table);
        await setTimeout(delayMsec);
      }

      process.stdout.write(`Done with ${table}.\n`);

      table = allTables[allTables.indexOf(table) + 1];
      lastUID = ZERO_UID;
    }

    process.stdout.write(`All tables were processed.\n`);

    process.stdout.write(`Refreshing hashtag stats...\n`);
    await dbAdapter.refreshHashtagStats();
    process.stdout.write(`Hashtag stats refreshed.\n`);

    await fs.unlink(statusFile);

    process.exit(0);
  } catch (e) {
    process.stderr.write(`⛔ ERROR: ${e.message}\n`);
    process.exit(1);
  }
})();

async function saveStatus(lastUID, table) {
  await fs.mkdir(path.dirname(statusFile), { recursive: true });
  await fs.writeFile(statusFile, JSON.stringify({ lastUID, table }));
}
