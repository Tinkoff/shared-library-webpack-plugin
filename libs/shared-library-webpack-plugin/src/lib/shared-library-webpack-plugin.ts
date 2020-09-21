import * as jscodeshift from 'jscodeshift';
import { camelCase, isNil } from 'lodash';
import { Hook } from 'tapable';
import { compilation, Compiler, Logger, Plugin } from 'webpack';
import { ConcatSource, Source } from 'webpack-sources';
import * as minimatch from 'minimatch';
import { parse } from 'path';
import { v4 as uuidV4 } from 'uuid';

import {
  enforceSourceToString,
  findClosestPackageJsonWithVersion,
  getTapFor,
  isFnWithName,
  suffixFromVersion,
} from './utils';

type ModuleWithDeps = compilation.Module &
  WithDeps & {
    userRequest: string;
    rawRequest?: string;
  };

/**
 * webpack фиговенько затипизирован, по этому иногда приходиться писать типы, которых нет
 */
type AddChunk = (name: string) => compilation.Chunk;

interface WithDeps {
  dependencies: { module: ModuleWithDeps | null }[];
}

/**
 * Конфиг, по которому происходит формирование и выделение анка под расшаренную
 * библиотеку.
 *
 * Если задан паттерн, то chunkName игнорируется.
 *
 * По приоритету сначала пытаемся либу сопоставить с name, потом с pattern.
 */
export interface SharedLibrarySearchConfig {
  /**
   * @see https://github.com/isaacs/minimatch
   */
  pattern?: string;
  /**
   * Бибилиотеки для выделения
   */
  name?: string;
  /**
   * Имя чанка под библиотеку и название поля в глобальном объекте для сохранения импорта.
   * Если chunkName не задан, берется name и пропускается через _.camelCase
   * Для pattern свойство игнорируется
   *
   * Webpack может сам вырезать некоторые символы из имен.
   */
  chunkName?: string;
  /**
   * Суффикс имени чанка.
   * По дефолту это весрия библиотеки без патча {major}.{minor}-{prerelease}
   */
  suffix?: string;

  /**
   * Сепаратор для имени чанка и суффикса
   */
  separator?: string;

  /**
   * Библиотеки, от которых зависит текущая.
   * Имя чанка будет формироваться с учетом версии зависимости
   *
   * @example
   * new SharedLibraryWebpackPlugin({
   *   libs: ['@angular/**', {name: '@tinkoff/angular-ui', deps: ['@angular/core']}]
   * })
   *
   * // chunkName => angularAnimationsBrowser-8.2-ngrxStore-7.4
   */
  deps?: string[];
  usedExports?: string[];
}

/**
 * Конфигурация плагина
 */
export interface SharedLibraryWebpackPluginOptions {
  /**
   * Неймспейс в глобальном простарнстве для хранения экспортов либ для шаринга
   * Default: '__sharedLibs__'
   */
  namespace?: string;
  /**
   * Список библиотек для шаринга
   * Поддерживаются паттерны [minimatch]{@link https://github.com/isaacs/minimatch#readme}
   *
   * @example
   * {
   *    libs: ['@angular/*', 'lodash']
   * }
   *
   * {
   *   libs: '@angular/*'
   * }
   *
   * {
   *   libs: {name: '@angular/core', chunkName: 'ng', separator: '@'}
   * }
   */
  libs:
    | string
    | SharedLibrarySearchConfig
    | ReadonlyArray<string | SharedLibrarySearchConfig>;

  /**
   * Если false и `output.jsonpFunction === webpackJsonp`, то jsonpFunction
   * будет изменен на рандомный идентификатор.
   *
   * Default: false
   */
  disableDefaultJsonpFunctionChange?: boolean;
}

/**
 * Плагин для шаринга библиотек между приложениями
 */
export class SharedLibraryWebpackPlugin implements Plugin {
  private static readonly defaultSharedLibrarySearch: SharedLibrarySearchConfig = {
    separator: '-',
    deps: [],
  };

