#!/usr/bin/env babel-node
import knexLib from 'knex';
import configModule from 'config';

// Forcefully set the NODE_ENV to 'test'
const prevEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';

const config = configModule.util.loadFileConfigs();

process.env.NODE_ENV = prevEnv;

if (!config || !('postgres' in config)) {
  process.stderr.write(`Error: no "postgres" section in config file\n`);
  process.exit(1);
}

const knex = knexLib(config.postgres);

async function run() {
  await knex.raw('drop schema public cascade');
  await knex.raw('create schema public');
}

run()
  .then(() => {
    knex.destroy();
    process.exit(0);
  })
  .catch((e) => {
    process.stderr.write(`Error: ${e}\n`);
    knex.destroy();
    process.exit(1);
  });
