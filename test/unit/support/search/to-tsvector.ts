import expect from 'unexpected';
import config from 'config';

import { toTSVector, toSuffixTSVector } from '../../../../app/support/search/to-tsvector';

const ftsCfg = config.postgres.textSearchConfigName;

describe('toTSVector', () => {
  it('should return empty vector of empty string', () => {
    expect(toTSVector(''), 'to be', `''::tsvector`);
  });

  it('should return empty vector of string of unsupported characters', () => {
    expect(toTSVector('\u0652'), 'to be', `''::tsvector`);
  });

  it('should return vector of regular text', () => {
    const string = 'the quick brown fox jumped over the lazy dog';
    expect(toTSVector(string), 'to be', `to_tsvector_with_exact('${ftsCfg}', '${string}')`);
  });

  it('should return vector of text with mentions and hashtags', () => {
    const string = 'the quick brown @fox-jump #lazy-dog';
    expect(
      toTSVector(string),
      'to be',
      `(` +
        `to_tsvector_with_exact('${ftsCfg}', 'the quick brown') || ` +
        `(` +
        `to_tsvector_with_exact('${ftsCfg}', 'fox jump')::text || ' ' || ` +
        `'''@fox-jump'':1'` +
        `)::tsvector || ` +
        `(` +
        `to_tsvector_with_exact('${ftsCfg}', 'lazy dog')::text || ' ' || ` +
        `'''#lazydog'':1'` +
        `)::tsvector` +
        `)`,
    );
  });

  it('should return vector of text with links', () => {
    const string = 'the quick brown www.foxnews.com';
    expect(
      toTSVector(string),
      'to be',
      `(` +
        `to_tsvector_with_exact('${ftsCfg}', 'the quick brown') || ` +
        `to_tsvector_with_exact('${ftsCfg}', 'foxnews com')` +
        `)`,
    );
  });

  it('should return vector of text with SPOILERS', () => {
    const string = 'the quick <spoiler>brown</spoiler> fox';
    expect(
      toTSVector(string),
      'to be',
      `(` +
        `to_tsvector_with_exact('${ftsCfg}', 'the quick') || ` +
        `to_tsvector_with_exact('${ftsCfg}', 'spoiler') || ` +
        `to_tsvector_with_exact('${ftsCfg}', 'brown') || ` +
        `to_tsvector_with_exact('${ftsCfg}', 'spoiler') || ` +
        `to_tsvector_with_exact('${ftsCfg}', 'fox')` +
        `)`,
    );
  });

  it('should return vector of text with UUIDs', () => {
    const string = 'abc 21612a6d-dbfc-4ff1-9c0b-d41502ad3e62 21612a6d-dbfc-4ff1-9c0b-d41502ad3e62';
    expect(
      toTSVector(string),
      'to be',
      `(` +
        `to_tsvector_with_exact('${ftsCfg}', 'abc') || ` +
        `'''21612a6d-dbfc-4ff1-9c0b-d41502ad3e62'':1'::tsvector || ` +
        `'''21612a6d-dbfc-4ff1-9c0b-d41502ad3e62'':1'::tsvector` +
        `)`,
    );
  });

  it('should return vector of link with UUIDs', () => {
    const string =
      'abc example.com/p/21612a6d-dbfc-4ff1-9c0b-d41502ad3e62#21612a6d-dbfc-4ff1-9c0b-d41502ad3e63';
    expect(
      toTSVector(string),
      'to be',
      `(` +
        `to_tsvector_with_exact('${ftsCfg}', 'abc') || ` +
        `(to_tsvector_with_exact('${ftsCfg}', 'example com p 21612a6d dbfc 4ff1 9c0b d41502ad3e62 21612a6d dbfc 4ff1 9c0b d41502ad3e63') || ' ' || ` +
        `'''21612a6d-dbfc-4ff1-9c0b-d41502ad3e62'':1'::tsvector || ' ' || ` +
        `'''21612a6d-dbfc-4ff1-9c0b-d41502ad3e63'':2'::tsvector)::tsvector` +
        `)`,
    );
  });
});

describe('toSuffixTSVector', () => {
  it('should return empty string for empty input', () => {
    expect(toSuffixTSVector(''), 'to be', "''::tsvector");
  });

  it('should return empty string for single character', () => {
    expect(toSuffixTSVector('a'), 'to be', "''::tsvector");
  });

  it('should generate single suffix for 2-character text', () => {
    expect(toSuffixTSVector('ab'), 'to be', `'''=ab'':1'::tsvector`);
  });

  it('should generate suffixes for simple text', () => {
    expect(
      toSuffixTSVector('apple'),
      'to be',
      `'''=apple'':1 ''=pple'':2 ''=ple'':3 ''=le'':4'::tsvector`,
    );
  });

  it('should generate suffixes for longer text', () => {
    expect(
      toSuffixTSVector('freefeed'),
      'to be',
      `'''=freefeed'':1 ''=reefeed'':2 ''=eefeed'':3 ''=efeed'':4 ''=feed'':5 ''=eed'':6 ''=ed'':7'::tsvector`,
    );
  });

  it('should remove non-alphanumeric characters', () => {
    expect(
      toSuffixTSVector('hello-world'),
      'to be',
      `'''=helloworld'':1 ''=elloworld'':2 ''=lloworld'':3 ''=loworld'':4 ''=oworld'':5 ''=world'':6 ''=orld'':7 ''=rld'':8 ''=ld'':9'::tsvector`,
    );
  });

  it('should convert to lowercase', () => {
    expect(
      toSuffixTSVector('Apple'),
      'to be',
      `'''=apple'':1 ''=pple'':2 ''=ple'':3 ''=le'':4'::tsvector`,
    );
  });

  it('should handle mixed case with special characters', () => {
    expect(
      toSuffixTSVector('FreeFeed'),
      'to be',
      `'''=freefeed'':1 ''=reefeed'':2 ''=eefeed'':3 ''=efeed'':4 ''=feed'':5 ''=eed'':6 ''=ed'':7'::tsvector`,
    );
  });

  it('should handle text with only special characters', () => {
    expect(toSuffixTSVector('!!!@@@###'), 'to be', "''::tsvector");
  });

  it('should handle text with numbers', () => {
    expect(
      toSuffixTSVector('user123'),
      'to be',
      `'''=user123'':1 ''=ser123'':2 ''=er123'':3 ''=r123'':4 ''=123'':5 ''=23'':6'::tsvector`,
    );
  });

  it('should handle username-like strings', () => {
    expect(
      toSuffixTSVector('john_doe'),
      'to be',
      `'''=johndoe'':1 ''=ohndoe'':2 ''=hndoe'':3 ''=ndoe'':4 ''=doe'':5 ''=oe'':6'::tsvector`,
    );
  });

  it('should handle short usernames', () => {
    expect(toSuffixTSVector('ab'), 'to be', `'''=ab'':1'::tsvector`);
    expect(toSuffixTSVector('abc'), 'to be', `'''=abc'':1 ''=bc'':2'::tsvector`);
  });
});