  public static readonly defaultSharedLibraryNamespace = '__sharedLibs__';

  private static readonly moduleSeparator = '___module_separator___';

  /**
   * Список чанков с модулями для шаринга и соответсвующие им entry
   */
  private readonly sharedChunksAndEntries = new Map<
    compilation.Chunk,
    compilation.ChunkGroup
  >();
  /**
   * {@see SharedLibraryWebpackPluginOptions#namespace}
   */
  private readonly namespace: string;
  /**
   * {@see SharedLibraryWebpackPluginOptions#libs}
   */
  public readonly libs: ReadonlyArray<SharedLibrarySearchConfig>;
  private compilation: compilation.Compilation & { addChunk: AddChunk };
  private readonly patchRequireFnCache = new Map<string, string>();
  private readonly disableDefaultJsonpFunctionChange: boolean;

  /**
   * @see SharedLibraryWebpackPluginOptions
   */
  constructor({
    namespace = SharedLibraryWebpackPlugin.defaultSharedLibraryNamespace,
    libs,
    disableDefaultJsonpFunctionChange = false,
  }: SharedLibraryWebpackPluginOptions) {
    this.namespace = namespace;
    this.libs = (Array.isArray(libs) ? libs : [libs])
      .map((lib) => (typeof lib === 'string' ? { pattern: lib } : lib))
      .map((lib) => ({
        ...SharedLibraryWebpackPlugin.defaultSharedLibrarySearch,
        ...lib,
      }));
    this.disableDefaultJsonpFunctionChange = disableDefaultJsonpFunctionChange;
  }

  /**
   * Список либ для шаринга
   */
  private get sharedChunks(): readonly compilation.Chunk[] {
    return [...this.sharedChunksAndEntries.keys()];
  }

  /**
   * Список либ для шаринга и соответсвующие им entry
   */
  private get sharedChunksAndEntriesAsArray(): readonly [
    compilation.Chunk,
    compilation.ChunkGroup
  ][] {
    return [...this.sharedChunksAndEntries.entries()];
  }

  /**
   * Глобальный объект для создания неймспейса.
   * Берем из общих настроек.
   */
  private get globalObject(): string {
    return this.compilation.mainTemplate.outputOptions.globalObject;
  }

  private get logger(): Logger {
    return this.compilation.getLogger(SharedLibraryWebpackPlugin.name);
  }

  /**
   * Входная точка плагина
   * @param compiler
   */
  apply(compiler: Compiler) {
    compiler.hooks.environment.tap(SharedLibraryWebpackPlugin.name, () => {
      // меняем конфиг jsonpFunction, если он дефолтный и изменение разрешено в конфигах плагина
      if (
        !this.disableDefaultJsonpFunctionChange &&
        compiler.options?.output?.jsonpFunction === 'webpackJsonp'
      ) {
        compiler.options.output.jsonpFunction = uuidV4();
      }
    });

    // Получаем инстанс текущей компиляции, сохраняем его для удобства в инстанс
    // плагина и запускаем инициализацию хуков
    compiler.hooks.thisCompilation.tap(
      getTapFor(SharedLibraryWebpackPlugin.name, 10),
      (compilation: compilation.Compilation) => {
        this.compilation = compilation as compilation.Compilation & {
          addChunk: AddChunk;
        };

        this.initCompilationHooks();
      }
    );
  }

