import {
  createUniqueHash,
  enforceSourceToString,
  findClosestPackageJsonWithVersion,
  getTapFor,
  goUpFolders,
  isFnWithName,
  suffixFromVersion,
} from './utils';
import * as jscodeshift from 'jscodeshift';
import { ConcatSource } from 'webpack-sources';
import { Volume } from 'memfs';
import patchFs from 'fs-monkey/lib/patchFs';
import { ufs } from 'unionfs';
import * as fs from 'fs';

describe('getTapFor', () => {
  it('Если stage не передан, то по дефолту устанавливается 0', function () {
    expect(getTapFor('testName')).toEqual({
      name: 'testName',
      stage: 0,
    });
  });

  it('Если stage передан, то устанавливается переданное значение', function () {
    expect(getTapFor('testName', 10)).toEqual({
      name: 'testName',
      stage: 10,
    });
  });
});

describe('isFnWithName', () => {
  it('Возвращает true, если нода - это функция с указанным именем', function () {
    jscodeshift(`function fnName(){}`)
      .find(jscodeshift.FunctionDeclaration)
      .forEach((path) => {
        expect(isFnWithName('fnName', path.value)).toBeTruthy();
      });
  });

  it('Возвращает false, если нода - это функция с другим именем', function () {
    jscodeshift(`function otherFnName(){}`)
      .find(jscodeshift.FunctionDeclaration)
      .forEach((path) => {
        expect(isFnWithName('fnName', path.value)).toBeFalsy();
      });
  });
});

describe('enforceSourceToString', () => {
  it('Если передать строку, то вернется та же строка', function () {
    expect(enforceSourceToString('test text')).toEqual('test text');
  });

  it('Если передать Source, то вернется соответствующая строка', function () {
    const source = new ConcatSource('test text');

    expect(enforceSourceToString(source)).toEqual('test text');
  });
});

describe('goUpFolders', () => {
  it('Генератор продвигается вверх по пути до корня', function () {
    expect([...goUpFolders('/root/dir/dir2/dir3')]).toEqual([
      '/root/dir/dir2/dir3',
      '/root/dir/dir2',
      '/root/dir',
      '/root',
      '/',
    ]);
  });
});

describe('findClosestPackageJsonWithVersion', () => {
  // eslint-disable-next-line
  let unpatch = () => {};

  beforeAll(() => {
    const vol = Volume.fromJSON({
      '/path/to/fake/package.json': '{"version":"0.0.0-version.0"}',
      '/path/to/fake/dir/dir1/package.json': '{}',

      '/anotherPath/to/fake/package.json': '{}',
      '/anotherPath/to/fake/dir/dir1/package.json': '{}',
    });

    ufs.use(fs as any).use(vol as any);
    unpatch = patchFs(ufs);
  });

  afterAll(() => {
    unpatch();
  });

  it('Находит первый package.json с версией', () => {
    const result = findClosestPackageJsonWithVersion('/path/to/fake/dir/dir1');

    expect(result).toEqual({ version: '0.0.0-version.0' });
  });

  it('Если package.json с версией нет, то вернется null', () => {
    const result = findClosestPackageJsonWithVersion(
      '/anotherPath/to/fake/dir/dir1'
    );

    expect(result).toEqual(null);
  });
});

describe('suffixFromVersion', () => {
  it('Если версия не содержит пререлизного тега, то возвращается минор и мажор', function () {
    expect(suffixFromVersion('1.2.3')).toEqual('1.2');
  });
  it('Если версия содержит пререлизный тег, то возвращается минор, мажор и тег', function () {
    expect(suffixFromVersion('1.2.3-next.0')).toEqual('1.2-next.0');
  });
});

describe('createUniqueHash', () => {
  it('Если', () => {
    const hash1 = createUniqueHash('string');
    const hash2 = createUniqueHash('string');

    expect(hash1).not.toEqual(hash2);
  });
});
