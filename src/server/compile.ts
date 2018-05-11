import * as ts from 'typescript';
import { watch } from 'chokidar';
import * as fs from 'fs-extra';
import { sync as resolveSync } from 'resolve';

interface Callbacks {
  reportDiagnostic?: (diagnostic: ts.Diagnostic) => void;
  reportWatchStatus?: (diagnostic: ts.Diagnostic) => void;
  watchedFileChanged?: () => void;
}

export default function compile(root: string, callbacks: Callbacks)
    : ts.WatchOfConfigFile<ts.SemanticDiagnosticsBuilderProgram> | undefined {
  let fullOptions = {
    rootDir: root,
    allowJs: false,
    noEmit: true,
    watch: true,
  };

  let projectTS: typeof ts = require(resolveSync('typescript', { basedir: root }));
  let configPath = projectTS.findConfigFile(root, projectTS.sys.fileExists, 'tsconfig.json');
  if (!configPath) return;

  let createProgram = projectTS.createSemanticDiagnosticsBuilderProgram;
  let host = projectTS.createWatchCompilerHost(
    configPath,
    fullOptions,
    buildWatchHooks(projectTS.sys, callbacks),
    createProgram,
    diagnosticCallback(callbacks.reportDiagnostic),
    diagnosticCallback(callbacks.reportWatchStatus)
  );

  return projectTS.createWatchProgram(host);
};

function diagnosticCallback(callback?: (diagnostic: ts.Diagnostic) => void) {
  if (callback) {
    // The initial callbacks may be synchronously invoked during instantiation of the
    // WatchProgram, which is annoying if those callbacks want to _reference_ it, so
    // we always force invocation to be asynchronous for consistency.
    return (diagnostic: ts.Diagnostic) => {
      process.nextTick(() => callback(diagnostic));
    };
  }
}

function buildWatchHooks(sys: ts.System, callbacks: Callbacks) {
  return Object.assign({}, sys, {
    watchFile: null,
    watchDirectory(dir: string, callback: (path: string) => void) {
      if (!fs.existsSync(dir)) return;

      let ignored = /\/(\..*?|dist|node_modules|tmp)\//;
      let watcher = watch(dir, { ignored, ignoreInitial: true });

      watcher.on('all', (type: string, path: string) => {
        callback(path);

        if (path.endsWith('.ts') && callbacks.watchedFileChanged) {
          callbacks.watchedFileChanged();
        }
      });

      return watcher;
    }
  });
}