  private initCompilationHooks() {
    // chunk runtime.js
    // хук на изменения кода бутстрапа приложения
    ((this.compilation.mainTemplate.hooks as any)
      .bootstrap as Hook).tap(
      getTapFor(SharedLibraryWebpackPlugin.name, 10),
      (source: string | Source): string => this.patchRuntimeBootstrap(source)
    );

    // chunk runtime.js
    // хук на изменения кода функции require
    ((this.compilation.mainTemplate.hooks as any)
      .require as Hook).tap(
      getTapFor(SharedLibraryWebpackPlugin.name, 10),
      (source: string | Source): string => this.patchRequireFn(source)
    );

    // хук на изменения кода обвязки отдельных чанков
    ((this.compilation.chunkTemplate as any).hooks
      .render as Hook).tap(
      getTapFor(SharedLibraryWebpackPlugin.name, 10),
      (source: ConcatSource, chunk: compilation.Chunk): string | Source =>
        this.patchModule(source, chunk)
    );

    //хук на выделение либ для шаринга в отдельные чанки
    this.compilation.hooks.optimizeChunks.tap(
      getTapFor(SharedLibraryWebpackPlugin.name, 10),
      () => {
        this.libraryToChunk();
      }
    );
  }

  /**
   * См. каменты в примере ниже
   * @example
   * function __webpack_require__(moduleId) {
   *
   *  /*********
   *  * Инъекция сюда
   *  * Тут проверяем есть ли наш модуль в глобале и записываем его в уже установленные,
   *  * если он есть
   *  *********\/
   *
   * 	// Check if module is in cache
   * 	if(installedModules[moduleId]) {
   * 		return installedModules[moduleId].exports;
   * 	}
   * 	// Create a new module (and put it into the cache)
   * 	var module = installedModules[moduleId] = {
   * 		i: moduleId,
   * 		l: false,
   * 		exports: {}
   * 	};
   *
   * 	// Execute the module function
   * 	modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
   *
   * 	// Flag the module as loaded
   * 	module.l = true;
   *
   *  /*********
   *  * Инъекция сюда
   *  * Тут проверяем, не наш ли это модуль только что экспортировали,
   *  * если наш, то зипихиваем его в глобал
   *  *********\/
   * 	// Return the exports of the module
   * 	return module.exports;
   * }
   *
   * @param source
   */
  private patchRequireFn(source: string | Source): string {
    source = enforceSourceToString(source);

    if (this.patchRequireFnCache.has(source)) {
      return this.patchRequireFnCache.get(source);
    }

    const toInstalledModulesFromGlobal = this.sharedChunks
      .map((ch) => {
        return `
if(${JSON.stringify(
          [...ch.modulesIterable].map((m) => m.id)
        )}.indexOf(moduleId) > -1){
  ${this.globalObject}['${this.namespace}'] = ${this.globalObject}['${
          this.namespace
        }'] || {};
  ${this.globalObject}['${this.namespace}']['${ch.name}'] = ${
          this.globalObject
        }['${this.namespace}']['${ch.name}'] || {};
  ${this.globalObject}['${this.namespace}']['${ch.name}'][moduleId] = module;
}`;
      })
      .join('');

    const toGlobalFromInstalledModules = this.sharedChunks
      .map((ch) => {
        return `
if(${JSON.stringify(
          [...ch.modulesIterable].map((m) => m.id)
        )}.indexOf(moduleId) > -1 && ${this.globalObject}['${
          this.namespace
        }'] && ${this.globalObject}['${this.namespace}']['${ch.name}'] && ${
          this.globalObject
        }['${this.namespace}']['${ch.name}'][moduleId]){
  installedModules[moduleId] = ${this.globalObject}['${this.namespace}']['${
          ch.name
        }'][moduleId];
}`;
      })
      .join('');

    const ast = jscodeshift(source);

    ast
      .find(jscodeshift.ReturnStatement)
      .at(1)
      .insertBefore(toInstalledModulesFromGlobal);

    ast
      .find(jscodeshift.IfStatement)
      .at(0)
      .insertBefore(toGlobalFromInstalledModules);

    const result = ast.toSource();

    this.patchRequireFnCache.set(source, result);

    return result;
  }

