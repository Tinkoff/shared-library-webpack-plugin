import { SharedLibraryWebpackPlugin } from './shared-library-webpack-plugin';
import * as webpack from 'webpack';
import { Stats } from 'webpack';
import { resolve } from 'path';
import * as fs from 'fs';
import * as jscodeshift from 'jscodeshift';
import { Collection } from 'jscodeshift/src/Collection';
import * as puppeteer from 'puppeteer';
import { Browser, Page, Request, ResourceType } from 'puppeteer';
import { MonoTypeOperatorFunction, Observable, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

const commonWebpackConfig: webpack.Configuration = {
  output: {
    path: resolve(__dirname, '../../__tests__/output'),
  },
  mode: 'production',
  optimization: {
    runtimeChunk: {
      name: 'runtime',
    },
  },
  performance: false,
};

function webpackCallbackFactory(
  success: (stats: Stats) => void = () => {} // eslint-disable-line
): webpack.Compiler.Handler {
  return function webpackCallback(err: Error, stats: Stats) {
    if (err) {
      throw err;
    }

    const { errors, warnings } = stats.compilation;

    warnings.forEach(console.warn);

    if (errors?.length) {
      const [firstError, ...nextErrors] = errors;

      nextErrors.forEach(console.error);
      throw firstError;
    }

    success(stats);
  };
}

const DEFAULT_WEBPACK_JSONP_FN_NAME = 'webpackJsonp';

function runWebpack(config: webpack.Configuration): Promise<Stats> {
  return new Promise<Stats>((resolve) => {
    webpack({
      ...commonWebpackConfig,
      ...config,
    }).run(
      webpackCallbackFactory((stats) => {
        resolve(stats);
      })
    );
  });
}

function getChunkSource(assetName: string) {
  return fs
    .readFileSync(resolve(__dirname, `../../__tests__/output/${assetName}`))
    .toString();
}

function getChunkAST(assetName: string): Collection<any> {
  return jscodeshift(getChunkSource(assetName));
}

function windowWithNamespaceIsExist(namespace: string): boolean | never {
  const ast = getChunkAST('runtime.js');
  return ast
    .find(jscodeshift.MemberExpression)
    .filter((path) => {
      const expression = path.value;

      return (
        expression.object.type === 'Identifier' &&
        expression.object.name === 'window' &&
        expression.property.type === 'Identifier' &&
        expression.property.name === namespace
      );
    })
    .get(0);
}

function filterByResourceType(
  types: ResourceType[]
): MonoTypeOperatorFunction<Request> {
  return filter<Request>((request: Request) =>
    types.includes(request.resourceType())
  );
}

describe('SharedLibraryWebpackPlugin', () => {
  describe('Конфигурация libs', () => {
    it('Если в libs передать строку, то на выходе получим массив конфигов с одним элементом', function () {
      expect(new SharedLibraryWebpackPlugin({ libs: 'lib' }).libs).toEqual([
        { deps: [], pattern: 'lib', separator: '-' },
      ]);
    });

    it('Все строки в libs приводятся к объекту, все объекты расширяются дефолтными свойствами', function () {
      expect(
        new SharedLibraryWebpackPlugin({
          libs: [
            'lib',
            { name: 'lib2' },
            { deps: ['lib3'], pattern: 'lib/*', separator: '.' },
          ],
        }).libs
      ).toEqual([
        { deps: [], pattern: 'lib', separator: '-' },
        { deps: [], name: 'lib2', separator: '-' },
        { deps: ['lib3'], pattern: 'lib/*', separator: '.' },
      ]);
    });
  });

  describe('Плагин инициализирован и в libs указанно одно имя модуля', () => {
    let stats: Stats;

    beforeAll(() => {
      return runWebpack({
        entry: { entry: resolve(__dirname, '../../__tests__/1.js') },
        plugins: [
          new SharedLibraryWebpackPlugin({
            libs: 'lodash',
            disableDefaultJsonpFunctionChange: true,
          }),
        ],
      }).then((compilationStats) => {
        stats = compilationStats;
      });
    });

    it('На выходе получаем три чанка', () => {
      const { assetsByChunkName } = stats.toJson();

      expect(assetsByChunkName).toEqual({
        entry: 'entry.js',
        e138547f92793a9c9f56c71e0cbd8b7f: 'e138547f92793a9c9f56c71e0cbd8b7f.js',
        runtime: 'runtime.js',
      });
    });

    it('entry не должен содержать динамический чанк', () => {
      const { entrypoints } = stats.toJson();

      expect(entrypoints.entry.assets).toEqual(['runtime.js', 'entry.js']);
    });

    it('Глобальный неймспейс для шаринга имеет дефолтное имя', () => {
      expect(
        windowWithNamespaceIsExist(
          SharedLibraryWebpackPlugin.defaultSharedLibraryNamespace
        )
      ).toBeTruthy();
    });

    it('Имя jsonpFunction не изменено', () => {
      expect(stats.compilation.outputOptions.jsonpFunction).toEqual(
        DEFAULT_WEBPACK_JSONP_FN_NAME
      );
    });

    it('Check outputs', () => {
      const { assets } = stats.toJson();

      assets.forEach(({ name }) => {
        expect(getChunkSource(name)).toMatchSnapshot();
      });
    });
  });

  describe('Плагин инициализирован и в libs указанно несколько конфигов', () => {
    const anotherNamespace = '__another_name__';
    let stats: Stats;

    beforeAll(() => {
      return runWebpack({
        entry: { entry: resolve(__dirname, '../../__tests__/2.js') },
        plugins: [
          new SharedLibraryWebpackPlugin({
            libs: ['lodash/**', { name: 'minimatch', deps: ['lodash'] }],
            namespace: anotherNamespace,
          }),
        ],
      }).then((compilationStats) => {
        stats = compilationStats;
      });
    });

    it('Имя jsonpFunction изменено на случайное', () => {
      expect(stats.compilation.outputOptions.jsonpFunction).not.toEqual(
        DEFAULT_WEBPACK_JSONP_FN_NAME
      );
    });

    it('На выходе получаем 4 чанка. Имена формируются с учетом зависимостей', () => {
      const { assetsByChunkName } = stats.toJson();

      expect(assetsByChunkName).toEqual({
        entry: 'entry.js',
        '6de17ccb57410727d703f8f43cf176ad':
          '6de17ccb57410727d703f8f43cf176ad.js',
        '841c5fb8f153820177604a52d7a81a64':
          '841c5fb8f153820177604a52d7a81a64.js',
        runtime: 'runtime.js',
      });
    });

    it('entry не должен содержать динамические чанки', () => {
      const { entrypoints } = stats.toJson();

      expect(entrypoints.entry.assets).toEqual(['runtime.js', 'entry.js']);
    });

    it('Глобальный неймспейс для шаринга имеет кастомное имя', () => {
      expect(windowWithNamespaceIsExist(anotherNamespace)).toBeTruthy();
    });
  });

  describe('Angular and secondary entry points', () => {
    let stats: Stats;

    beforeAll(() => {
      return runWebpack({
        entry: { entry: resolve(__dirname, '../../__tests__/3.js') },
        plugins: [
          new SharedLibraryWebpackPlugin({
            libs: [
              { name: '@angular/common', usedExports: ['APP_BASE_HREF'] },
              '@angular/**',
            ],
            disableDefaultJsonpFunctionChange: true,
          }),
        ],
      }).then((compilationStats) => {
        stats = compilationStats;
      });
    }, 10_000);

    it('@angular/common и @angular/common/http каждый в своем чанке', () => {
      const { assetsByChunkName } = stats.toJson();

      expect(assetsByChunkName).toEqual({
        entry: 'entry.js',
        '4e1714e02887fff15c33d70f2cf52cca':
          '4e1714e02887fff15c33d70f2cf52cca.js',
        '87a872dc20ed59f9d79f4f67f469b215':
          '87a872dc20ed59f9d79f4f67f469b215.js',
        d0a0da2798e967aea097db4ebd3ac209: 'd0a0da2798e967aea097db4ebd3ac209.js',
        runtime: 'runtime.js',
      });
    });

    it('Check outputs', () => {
      const { assets } = stats.toJson();

      assets.forEach(({ name }) => {
        expect(getChunkSource(name)).toMatchSnapshot();
      });
    });
  });

  describe('Проверка загрузки и исполнения скриптов', () => {
    let browser: Browser;
    let page: Page;
    let requests: Observable<Request>;
    let subscription: Subscription;

    beforeAll(async () => {
      browser = await puppeteer.launch();
    });

    beforeEach(async () => {
      page = await browser.newPage();

      subscription = new Subscription();

      requests = new Observable<Request>((subscriber) => {
        const handler = (request: Request) => {
          request.continue();
          subscriber.next(request);
        };

        page.on('request', handler);

        return () => {
          page.removeListener('request', handler);
          subscriber.unsubscribe();
        };
      });
    });

    it('Чанк с minimatch грузится только после mine.js', async () => {
      let mainIsLoaded = false;
      let minimatchIsLoaded = false;

      subscription.add(
        requests.pipe(filterByResourceType(['script'])).subscribe((request) => {
          if (request.url().endsWith('/main.js')) {
            expect(minimatchIsLoaded).toBeFalsy();
            mainIsLoaded = true;
          }

          if (request.url().endsWith('/bfeb3267488c3cf7faa6192c5b296d69.js')) {
            expect(mainIsLoaded).toBeTruthy();
            minimatchIsLoaded = true;
          }
        })
      );

      await page.setRequestInterception(true);
      await page.goto('http://localhost:4200');
    });

    it('После загрузки появляется глобальное имя с расшаренным minimatch', async () => {
      await page.goto('http://localhost:4200');

      const minimatchIsExists = await page.evaluate(
        () => !!window['__shared_libs_b8__']['bfeb3267488c3cf7faa6192c5b296d69']
      );

      expect(minimatchIsExists).toBeTruthy();
    });

    describe('Эмуляция уже загруженного lodash 4.17', () => {
      beforeEach(async () => {
        await page.evaluateOnNewDocument(() => {
          window['__shared_libs_b8__'] = {};
          window['__shared_libs_b8__']['e138547f92793a9c9f56c71e0cbd8b7f'] =
            window['__shared_libs_b8__']['e138547f92793a9c9f56c71e0cbd8b7f'] ||
            {};
          window['__shared_libs_b8__']['e138547f92793a9c9f56c71e0cbd8b7f'][
            '60bb'
          ] = {
            exports: {
              camelCase() {
                return 'There is sharing!';
              },
            },
          };
        });
      });

      it('Chunk lodash 4.17 не грузиться', async () => {
        subscription.add(
          requests
            .pipe(filterByResourceType(['script']))
            .subscribe((request) => {
              expect(request.url().endsWith('/lodash-4.17.js')).toBeFalsy();
            })
        );

        await page.setRequestInterception(true);
        await page.goto('http://localhost:4200');
      });

      it('В теле документа нет скрипта lodash', async () => {
        await page.goto('http://localhost:4200');

        const scripts = await page.$$eval('script', (elements) =>
          elements.map((element) => element.getAttribute('src'))
        );

        expect(
          scripts.includes('e138547f92793a9c9f56c71e0cbd8b7f.js')
        ).toBeFalsy();
      });

      it('Выводится сообщение из мока lodash', async () => {
        await page.goto('http://localhost:4200');

        const text = await page.$eval(
          '.lodash-message',
          (element) => element.textContent
        );

        console.log(text);

        expect(text).toEqual('There is sharing!');
      });
    });

    describe('Эмуляция уже загруженного lodash 4.16', () => {
      beforeEach(async () => {
        await page.evaluateOnNewDocument(() => {
          window['__shared_libs_b8__'] = {};
          window['__shared_libs_b8__']['lodash-4.16'] = {
            exports: {
              camelCase() {
                return 'There is sharing!';
              },
            },
          };
        });
      });

      it('Чанк с lodash 4.17 грузиться', async () => {
        let lodashIsLoaded = false;

        subscription.add(
          requests
            .pipe(filterByResourceType(['script']))
            .subscribe((request) => {
              if (
                request.url().endsWith('/e138547f92793a9c9f56c71e0cbd8b7f.js')
              ) {
                lodashIsLoaded = true;
              }
            })
        );

        await page.setRequestInterception(true);
        await page.goto('http://localhost:4200');

        expect(lodashIsLoaded).toBeTruthy();
      });

      it('В теле документа есть скрипт lodash 4.17', async () => {
        await page.goto('http://localhost:4200');

        const scripts = await page.$$eval('script', (elements) =>
          elements.map((element) => element.getAttribute('src'))
        );

        expect(
          scripts.includes('e138547f92793a9c9f56c71e0cbd8b7f.js')
        ).toBeTruthy();
      });

      it('Выводится сообщение из lodash 4.17', async () => {
        await page.goto('http://localhost:4200');

        const text = await page.$eval(
          '.lodash-message',
          (element) => element.textContent
        );

        expect(text).toEqual('sharedLibraryWebpackPlugin');
      });
    });

    describe('Местонахождение скриптов в html-документе', () => {
      it('В body только entry points', async () => {
        await page.goto('http://localhost:4200');

        const scripts = await page.$$eval('body script', (elements) =>
          elements.map((element) => element.getAttribute('src'))
        );

        expect(scripts).toEqual(['runtime.js', 'styles.js', 'main.js']);
      });

      it('В head добавляются только чанки для шаринга', async () => {
        await page.goto('http://localhost:4200');

        const scripts = await page.$$eval('head script', (elements) =>
          elements.map((element) => element.getAttribute('src'))
        );

        expect(scripts).toEqual([
          'bfeb3267488c3cf7faa6192c5b296d69.js',
          'e138547f92793a9c9f56c71e0cbd8b7f.js',
        ]);
      });
    });

    afterEach(() => {
      subscription.unsubscribe();
      page.close();
    });

    afterAll(() => {
      browser.close();
    });
  });
});
