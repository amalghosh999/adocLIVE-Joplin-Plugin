import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { getIncludeTargets, type IncludeTarget } from "../ipc";
import { getCurrentNoteId } from "../note-context";

interface IncludeDirectiveMatch {
  targetFrom: number;
  targetTo: number;
  query: string;
}

function getIncludeDirectiveMatch(context: CompletionContext): IncludeDirectiveMatch | null {
  const line = context.state.doc.lineAt(context.pos);
  const lineBeforeCursor = line.text.slice(0, context.pos - line.from);
  const match = lineBeforeCursor.match(/^\s*include::([^\[]*)$/);
  if (!match) return null;

  const targetText = match[1] || "";
  const targetFrom = context.pos - targetText.length;
  const afterTarget = line.text.slice(targetFrom - line.from);
  const bracketIndex = afterTarget.indexOf("[");
  const targetTo = bracketIndex >= 0 ? targetFrom + bracketIndex : line.to;

  return {
    targetFrom,
    targetTo,
    query: targetText,
  };
}

function buildIncludeCompletion(
  target: IncludeTarget,
): Completion {
  return {
    label: target.insertText,
    detail: target.displayPath === target.insertText
      ? target.title
      : `${target.displayPath} — ${target.title}`,
    type: "file",
    section: "Includes",
    apply: (view, _completion, from, to) => {
      const line = view.state.doc.lineAt(from);
      const afterTarget = line.text.slice(to - line.from);
      const hasAttributeList = afterTarget.startsWith("[");
      const hasEmptyAttributes = afterTarget.startsWith("[]");
      const insertText = hasAttributeList
        ? target.insertText
        : `${target.insertText}[]`;
      const selectionAnchor = hasAttributeList
        ? from + target.insertText.length + (hasEmptyAttributes ? 1 : 0)
        : from + target.insertText.length + 1;

      view.dispatch({
        changes: { from, to, insert: insertText },
        selection: { anchor: selectionAnchor },
      });
    },
  };
}

export async function includeCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
  const match = getIncludeDirectiveMatch(context);
  if (!match) return null;

  let targets: IncludeTarget[] = [];
  try {
    const response = await getIncludeTargets(getCurrentNoteId(), match.query);
    targets = response.targets;
  } catch (error) {
    console.error("[IncludeCompletion] Failed to load include targets:", error);
    return null;
  }

  if (targets.length === 0) return null;

  return {
    from: match.targetFrom,
    options: targets.map(target => buildIncludeCompletion(target)),
    validFor: /^[^\[\s]*$/,
  };
}

export const includeCompletionTrigger = EditorView.inputHandler.of((view, from, _to, text) => {
  const line = view.state.doc.lineAt(from);
  const lineBeforeCursor = line.text.slice(0, from - line.from);

  if (text === ":" && /^\s*include:$/.test(lineBeforeCursor)) {
    setTimeout(() => startCompletion(view), 0);
  } else if ((text === "/" || text === ".") && /^\s*include::[^\[]*$/.test(lineBeforeCursor)) {
    setTimeout(() => startCompletion(view), 0);
  }

  return false;
});