  /**
   * Стандартный врапер вокраг чанка выглядит примерно так:
   *
   * в массив window["webpackJsonp"] пушится массив с тремя элементами
   * 0. Содержит имя точки входа
   * 1. Сами модули
   * 2. Зависимости от других чанков и id точки входа
   *
   * В этом методе определяем имеет ли чанк зависимости от либ для шаринга.
   * Если да - добавляем эти либы в зависимости, то есть патчим элемент массива №2
   *
   * @example
   * (window["webpackJsonp"] = window["webpackJsonp"] || []).push([
   *    ["main"], // 0
   *    {
   *      "moduleId": (function(...){
   *        ...
   *      })
   *    }, // 1.
   *    [[0, 'runtime']] // 2.
   * ])
   *
   * @param source
   * @param chunk
   */
  private patchModule(
    source: ConcatSource,
    chunk: compilation.Chunk
  ): string | Source {
    // провееряем относится ли чанк к entry либ для шаринга
    const entries = this.sharedChunksAndEntriesAsArray.filter(([, entry]) =>
      chunk.isInGroup(entry)
    );

    if (!entries.length) {
      return source;
    }

    // Разделяем модули и их обертки, что бы не превращать в AST весь код.
    // Анализируем и модифицируем только обертки.
    const modules = [];
    let moduleWrappers = [];

    source.children.forEach((child) => {
      if (typeof child === 'string') {
        moduleWrappers.push(child);
      } else {
        modules.push(child);
        moduleWrappers.push(SharedLibraryWebpackPlugin.moduleSeparator);
      }
    });

    const ast = jscodeshift(moduleWrappers.join('\n'))
      .find(jscodeshift.CallExpression)
      .at(0) // берем первый CallExpression, это как раз вызов пуш у window["webpackJsonp"]
      .replaceWith((path) => {
        const { value } = path;

        const [argument] = value.arguments as [jscodeshift.ArrayExpression];

        // Элементы соответсвуют элементам массива, описанного в каменте к методу
        // eslint-disable-next-line prefer-const
        let [entryNames, modules, deps] = argument.elements as [
          any, // первые два аргумента нам не интересны
          any, // по этому просто any
          jscodeshift.ArrayExpression
        ];

        // Если deps нет, значит создаем массив сами.
        // Во сложенный массив обязательно добавляем первый элемент рывный null.
        // первый элемент - это id entry module. Его отсуствие означает, что
        // что чанк не содержит entry point
        if (!deps) {
          deps = jscodeshift.arrayExpression([
            jscodeshift.arrayExpression([jscodeshift.identifier('null')]),
          ]);
        }

        const [initialDeps] = deps.elements as [jscodeshift.ArrayExpression];

        // Вместо простого указания имени зависимости в entry мы создаем
        // функцию, которая вызывается на месте.
        // Цель - определить загружалась ли уже эта зависимость. Если загружалась
        // возвращается null, если нет - идентификатор зависимости
        const createCheckForDeferredModule = (ch: compilation.Chunk) =>
          jscodeshift(`\
(function(id, name){
  if(${this.globalObject}['${this.namespace}'] && ${this.globalObject}['${
            this.namespace
          }'][name]){
    return null;
  }
  return id;
})(${typeof ch.id === 'string' ? `'${ch.id}'` : ch.id}, '${ch.name}')\
            `)
            .find(jscodeshift.CallExpression)
            .paths()[0].value;

        // Строим новый массив из зивисимостей entry.
        // Примерно это будет на выходе.
        //
        // [[0, 'vendor'].concat([(function(){
        //  ...
        // })()].filter(m != null)]])
        const args = jscodeshift.arrayExpression([
          entryNames,
          modules,
          jscodeshift.arrayExpression([
            jscodeshift.callExpression(
              jscodeshift.memberExpression(
                jscodeshift.arrayExpression(initialDeps.elements),
                jscodeshift.identifier('concat')
              ),
              [
                jscodeshift.callExpression(
                  jscodeshift.memberExpression(
                    jscodeshift.arrayExpression([
                      ...entries.map(([chunk]) =>
                        createCheckForDeferredModule(chunk)
                      ),
                    ]),
                    jscodeshift.identifier('filter')
                  ),
                  [
                    jscodeshift.functionExpression(
                      null,
                      [jscodeshift.identifier('entryName')],
                      jscodeshift.blockStatement([
                        jscodeshift.returnStatement(
                          jscodeshift.binaryExpression(
                            '!=',
                            jscodeshift.identifier('entryName'),
                            jscodeshift.identifier('null')
                          )
                        ),
                      ])
                    ),
                  ]
                ),
              ]
            ),
          ]),
        ]);

        return jscodeshift.callExpression(value.callee, [args]);
      });

    moduleWrappers = ast
      .toSource()
      .split(SharedLibraryWebpackPlugin.moduleSeparator);

    return moduleWrappers
      .reduce((result, moduleWrapper, i) => {
        result.push(moduleWrapper);

        if (modules[i]) {
          result.push(enforceSourceToString(modules[i]));
        }

        return result;
      }, [])
      .join('\n');
  }

