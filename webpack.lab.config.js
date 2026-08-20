const path = require("path");
const webpack = require("webpack");
const CopyPlugin = require("copy-webpack-plugin");

const root = __dirname;
const outputRoot = path.resolve(root, "test-lab-dist");
const tsRule = {
  test: /\.ts$/,
  use: { loader: "ts-loader", options: { transpileOnly: true, configFile: "tsconfig.lab.json" } },
  exclude: /node_modules/,
};

module.exports = (_env, argv) => {
  const isDevelopment = argv.mode !== "production";
  const common = {
    target: "web",
    mode: isDevelopment ? "development" : "production",
    resolve: {
      extensions: [".ts", ".js"],
      conditionNames: ["import", "module", "browser", "default"],
    },
    devtool: isDevelopment ? "source-map" : false,
    performance: { hints: false },
  };

  return [
    {
      ...common,
      name: "lab-controller",
      entry: "./test-lab/controller/index.ts",
      output: { filename: "controller.js", path: path.join(outputRoot, "controller") },
      module: { rules: [tsRule] },
      plugins: [new CopyPlugin({ patterns: [
        { from: "test-lab/controller/index.html", to: "index.html" },
        { from: "test-lab/controller/controller.css", to: "controller.css" },
        { from: "test-lab/fixtures/assets", to: "assets" },
      ] })],
    },
    {
      ...common,
      name: "baseline-review",
      entry: "./test-lab/baseline-review/index.ts",
      output: { filename: "review.js", path: path.join(outputRoot, "controller", "baseline-review") },
      module: { rules: [tsRule] },
      plugins: [new CopyPlugin({ patterns: [
        { from: "test-lab/baseline-review/index.html", to: "index.html" },
        { from: "test-lab/baseline-review/review.css", to: "review.css" },
      ] })],
    },
    {
      ...common,
      name: "lab-editor-bootstrap",
      entry: "./test-lab/editor/bootstrap.ts",
      output: { filename: "bootstrap.js", path: path.join(outputRoot, "editor") },
      module: { rules: [tsRule] },
      plugins: [new CopyPlugin({ patterns: [
        { from: "test-lab/editor/editor.html", to: "editor.html" },
        { from: "test-lab/editor/editor.css", to: "lab-editor.css" },
      ] })],
    },
    {
      ...common,
      name: "lab-editor-panel",
      entry: "./src/panel.ts",
      output: { filename: "panel.js", path: path.join(outputRoot, "editor") },
      module: { rules: [tsRule, { test: /\.(aff|dic)$/, type: "asset/source" }] },
      plugins: [
        new CopyPlugin({ patterns: [
          { from: "src/styles", to: "styles" },
          { from: "node_modules/katex/dist/katex.min.css", to: "styles/katex.min.css" },
          { from: "node_modules/katex/dist/fonts", to: "styles/fonts" },
        ] }),
        new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
      ],
    },
  ];
};
