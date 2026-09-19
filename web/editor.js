// Copyright (C) 2025-2026 Swissmakers GmbH
// Author: Michael André Reber
// License: AGPL-3.0-or-later
// https://github.com/swissmakers/swisspaste

// Integrate the shared document with CodeMirror
import { EditorState, Compartment, Transaction } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  StreamLanguage,
  bracketMatching,
  syntaxHighlighting,
  HighlightStyle,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import {
  javascript,
  json,
  typescript,
} from "@codemirror/legacy-modes/mode/javascript";
import { css } from "@codemirror/legacy-modes/mode/css";
import { xml } from "@codemirror/legacy-modes/mode/xml";
import { python } from "@codemirror/legacy-modes/mode/python";
import { go } from "@codemirror/legacy-modes/mode/go";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { c, cpp, csharp, java } from "@codemirror/legacy-modes/mode/clike";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import QRCode from "qrcode";

window.SwissQRCode = (canvas, url) =>
  QRCode.toCanvas(canvas, url, {
    errorCorrectionLevel: "M",
    margin: 4,
    scale: 8,
  });

const modes = {
  javascript,
  "application/json": json,
  "text/typescript": typescript,
  css,
  xml,
  python,
  "text/x-go": go,
  rust,
  "text/x-java": java,
  "text/x-csrc": c,
  "text/x-c++src": cpp,
  "text/x-csharp": csharp,
  shell,
  yaml,
  "text/x-sql": standardSQL,
  dockerfile: dockerFile,
  "text/x-properties": properties,
  nginx,
  powershell: powerShell,
  diff,
  ruby,
  perl,
  lua,
  toml,
};
const highlighting = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.typeName],
    color: "var(--primary)",
    fontWeight: "600",
  },
  { tag: [tags.string, tags.regexp], color: "var(--syntax-string)" },
  { tag: [tags.number, tags.bool, tags.atom], color: "var(--syntax-number)" },
  { tag: tags.comment, color: "var(--ink-faint)", fontStyle: "italic" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--ink-soft)" },
  { tag: tags.heading, fontWeight: "700" },
  { tag: tags.link, textDecoration: "underline" },
]);

window.SwissEditor = function (host, onChange) {
  const language = new Compartment(),
    editable = new Compartment(),
    label = new Compartment(),
    undoHistory = new Compartment();
  let remote = false;
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        undoHistory.of(history()),
        bracketMatching(),
        closeBrackets(),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        syntaxHighlighting(highlighting),
        language.of([]),
        editable.of([
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ]),
        label.of(
          EditorView.contentAttributes.of({
            "aria-label": "Shared paste",
            spellcheck: "false",
          }),
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !remote) onChange();
        }),
      ],
    }),
  });
  return {
    getValue: () => view.state.doc.toString(),
    setValue(content) {
      remote = true;
      try {
        const selection = view.state.selection.main;
        view.dispatch({
          annotations: Transaction.addToHistory.of(false),
          changes: { from: 0, to: view.state.doc.length, insert: content },
          selection: {
            anchor: Math.min(selection.anchor, content.length),
            head: Math.min(selection.head, content.length),
          },
        });
      } finally {
        remote = false;
      }
    },
    clearHistory() {
      view.dispatch({ effects: undoHistory.reconfigure([]) });
      view.dispatch({ effects: undoHistory.reconfigure(history()) });
    },
    setLanguage(mode) {
      const extension =
        mode === "htmlmixed"
          ? html()
          : mode === "markdown"
            ? markdown()
            : mode === "text/x-php"
              ? php()
              : modes[mode]
                ? StreamLanguage.define(modes[mode])
                : [];
      view.dispatch({ effects: language.reconfigure(extension) });
    },
    setReadOnly(value) {
      view.dispatch({
        effects: editable.reconfigure([
          EditorState.readOnly.of(value),
          EditorView.editable.of(!value),
        ]),
      });
    },
    setLabel(value) {
      view.dispatch({
        effects: label.reconfigure(
          EditorView.contentAttributes.of({
            "aria-label": value,
            spellcheck: "false",
          }),
        ),
      });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
};