  /**
   * Метод патчит функцию checkDeferredModules в runtime.js.
   * Функция проверяет загружены ли зависимости.
   * Если загружены все запускает entry module
   *
   * Мы учим ее качать наши расшаренные либы и игнорировать нулевой id для
   * entry module
   * @param source
   */
  private patchRuntimeBootstrap(source: string | Source): string {
    source = enforceSourceToString(source);

    const ast = jscodeshift(source);

    const thisCodeLoadSharedLibs = this.sharedChunks
      .map((ch) => {
        return `\
if({'${ch.id}': true}[depId] === true && (!${this.globalObject}['${this.namespace}'] || !${this.globalObject}['${this.namespace}']['${ch.name}'])){
    __webpack_require__.e('${ch.id}');
}`;
      })
      .join('');

    // ищем нудную функцию checkDeferredModules для патча
    const checkDeferredModulesFn = ast
      .find(jscodeshift.FunctionDeclaration)
      .filter((p) => isFnWithName('checkDeferredModules', p.value));

    // учим качать расшаренные либы
    checkDeferredModulesFn
      .find(jscodeshift.IfStatement)
      .at(0)
      .replaceWith(() => {
        return `\
if(installedChunks[depId] !== 0){
    fulfilled = false;

    ${thisCodeLoadSharedLibs}
}`;
      });

    // учим игнорить нулевой id у entry module
    checkDeferredModulesFn
      .find(jscodeshift.IfStatement)
      .at(-1) // последний if в функции
      .replaceWith((path) => {
        const {
          value: { test, consequent, alternate },
        } = path;

        // патчим только само условие
        const newTest = jscodeshift(
          `${jscodeshift(
            test
          ).toSource()} && deferredModule.length && deferredModule[0] != null`
        )
          .find(jscodeshift.LogicalExpression)
          .at(0)
          .paths()[0].value;

        return jscodeshift.ifStatement(newTest, consequent, alternate);
      });

    return ast.toSource();
  }

