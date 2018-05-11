'use strict';

import * as path from 'path';
import { ExtensionContext } from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient';

export function activate(context: ExtensionContext) {
  let module = context.asAbsolutePath(path.join('out', 'server', 'server.js'));
  console.log({ module });
  let transport = TransportKind.ipc;
  let serverOptions = {
    run: { module, transport },
    debug: { module, transport, options: { execArgv: ["--nolazy", "--inspect=6009"] } }
  };

  let clientOptions = {
    documentSelector: [{ scheme: 'file', language: 'handlebars' }]
  };

  let disposable = new LanguageClient(
    'ember-typed-templates',
    'Typed templates language service',
    serverOptions,
    clientOptions
  ).start();

  context.subscriptions.push(disposable);
}

export function deactivate() {
}
