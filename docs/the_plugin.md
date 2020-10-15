# The Plugin

## `SharedLibraryWebpackPlugin`

`SharedLibraryWebpackPlugin` is a class that implements webpack plugin functionality,

## Options

### `libs`

{% tabs %}
{% tab title="Description" %}
`string | SharedLibrarySearchConfig | Array<string | SharedLibrarySearchConfig>`

An option that configures the search for shared libraries and the formation of a chunk name. It can be a string or [SharedLibrarySearchConfig](the_plugin.md#sharedlibrarysearchconfig) or an array of them.
{% endtab %}

{% tab title="Example" %}
```typescript
new SharedLibraryWebpackPlugin({
    libs: 'lodash'
});

new SharedLibraryWebpackPlugin({
    libs: '@angular/**'
});

new SharedLibraryWebpackPlugin({
    libs: ['@angular/**', 'zone.js/dist/zone']
});

new SharedLibraryWebpackPlugin({
   libs: {name: '@angular/core', chunkName: 'ng', separator: '@'}
});
```
{% endtab %}
{% endtabs %}

### `namespace`

{% tabs %}
{% tab title="Description" %}
`string`

The namespace for saving exported libraries
{% endtab %}

{% tab title="Example" %}
```typescript
{
    namespace: "__shared_libraries__"
}
```
{% endtab %}
{% endtabs %}

### `disableDefaultJsonpFunctionChange`

{% tabs %}
{% tab title="Description" %}
`boolean`

By default: `false`

If true `jsonpFunction` will be replaced with a random name
{% endtab %}

{% tab title="Example" %}
```typescript
{
    disableDefaultJsonpFunctionChange: false
}
```
{% endtab %}
{% endtabs %}

## `SharedLibrarySearchConfig`

`SharedLibrarySearchConfig` configures the search for sharing library and the formation of a chunk name.

### `pattern`

{% tabs %}
{% tab title="Description" %}
`string`

An option to search for libraries in a bundle.
{% endtab %}

{% tab title="Example" %}
```typescript
{
    pattern: "@angular/**"
}
```
{% endtab %}
{% endtabs %}

### `name`

{% tabs %}
{% tab title="Description" %}
`string`

A name to search for a library in a bundle.
{% endtab %}

{% tab title="Example" %}
```typescript
{
    name: "@angular/core"
}
```
{% endtab %}
{% endtabs %}

### `chunkName`

{% tabs %}
{% tab title="Description" %}
`string`

A name of a shared chunk

{% hint style="info" %}
If a pattern exists `chunkName` is ignored
{% endhint %}
{% endtab %}

{% tab title="Example" %}
```typescript
{
    chunkName: "ng"
}
```
{% endtab %}
{% endtabs %}

### `suffix`

{% tabs %}
{% tab title="Description" %}
`string`

A chunk name suffix

By default library version `{major}.{minor}-{prerelease}`
{% endtab %}

{% tab title="Example" %}
```typescript
{
    suffix: 'suffix'
}
```
{% endtab %}
{% endtabs %}

### `separator`

{% tabs %}
{% tab title="Description" %}
`string`

Separator for a chunk name and suffix
{% endtab %}

{% tab title="Example" %}
```typescript
{
    separator: "@"
}
```
{% endtab %}
{% endtabs %}

### `deps`

{% tabs %}
{% tab title="Description" %}
`string[]`

Libraries that the current one depends on.
{% endtab %}

{% tab title="Example" %}
```typescript
new SharedLibraryWebpackPlugin({
   libs: [
      '@angular/**', 
      {name: '@tinkoff/angular-ui', deps: ['@angular/core']}
   ]
})
```
{% endtab %}
{% endtabs %}

### `usedExports`

{% tabs %}
{% tab title="Description" %}
`string[]`

The import names to be used by another application
{% endtab %}

{% tab title="Example" %}
```typescript
{name: '@angular/core', usedExports: ['DomSanitizer']}
```
{% endtab %}
{% endtabs %}

