/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'unexpected' {
  type Expect = {
    (subj: any, assertion: string, ...args: any[]): Promise<void>;
    it(assertion: string, ...args: any[]): Promise<void>;
    clone(): Expect;
    use(x: Plugin): Expect;
  };

  type Plugin = {
    name: string;
    installInto(expect: Expect): void;
  };

  const expect: Expect;
  export = expect;
}

declare module 'unexpected-date' {
  import Expect from 'unexpected';

  type Plugin = {
    name: string;
    installInto(expect: typeof Expect): void;
  };
  const unexpectedDate: Plugin;
  export = unexpectedDate;
}
