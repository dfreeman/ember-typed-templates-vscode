'use strict';

import * as path from 'path';
import * as ts from 'typescript';
import compile from './compile';
import {
  IPCMessageReader, IPCMessageWriter, createConnection, IConnection, TextDocuments, TextDocument,
  Diagnostic, InitializeResult, WorkspaceFolder, Position, Files
} from 'vscode-languageserver';

let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
let documents = new TextDocuments();

let workspaceFolders: WorkspaceFolder[];
let watch: ts.WatchOfConfigFile<ts.SemanticDiagnosticsBuilderProgram>;

connection.onInitialize((params): InitializeResult => {
  workspaceFolders = params.workspaceFolders || [];

  // TODO multi-root support
  let root = Files.uriToFilePath(workspaceFolders[0].uri);
  if (!root) return { capabilities: {} };

  watch = compile(root, {
    reportWatchStatus(diagnostic: ts.Diagnostic) {
      let text = diagnostic.messageText.toString();
      if (text.includes('Compilation complete')) {
        connection.console.log('sending diagnostics...');
        sendDiagnostics(documents.all());
      }
    },

    reportDiagnostic() {}
  })!;

  if (!watch) return { capabilities: {} };

  return {
    capabilities: {
      textDocumentSync: documents.syncKind,
      // completionProvider: {
      //   resolveProvider: true
      // }
    }
  };
});

function sendDiagnostics(documents: TextDocument[]) {
  for (let document of documents) {
    validateTextDocument(document);
  }
}

documents.listen(connection);

documents.onDidOpen((params) => {
  sendDiagnostics([params.document]);
});

connection.onDidChangeConfiguration((change) => {
  // TODO deal with config

  // let settings = <Settings>change.settings;
  // maxNumberOfProblems = settings.lspSample.maxNumberOfProblems || 100;
  // // Revalidate any open text documents
  // documents.all().forEach(validateTextDocument);
});

function findAssertions(node: ts.Node, assertions: ts.TypeReferenceNode[] = []) {
  if (ts.isTypeReferenceNode(node)) {
    if (ts.isIdentifier(node.typeName) && node.typeName.text === 'assert') {
      assertions.push(node);
    }
  }

  ts.forEachChild(node, (node: ts.Node) => {
    findAssertions(node, assertions);
  });

  return assertions;
}

function findWorkspaceFolder(uri: string): WorkspaceFolder | undefined {
  for (let folder of workspaceFolders) {
    if (uri.startsWith(folder.uri)) {
      return folder;
    }
  }
}

function locateDeclarationFile(uri: string): ts.SourceFile | undefined {
  let workspaceFolder = findWorkspaceFolder(uri);
  if (workspaceFolder) {
    let relativePath = uri.substring(workspaceFolder.uri.length).replace(/\.hbs$/, '.d.ts');
    let absolutePath = path.join(workspaceFolder.uri, 'types', 'generated', relativePath);
    return watch.getProgram().getSourceFile(absolutePath.replace(/^file:(\/\/)?/, ''));
  }
}

function extractMessage(assertion: ts.TypeReferenceNode): string {
  if (assertion.typeArguments) {
    let messageType = assertion.typeArguments[0];
    if (ts.isLiteralTypeNode(messageType)) {
      if (ts.isStringLiteral(messageType.literal)) {
        return messageType.literal.text;
      }
    }
  }

  return 'Unknown error';
}

function extractNumber(node: ts.TypeNode): number | undefined {
  if (ts.isLiteralTypeNode(node) && ts.isNumericLiteral(node.literal)) {
    return Number(node.literal.text);
  }
}

function extractPosition(assertion: ts.TypeReferenceNode): Position | undefined {
  if (assertion.typeArguments) {
    let positionType = assertion.typeArguments[1];
    if (ts.isTupleTypeNode(positionType)) {
      if (positionType.elementTypes.length === 2) {
        let line = extractNumber(positionType.elementTypes[0]);
        let column = extractNumber(positionType.elementTypes[1]);
        if (line !== undefined && column !== undefined) {
          return Position.create(line - 1, column);
        }
      }
    }
  }
}

function extractSubject(assertion: ts.TypeReferenceNode): ts.TypeNode | undefined {
  if (assertion.typeArguments) {
    return assertion.typeArguments[2];
  }
}

function validateTextDocument(document: TextDocument): void {
  let diagnostics: Diagnostic[] = [];
  let sourceFile = locateDeclarationFile(document.uri)!;

  for (let diagnostic of watch.getProgram().getSemanticDiagnostics(sourceFile)) {
    for (let assertion of findAssertions(sourceFile)) {
      if (diagnostic.start! >= assertion.pos && diagnostic.start! < assertion.end) {
        let message = extractMessage(assertion);
        let start = extractPosition(assertion);
        let subject = extractSubject(assertion);

        if (message && start && subject) {
          let range = { start, end: start };

          if (diagnostic.start! == subject.pos + subject.getLeadingTriviaWidth()) {
            // If the diagnostic covers the entire assertion subject, use the embedded domain-specific error message
            diagnostics.push({ range, message });
          } else {
            // If it's somewhere within the assertion subject, use the diagnostic's own error message
            diagnostics.push({
              range,
              message: diagnosticToString(diagnostic.messageText)
            });
          }
        }
      }
    }
  }

  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

function diagnosticToString(message: string | ts.DiagnosticMessageChain, indent = ''): string {
  if (typeof message === 'string') {
    return `${indent}${message}`;
  } else if (message.next) {
    return `${indent}${message.messageText}\n${diagnosticToString(message.next, `${indent}  `)}`;
  } else {
    return `${indent}${message.messageText}`;
  }
}

connection.listen();
