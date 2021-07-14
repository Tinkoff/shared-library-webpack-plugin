import { Tap } from 'tapable';
import { Source } from 'webpack-sources';
import { join, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import { FunctionDeclaration } from 'jscodeshift';
import * as semver from 'semver';
import { createHash } from 'crypto';
import { template } from 'lodash';

/**
 * [Конфиг хука]{@see Tap} с приоритетом
 *
 * Хуки из либы [tapable]{@link https://github.com/webpack/tapable} (ее узает
 * webpack под капотом) могут принимать параметр stage, который определяет
 * очередность запуска колбэка. Чем выше число - тем позднее будет выполнен колбэк
 * @param name
 * @param stage
 */
export function getTapFor(name: string, stage?: number): Tap {
  return {
    name,
    stage: stage ?? 0,
  } as Tap;
}

/**
 * Вернет true, если нода функции с указанным именем
 * {@see FunctionDeclaration}
 * @param name
 * @param n
 */
export function isFnWithName(name: string, n: FunctionDeclaration): boolean {
  return n && n.id && n.id.name === name;
}

/**
 * Принудительно приводим к строке
 * @param source
 */
export function enforceSourceToString(source: string | Source): string {
  return typeof source === 'string' ? source : source.source();
}

/**
 * Двигаемся вверх по дереву папок, либо до cwd, либо до корня
 * @param root
 */
export function* goUpFolders(root: string): Generator<string> {
  yield root;

  while (!root.match(/^(\w:\\|\/)$/) && root !== process.cwd()) {
    root = resolve(root, '..');
    yield root;
  }
}

/**
 * Возвращаем первый попавшийся package.json с version
 * @param root
 */
export function findClosestPackageJsonWithVersion(
  root: string
): null | { version: string } {
  for (const path of goUpFolders(root)) {
    const file = join(path, 'package.json');

    if (existsSync(path)) {
      try {
        const pack = JSON.parse(readFileSync(file).toString());

        if (pack?.version) {
          return pack;
        }
      } catch (e) {} //eslint-disable-line
    }
  }

  return null;
}

export interface PackageVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

export function getPackageVersion(version: string): PackageVersion | null {
  const { major, minor, prerelease, patch } = semver.parse(version);

  return {
    major,
    minor,
    prerelease: prerelease.length ? `-${prerelease.join('.')}` : '',
    patch,
  };
}

export function compileSuffix(
  suffix: string,
  data: Partial<PackageVersion>
): string {
  const compiled = template(suffix);

  return compiled(data);
}

const usedIds = new Set<string>();

export function createUniqueHash(str: string): string {
  const hash = createHash('md4');
  hash.update(str);
  const hashId = hash.digest('hex');
  let len = 4;
  while (usedIds.has(hashId.substr(0, len))) len++;
  const generatedHash = hashId.substr(0, len);

  usedIds.add(generatedHash);

  return generatedHash;
}
