declare module 'unexpected-moment' {
  import Expect from 'unexpected';

  interface Plugin {
    name: string;
    installInto(expect: typeof Expect): void;
  }
  const unexpectedMoment: Plugin;
  export = unexpectedMoment;
}
