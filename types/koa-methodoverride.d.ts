declare module 'koa-methodoverride' {
  import { type Request, type Middleware } from 'koa';

  function methodOverride(fn: (req: Request) => string): Middleware;

  export = methodOverride;
}
