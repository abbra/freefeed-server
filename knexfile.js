import configModule from 'config';

let env = process.env.NODE_ENV || 'development';

{
  // Knex can read environment from the '--env' option
  const args = process.argv.slice(2);
  const p = args.indexOf('--env');

  if (p >= 0 && p < args.length - 1) {
    env = args[p + 1];
  }
}

const prevEnv = process.env.NODE_ENV;
process.env.NODE_ENV = env;
const knexConfig = { [env]: configModule.util.loadFileConfigs().postgres };
process.env.NODE_ENV = prevEnv;

export default knexConfig;
