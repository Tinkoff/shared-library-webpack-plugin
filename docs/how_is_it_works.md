# How is it works?

## How the plugin works

1. The plugin analyzes chunks and extracts libraries to separated chunks with disabled tree-shaking \([or not?](tree_shaing.md)\).
2. The plugin teaches entries and runtime to work with shared chunks.

## How the app is loaded

1. Entry points and runtime are loaded.
2. Entry point checks if a shared required to run chunks are loaded and notifies the runtime about it.
3. Runtime downloads all not downloaded libraries and marks them as downloaded.
4. Runtime runs an app.