  /**
   * Выделение указанных либ в отдельные чанки
   */
  private libraryToChunk() {
    // перебираем все точки входа, чанки и модули в поиске тех,
    // что нам нужно расшарить
    this.compilation.entrypoints.forEach((entry) => {
      const { chunks } = entry;

      for (const chunk of chunks) {
        for (const module of chunk.modulesIterable) {
          const librarySearchConfig = this.getLibrarySearchConfig(module);

          if (!librarySearchConfig) {
            continue;
          }

          const chunkName = [
            librarySearchConfig.chunkName,
            librarySearchConfig.suffix,
            ...this.getDependencyNames(librarySearchConfig.deps),
          ]
            .filter((str) => !isNil(str))
            .join(librarySearchConfig.separator);

          // если модуль c таким именем уже выделили переходим к следующему
          if (this.sharedChunks.some((ch) => ch.name === chunkName)) {
            continue;
          }

          // создаем чанк
          const newChunk: compilation.Chunk = this.compilation.addChunk(
            chunkName
          );

          // создаем одноименную группу
          const groupChunk: compilation.ChunkGroup = this.compilation.addChunkInGroup(
            newChunk.name
          );

          const addModuleToChunk = (
            module: ModuleWithDeps,
            chunk: compilation.Chunk
          ) => {
            // удаляем модуль из других чанков
            module.chunksIterable.forEach((ch) => {
              module.removeChunk(ch);
            });

            // добавляем модуль к новому чанку
            newChunk.addModule(module);

            // в зависимостях смотрим модули с тем же контекстом
            // добавляем их в тот же чанк
            module.dependencies
              .filter(
                (dep) =>
                  dep.module?.context.startsWith(module.context) &&
                  !this.getLibrarySearchConfig(dep.module)
              )
              .forEach((dep) => addModuleToChunk(dep.module, chunk));
          };

          addModuleToChunk(module, newChunk);

          // и привязываем его к одноименной группе
          (groupChunk as any).pushChunk(newChunk);

          // группу кидаем в дочерние точки входа
          // webpack в таком случае думает, что соответствующий модуль
          // заимпортирован через динамический import
          if (entry.addChild(groupChunk)) {
            (groupChunk as any).addParent(entry);
          }

          // Вырубаем tree shaking для нового чанка
          newChunk.modulesIterable.forEach((m) => {
            if (m.type.startsWith('javascript/')) {
              m.used = true;

              if (
                Array.isArray(m.usedExports) &&
                Array.isArray(librarySearchConfig.usedExports)
              ) {
                m.usedExports.push(...librarySearchConfig.usedExports);
              } else {
                m.usedExports = true;
              }

              m.buildMeta.providedExports = true;
            }
          });

          // и сохраняем ссылки на чанк и его точку входа
          // для патча кода обвязки модулей
          this.sharedChunksAndEntries.set(newChunk, entry);
        }
      }
    });
  }

  private getDependencyNames(
    deps: SharedLibrarySearchConfig['deps']
  ): string[] {
    return deps.reduce((result, name) => {
      return [
        ...result,
        camelCase(name),
        suffixFromVersion(require(`${name}/package.json`).version),
      ];
    }, []);
  }

  /**
   * Вычисление суффикса для модуля по его конфигу
   *
   * Если суффикс не задан пытаемся определить версию пакета по package.json и
   * используем как суффикс.
   * @param librarySearchConfig
   * @param module
   */
  private getChunkNameSuffix(
    librarySearchConfig: SharedLibrarySearchConfig,
    module: { userRequest: string; rawRequest?: string }
  ): string | null {
    let { suffix } = librarySearchConfig;

    if (isNil(suffix)) {
      const { version } =
        findClosestPackageJsonWithVersion(parse(module.userRequest).dir) || {};

      if (!version) {
        this.logger.warn(`Не найдена версия для пакета '${module.rawRequest}'`);

        return null;
      }

      suffix = suffixFromVersion(version);
    }

    return suffix;
  }

  /**
   * Сопоставляем модуль и конфиги.
   *
   * Приоритетно ищем сопоставление сначала по name, потом по pattern
   * @param module
   */
  private getLibrarySearchConfig(module: {
    userRequest: string;
    rawRequest?: string;
  }): SharedLibrarySearchConfig | null {
    if (!module.rawRequest) {
      return null;
    }

    let librarySearchConfig = this.libs
      .filter((lib) => !!lib.name)
      .find((lib) => module.rawRequest === lib.name);

    const chunkName =
      librarySearchConfig?.chunkName ?? camelCase(module.rawRequest);

    if (!librarySearchConfig) {
      librarySearchConfig = this.libs
        .filter((lib) => !!lib.pattern)
        .find((lib) => minimatch(module.rawRequest, lib.pattern));
    }

    if (!librarySearchConfig) {
      return null;
    }

    const suffix = this.getChunkNameSuffix(librarySearchConfig, module);

    return {
      ...librarySearchConfig,
      chunkName,
      suffix,
    };
  }
}
